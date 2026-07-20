// Groq tool-calling agent loop (Flow 1: Inquiry Submission).
// Enabled with AGENT_TOOLS=true (+ GROQ_API_KEY). The model reads the customer's
// message, calls tools to read/write the request, and composes the reply. State
// (clean transcript + the active ticket/customer) is persisted in the existing
// intake_sessions table, so it survives across messages without duplicating tickets.

import Groq from "groq-sdk";
import { supabase } from "../../config/supabase.js";
import { env } from "../../config/env.js";
import { normalizePhone } from "../../lib/phone.js";
import { log } from "../../lib/logger.js";
import { TOOL_DEFS } from "./tools.js";
import { executeTool } from "./executor.js";
import { getLatestTicketByCustomerPhone } from "../tickets.js";
import { SYSTEM_PROMPT, OPENING } from "./prompt.js";

const isOpenStatus = (s) => s && s !== "CLOSED" && s !== "CANCELLED";

// True when this customer already has a FINALISED open request (e.g. one the
// service team logged for them). Such a customer must never get the generic
// "share your name / issue / address" opening — their details are already on file.
async function hasLoggedRequest(phone) {
  try {
    const latest = await getLatestTicketByCustomerPhone(phone);
    return !!(latest && isOpenStatus(latest.status) && latest.intake_complete);
  } catch (e) {
    log.error("hasLoggedRequest:", e.message);
    return false; // on error fall back to the normal greeting path
  }
}

// A bare greeting with no service details — "hi", "hello", "service", "namaste".
// On a brand-new chat we answer these with the fixed OPENING verbatim so every
// requested line (incl. the purifier photo) always appears; the LLM drops them.
const GREETING_RE = /^(hi+|hey+|hello+|helo|hlo|namaste|namaskar|good\s*(morning|afternoon|evening)|start|service|enquiry|inquiry)[\s!.,]*$/i;
const isBareGreeting = (t) => GREETING_RE.test((t || "").trim());

// True when the model's reply is (a variant of) the opening greeting — used to
// force the canonical OPENING so no requested line is ever dropped. Matches any
// wording of the service line so a copy tweak doesn't silently disable this.
const looksLikeOpening = (t) =>
  /oasis globe water purifier service/i.test(t || "") && /please share/i.test(t || "");

const MAX_STEPS = 5;    // safety cap on tool round-trips per message (each re-sends prompt+tools, so fewer = fewer tokens)
const MAX_HISTORY = 12; // turns of clean transcript kept for context (trimmed to ease Groq's per-minute token limit)

// Groq key pool. GROQ_API_KEY can be a comma-separated list; each key is a
// separate account with its own per-minute AND per-day token budget. When one
// key rate-limits, we rotate to the next available one instead of waiting.
const groqClients = env.groqApiKeys.map((apiKey) => new Groq({ apiKey }));
const keyCooldownUntil = new Array(groqClients.length).fill(0); // ms epoch per key
let groqIdx = 0;

// Pick the next key that isn't cooling down (starting from the current one).
function pickGroq() {
  const now = Date.now();
  for (let i = 0; i < groqClients.length; i++) {
    const idx = (groqIdx + i) % groqClients.length;
    if (keyCooldownUntil[idx] <= now) { groqIdx = idx; return idx; }
  }
  return -1; // every key is cooling down
}

// Try Groq across all keys, rotating on 429 (no long waits — a fresh key has a
// fresh budget). Throws only when every key is rate-limited or on a hard error.
async function callGroqPooled(params) {
  let lastErr;
  for (let tried = 0; tried < groqClients.length; tried++) {
    const idx = pickGroq();
    if (idx === -1) break; // all keys cooling down
    try {
      return await groqClients[idx].chat.completions.create(params);
    } catch (e) {
      lastErr = e;
      if (statusOf(e) !== 429) throw e; // not a rate limit → a real error, surface it
      const secs = Number(e?.headers?.["retry-after"]) || 60;
      keyCooldownUntil[idx] = Date.now() + secs * 1000; // daily cap = hours; per-min = seconds
      groqIdx = (idx + 1) % groqClients.length;
      log.warn(`Groq key ${idx + 1}/${groqClients.length} 429 (cooldown ${secs}s) — rotating to next key`);
    }
  }
  throw lastErr || new Error("all Groq keys are rate-limited");
}

const hasFallback = () => !!env.openrouterApiKey;

// OpenRouter takes the same OpenAI-shaped body, but groq-sdk hardcodes Groq's
// "/openai/v1/..." path so it CANNOT just be pointed at OpenRouter via baseURL
// (that 404s). Plain fetch instead — same as the Meta/Twilio calls elsewhere.
// Returns the OpenAI-shaped JSON, so callers read res.choices[0].message as usual.
async function openrouterChat(params) {
  const res = await fetch(`${env.openrouterBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.openrouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...params, model: env.openrouterModel }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Shape the error like the SDK's so statusOf()/backoffMs() work on it too.
    const err = new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    err.headers = Object.fromEntries(res.headers.entries());
    throw err;
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const statusOf = (e) => e?.status ?? e?.response?.status;
// 429 (rate limit) and 5xx are worth another go; a 4xx is a bad request that
// won't fix itself on retry.
const isRetryable = (s) => s === 429 || (s >= 500 && s < 600);

// A 429 is a per-MINUTE window — a 500ms nap is useless, we have to let the
// window roll over. Honour Retry-After when the provider sends one.
function backoffMs(e, attempt) {
  const retryAfter = Number(e?.headers?.["retry-after"]);
  if (retryAfter) return Math.min(retryAfter * 1000, 30000);
  return statusOf(e) === 429 ? [5000, 20000][attempt - 1] ?? 20000 : 500 * attempt;
}

// A per-DAY quota 429 (Groq TPD) sends a Retry-After of hours — retrying is
// pointless and just hangs the customer. Treat any wait longer than this as
// "come back tomorrow": don't retry, fail fast so the fallback/caller moves on.
const MAX_SANE_RETRY_SEC = 120;
const isExhausted = (e) => Number(e?.headers?.["retry-after"]) > MAX_SANE_RETRY_SEC;

async function callWithRetry(label, makeCall, tries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await makeCall();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(statusOf(e))) throw e;
      // Daily quota blown (reset hours away) — retrying won't help, bail now.
      if (isExhausted(e)) { log.warn(`${label} ${statusOf(e)}: quota exhausted (reset far away) — not retrying`); throw e; }
      if (attempt < tries) {
        const wait = backoffMs(e, attempt);
        log.warn(`${label} ${statusOf(e)} (attempt ${attempt}/${tries}): ${e.message} — retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

// One caller per customer message. Tries the Groq key pool first (rotating keys
// on 429); if every key is rate-limited, switches to OpenRouter for the rest of
// this message. Order: Groq pool → OpenRouter → (last resort) Groq pool again.
function makeChatCaller() {
  const or = hasFallback();
  let useFallback = false;

  const openrouter = (p) => callWithRetry("OpenRouter", () => openrouterChat(p));

  return async function chat(params) {
    // Already switched to OpenRouter earlier in this message.
    if (useFallback) {
      try { return await openrouter(params); }
      catch (e) {
        // OpenRouter also down (e.g. 402 out of credit) — try the Groq pool once
        // more (a key's per-minute window may have rolled over) rather than erroring.
        log.warn(`OpenRouter ${statusOf(e)} down — last resort: Groq key pool`);
        return await callGroqPooled(params);
      }
    }
    try {
      return await callGroqPooled(params); // sweeps all Groq keys, rotating on 429
    } catch (e) {
      if (!or) throw e; // no fallback configured → surface the error
      log.warn(`All Groq keys unavailable (${statusOf(e) || "?"}) — switching to OpenRouter (${env.openrouterModel})`);
      useFallback = true;
      try { return await openrouter(params); }
      catch (e2) {
        log.warn(`OpenRouter ${statusOf(e2)} down — last resort: Groq key pool`);
        return await callGroqPooled(params);
      }
    }
  };
}

// ---- session state (reuses intake_sessions; data = { history, ticketId, customerId }) ----
async function getActiveSession(phone) {
  const { data } = await supabase
    .from("intake_sessions").select("*")
    .eq("phone", phone).neq("state", "COMPLETED")
    .order("created_at", { ascending: false }).maybeSingle();
  return data;
}

async function createSession(phone) {
  const { data, error } = await supabase
    .from("intake_sessions")
    .insert({ phone, state: "AWAITING_NAME", data: { history: [], ticketId: null, customerId: null } })
    .select().single();
  if (error) throw new Error("createSession: " + error.message);
  return data;
}

async function saveSession(id, patch) {
  const { error } = await supabase.from("intake_sessions").update(patch).eq("id", id);
  if (error) log.error("saveSession failed:", error.message);
}

// Main entry — returns the reply string the webhook sends to the customer.
export async function runAgent({ fromPhone, text }) {
  const phone = normalizePhone(fromPhone);
  const userText = (text || "").trim();

  const session = (await getActiveSession(phone)) || (await createSession(phone));
  const data = session.data || { history: [], ticketId: null, customerId: null };
  const history = data.history || [];
  const ctx = { phone, ticketId: data.ticketId || null, customerId: data.customerId || null };

  // Brand-new chat + a bare greeting → send the fixed opening verbatim, no LLM.
  // Guarantees the full 4-point message (the model was dropping line 4).
  // BUT skip this shortcut when the customer already has a logged request — it
  // bypasses the LLM (so identify_customer never runs) and would ask a customer
  // whose request the service team already filed for their name/issue/address again.
  if (!history.length && isBareGreeting(userText) && !(await hasLoggedRequest(phone))) {
    await saveSession(session.id, {
      state: session.state,
      data: {
        history: [{ role: "user", content: userText }, { role: "assistant", content: OPENING }],
        ticketId: ctx.ticketId, customerId: ctx.customerId,
      },
    });
    return OPENING;
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText || "(no text)" },
  ];

  let reply = "";
  const chat = makeChatCaller(); // Groq → OpenRouter fallback, per message
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await chat({
        model: env.groqModel,
        messages,
        tools: TOOL_DEFS,
        tool_choice: "auto",
        temperature: 0, // intake should be consistent, not creative
        max_tokens: 1024,
      });

      const msg = res.choices?.[0]?.message;
      if (!msg) break;
      const calls = msg.tool_calls || [];

      // Keep the assistant turn (with tool_calls, so the tool results are valid).
      messages.push(
        calls.length
          ? { role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls }
          : { role: "assistant", content: msg.content ?? "" }
      );

      if (!calls.length) { reply = (msg.content || "").trim(); break; }

      for (const call of calls) {
        let args = {};
        try { args = JSON.parse(call.function?.arguments || "{}"); } catch { /* bad JSON → {} */ }
        const result = await executeTool(call.function?.name, args, ctx);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
  } catch (e) {
    // Surface WHY it failed (Groq 429 rate limit / 4xx bad request / 5xx outage),
    // otherwise this is an unexplainable "technical issue" in the customer's chat.
    const status = e?.status ?? e?.response?.status;
    const code = e?.error?.code ?? e?.code;
    log.error(
      `runAgent error${status ? ` [HTTP ${status}]` : ""}${code ? ` (${code})` : ""} for ${phone}: ${e.message}`
    );
    return "Sorry, there was a technical issue. Please send your message again.";
  }

  // If the request was submitted, send the exact approved confirmation verbatim
  // (the model is unreliable at reproducing multi-line text — don't let it try).
  if (ctx.confirmation) reply = ctx.confirmation;

  // Safety net: whenever the model produces the opening greeting it tends to drop
  // a line (e.g. the purifier-photo point). If the reply looks like the opening,
  // replace it with the canonical OPENING so every listed point is always present.
  // Works even when the bare-greeting short-circuit above was skipped (e.g. an
  // existing session with history).
  if (looksLikeOpening(reply)) reply = OPENING;

  if (!reply) reply = "Could you share a bit more so I can help?";

  // Persist a clean transcript (no tool plumbing) + the active ticket/customer.
  const newHistory = [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: reply },
  ].slice(-MAX_HISTORY);

  await saveSession(session.id, {
    state: ctx.submitted ? "COMPLETED" : session.state,
    data: { history: newHistory, ticketId: ctx.ticketId, customerId: ctx.customerId },
  });

  return reply;
}
