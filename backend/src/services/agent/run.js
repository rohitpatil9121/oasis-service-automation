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
// On a brand-new chat we answer these with the fixed OPENING verbatim so all four
// numbered lines (incl. the purifier photo) always appear; the LLM drops them.
const GREETING_RE = /^(hi+|hey+|hello+|helo|hlo|namaste|namaskar|good\s*(morning|afternoon|evening)|start|service|enquiry|inquiry)[\s!.,]*$/i;
const isBareGreeting = (t) => GREETING_RE.test((t || "").trim());

// True when the model's reply is (a variant of) the opening greeting — used to
// force the canonical OPENING so no numbered line is ever dropped.
const looksLikeOpening = (t) =>
  /oasis globe water purifier service support/i.test(t || "") && /please share/i.test(t || "");

const MAX_STEPS = 6;    // safety cap on tool round-trips per message
const MAX_HISTORY = 20; // turns of clean transcript kept for context

let client = null;
const groq = () => (client ||= new Groq({ apiKey: env.groqApiKey }));

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

async function callWithRetry(label, makeCall, tries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await makeCall();
    } catch (e) {
      lastErr = e;
      if (!isRetryable(statusOf(e))) throw e;
      if (attempt < tries) {
        const wait = backoffMs(e, attempt);
        log.warn(`${label} ${statusOf(e)} (attempt ${attempt}/${tries}): ${e.message} — retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

// One caller per customer message. Starts on Groq; the moment Groq rate-limits,
// this message switches to OpenRouter for ALL its remaining tool steps — retrying
// Groq on every step would just burn another 429 and add seconds of latency.
function makeChatCaller() {
  const or = hasFallback();
  let useFallback = false;

  return async function chat(params) {
    if (!useFallback) {
      try {
        // With a fallback available, don't waste time retrying Groq — switch.
        return await callWithRetry("Groq", () => groq().chat.completions.create(params), or ? 1 : 3);
      } catch (e) {
        if (!or || !isRetryable(statusOf(e))) throw e;
        log.warn(`Groq ${statusOf(e)} — switching to OpenRouter (${env.openrouterModel}) for this message`);
        useFallback = true;
      }
    }
    return callWithRetry("OpenRouter", () => openrouterChat(params));
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
  // replace it with the canonical OPENING so all four points are always present.
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
