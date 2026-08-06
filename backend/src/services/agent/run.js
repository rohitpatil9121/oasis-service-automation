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
import { ACTIVE_TOOL_DEFS } from "./tools.js";
import { executeTool } from "./executor.js";
import { getLatestTicketByCustomerPhone } from "../tickets.js";
import { SYSTEM_PROMPT, OPENING, OFF_TOPIC_REPLY } from "./prompt.js";

const isOpenStatus = (s) => s && s !== "CLOSED" && s !== "CANCELLED";

/* True when we already hold this customer's details, so the generic
   "share your name / issue / address" opening would be wrong.

   Two cases count:
     - a FINALISED open request (e.g. one the service team logged for them)
     - a saved name on the customer record, from any past job

   The second case used to be missing, and it read badly: a repeat customer whose
   last job had closed said "hi" and got asked for their name and address all over
   again, as though we had never served them. Letting the model handle it instead
   means it calls identify_customer and confirms what we have. */
async function hasSavedDetails(phone) {
  try {
    const [{ data: cust }, latest] = await Promise.all([
      supabase.from("customers").select("full_name").eq("phone", phone).maybeSingle(),
      getLatestTicketByCustomerPhone(phone),
    ]);
    if (cust?.full_name) return true;
    return !!(latest && isOpenStatus(latest.status) && latest.intake_complete);
  } catch (e) {
    log.error("hasSavedDetails:", e.message);
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

/* Safety cap on tool round-trips per message. Each step re-sends prompt+tools, so
   a lower number is cheaper — but this was briefly cut to 3 and that broke real
   intakes: a message carrying name + issue + address legitimately needs
   create_or_get_request, save_customer_details and update_request, which used the
   entire budget and left no turn in which to reply. Correctness wins; the extra
   steps are only consumed on turns that genuinely need them. */
const MAX_STEPS = 5;
const MAX_HISTORY = 12; // turns of clean transcript kept for context (trimmed to ease Groq's per-minute token limit)

// Hard ceiling on how long ONE customer message may spend in the agent loop.
// Without this there is no upper bound at all: MAX_STEPS sequential calls, each
// with its own retries, could stack into minutes while the customer waits. When
// the deadline passes we stop and send HOLDING_REPLY so a manager picks it up.
const AGENT_DEADLINE_MS = parseInt(process.env.AGENT_DEADLINE_MS || "30000", 10);
// Per-request timeout handed to the provider, so a single hung call can't eat
// the whole budget on its own.
const CALL_TIMEOUT_MS = parseInt(process.env.AGENT_CALL_TIMEOUT_MS || "15000", 10);

const HOLDING_REPLY = "One moment — our team is checking this and will reply here shortly.";
// Neutral "keep going" line, used when the model produced nothing usable.
const FALLBACK_REPLY = "Could you share a bit more so I can help?";

/* ---- Guardrails -------------------------------------------------------------

   The system prompt is the primary guardrail; these are the deterministic backstop
   for the two cases a prompt alone cannot be trusted with:

   1. INPUT — a message whose whole purpose is to override the prompt. Matching a
      handful of unambiguous jailbreak phrasings lets us answer without calling the
      model at all: cheaper, instant, and not dependent on the model holding the line.
      Kept deliberately narrow — these strings do not occur in a genuine service
      message, so a false positive would take real effort to produce. Anything
      subtler is left to the prompt's SCOPE section, which handles it in context.

   2. OUTPUT — the model leaking its instructions, or emitting markdown that renders
      as literal asterisks in WhatsApp. */

export const INJECTION_RE = new RegExp(
  [
    "ignore (all |any |the )?(previous|prior|above|earlier) (instruction|prompt|rule|message)",
    "disregard (all |any |the )?(previous|prior|above|earlier)",
    "forget (all |your |the )?(previous|prior|above|earlier|instruction|rule)",
    "(system|initial|original) prompt",
    "your (instructions|system message|rules|prompt)",
    "you are (now|no longer) (a|an|my)",
    "(developer|debug|god|dan) mode",
    "act as (a|an|my) (?!.*purifier)",
    "pretend (to be|you are)",
    "repeat (everything|the text) above",
  ].join("|"),
  "i"
);

/* The model's own instructions leaking into a customer-facing reply.

   The tool names are derived from ACTIVE_TOOL_DEFS rather than typed out: the
   hand-written list had drifted and was missing update_request, so a reply that
   narrated that particular call sailed straight through to the customer. */
const TOOL_NAMES = ACTIVE_TOOL_DEFS.map((t) => t.function.name).join("|");
export const PROMPT_LEAK_RE = new RegExp(
  `(SCOPE —|OUT OF SCOPE|SYSTEM_PROMPT|You are the WhatsApp assistant|tool call|${TOOL_NAMES})`,
  "i"
);

/* A half-emitted tool call — the model writing the JSON as prose instead of
   calling the tool. Seen live as:

     Please share your service address.
     "tool": "update_request",
     "arguments": { "address": "…

   The prose above it is a perfectly good reply, so cut from the JSON onwards
   rather than throwing the whole message away.

   Matched narrowly on purpose. An earlier draft also caught a bare "name:" at
   the start of a line, which would have silently truncated the perfectly normal
   reply that echoes a customer's details back to them ("Name: Amit Sharma").
   A key only counts as plumbing when it is JSON-quoted, or followed by a quote
   or brace the way a serialised call is. */
const TOOL_JSON_RE =
  /^\s*[{[]?\s*(?:"(?:tool|name|function|arguments|parameters|tool_calls|tool_call)"\s*:|(?:tool|function|arguments|parameters|tool_calls|tool_call)\s*:\s*["{[])/im;

export function stripToolJson(text) {
  const m = TOOL_JSON_RE.exec(text);
  if (!m) return text;
  return text.slice(0, m.index).trim();
}

const MAX_REPLY_CHARS = 900; // a service reply is 1-4 short lines; anything longer has drifted

/* Our internal board words, and what a customer should read instead.

   The bot greeted a returning customer with "Your request OG-300726-0004 is
   currently NEW" — accurate internally, meaningless to the person reading it,
   and it sounds like nothing has happened. The prompt now tells it not to
   volunteer status at all; this is the backstop for when it does, and it also
   cleans up the wording when the customer genuinely asks. Matched upper-case
   only, so ordinary prose ("a new filter") is untouched. */
const STATUS_WORDS = [
  [/\bIN[_ ]PROGRESS\b/g, "in progress"],
  [/\bis currently NEW\b/g, "is open"],
  [/\bNEW\b/g, "open"],
  [/\bPENDING\b/g, "open"],
  [/\bASSIGNED\b/g, "assigned"],
  [/\bCLOSED\b/g, "complete"],
  [/\bCANCELLED\b/g, "cancelled"],
];

// WhatsApp shows markdown asterisks literally, and the model slips into them despite
// the prompt. Strip formatting rather than let "**Ticket ID**" reach the customer.
export function sanitizeReply(text) {
  let t = (text || "")
    .replace(/```[\s\S]*?```/g, " ")     // code fences — never valid in a service reply
    .replace(/^#{1,6}\s+/gm, "")          // markdown headings
    .replace(/\*\*(.+?)\*\*/g, "$1")      // bold
    .replace(/(^|\s)\*(?!\s)(.+?)\*(?=\s|$)/g, "$1$2") // italics (not bullet "* ")
    .replace(/^\s*[*•]\s+/gm, "- ")       // bullet markers → plain dash
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  for (const [re, word] of STATUS_WORDS) t = t.replace(re, word);
  // NOTE: deliberately does NOT strip trailing spaces before newlines. The approved
  // OPENING uses them as fill-in blanks ("– Name: "), and eating them would silently
  // edit customer-facing copy for a purely cosmetic gain.
  if (t.length > MAX_REPLY_CHARS) t = t.slice(0, MAX_REPLY_CHARS).trimEnd() + "…";
  return t;
}

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
      return await groqClients[idx].chat.completions.create(params, { timeout: CALL_TIMEOUT_MS });
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
    // OpenRouter routes each call to one of several upstream hosts, and their
    // speeds differ a lot for the same model. Sorting by throughput biases routing
    // to the fastest available one — measured median for this prompt was ~5s with
    // default routing, and a slow route is what pushed a live call past the timeout
    // and needlessly failed us over to the free Groq tier.
    body: JSON.stringify({ ...params, model: env.openrouterModel, provider: { sort: "throughput" } }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
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

// Keep every wait short. This used to sleep 5s then 20s on a 429 to let a
// per-minute window roll over — but that ran INSIDE the step loop, so one
// message could stack 25s per step into minutes. The overall AGENT_DEADLINE_MS
// is the safety net now; a retry here is only worth it if it's quick, and a
// provider asking us to wait longer than that is handled as a miss, not a nap.
const MAX_BACKOFF_MS = 3000;
function backoffMs(e, attempt) {
  const retryAfter = Number(e?.headers?.["retry-after"]);
  if (retryAfter) return Math.min(retryAfter * 1000, MAX_BACKOFF_MS);
  return statusOf(e) === 429 ? MAX_BACKOFF_MS : 500 * attempt;
}

// A per-DAY quota 429 (Groq TPD) sends a Retry-After of hours — retrying is
// pointless and just hangs the customer. Treat any wait longer than this as
// "come back tomorrow": don't retry, fail fast so the fallback/caller moves on.
const MAX_SANE_RETRY_SEC = 120;
const isExhausted = (e) => Number(e?.headers?.["retry-after"]) > MAX_SANE_RETRY_SEC;

async function callWithRetry(label, makeCall, tries = 2) {
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

// Which provider to try FIRST. Groq is faster, but on its free 8K-TPM tier a
// single intake message blows the budget partway through, so EVERY message pays
// a 429 + backoff before falling through. When Groq is unpaid and OpenRouter is
// on a paid model, "openrouter" avoids that per-message tax. Flip back to "groq"
// once the Groq Developer tier is active.
const PRIMARY = (process.env.LLM_PRIMARY || "groq").toLowerCase() === "openrouter"
  ? "openrouter" : "groq";

// One caller per customer message. Tries PRIMARY first; on failure it switches to
// the other provider for the REST of this message (no point re-testing a provider
// that just rate-limited us mid-message), with the primary kept as a last resort.
function makeChatCaller() {
  const or = hasFallback();
  let switched = false;

  const openrouter = (p) => callWithRetry("OpenRouter", () => openrouterChat(p));
  const groq = (p) => callGroqPooled(p); // sweeps all Groq keys, rotating on 429

  // No OpenRouter key configured → Groq is the only option, whatever PRIMARY says.
  const orFirst = or && PRIMARY === "openrouter";
  const first = orFirst ? openrouter : groq;
  const second = orFirst ? groq : openrouter;
  const firstName = orFirst ? "OpenRouter" : "Groq";
  const secondName = orFirst ? "Groq" : "OpenRouter";

  return async function chat(params) {
    // Already switched to the secondary earlier in this message.
    if (switched) {
      try { return await second(params); }
      catch (e) {
        // Secondary also down (e.g. OpenRouter 402 out of credit, or every Groq
        // key cooling) — try the primary once more rather than erroring out.
        log.warn(`${secondName} ${statusOf(e)} down — last resort: ${firstName}`);
        return await first(params);
      }
    }
    try {
      return await first(params);
    } catch (e) {
      if (!or) throw e; // no fallback configured → surface the error
      // Include the message, not just the status: a client-side abort (our own
      // CALL_TIMEOUT_MS firing) has no HTTP status, so a bare "(?)" hides the most
      // useful case — the provider was merely slow, not down.
      log.warn(`${firstName} unavailable (${statusOf(e) || e?.name || "?"}: ${e?.message || "no detail"}) — switching to ${secondName}`);
      switched = true;
      try { return await second(params); }
      catch (e2) {
        log.warn(`${secondName} ${statusOf(e2)} down — last resort: ${firstName}`);
        return await first(params);
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
  // BUT skip it for anyone whose details we already hold — the shortcut bypasses
  // the LLM (so identify_customer never runs) and would ask a customer we have
  // served before for their name and address as if they were a stranger.
  if (!history.length && isBareGreeting(userText) && !(await hasSavedDetails(phone))) {
    await saveSession(session.id, {
      state: session.state,
      data: {
        history: [{ role: "user", content: userText }, { role: "assistant", content: OPENING }],
        ticketId: ctx.ticketId, customerId: ctx.customerId,
      },
    });
    return OPENING;
  }

  // Prompt-injection / prompt-extraction attempt → answer deterministically without
  // spending an LLM call. Still recorded in history so the thread reads correctly on
  // the dashboard and the model sees what was asked if the chat continues.
  if (INJECTION_RE.test(userText)) {
    log.warn(`[guardrail] injection attempt from ${phone}: ${userText.slice(0, 120)}`);
    await saveSession(session.id, {
      state: session.state,
      data: {
        history: [
          ...history,
          { role: "user", content: userText },
          { role: "assistant", content: OFF_TOPIC_REPLY },
        ].slice(-MAX_HISTORY),
        ticketId: ctx.ticketId, customerId: ctx.customerId,
      },
    });
    return OFF_TOPIC_REPLY;
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userText || "(no text)" },
  ];

  let reply = "";
  let timedOut = false;
  const deadline = Date.now() + AGENT_DEADLINE_MS;
  const chat = makeChatCaller(); // Groq → OpenRouter fallback, per message
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Out of time — stop here rather than starting another round-trip. Any
      // tool writes already made (customer details, issue) are persisted, so the
      // request isn't lost; we just stop composing and hand over to a human.
      if (Date.now() > deadline) {
        timedOut = true;
        log.warn(`runAgent deadline (${AGENT_DEADLINE_MS}ms) hit at step ${step} for ${phone} — sending holding reply`);
        break;
      }
      const res = await chat({
        model: env.groqModel,
        messages,
        tools: ACTIVE_TOOL_DEFS,
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

    /* The step budget can be spent entirely on tool calls, leaving no turn in which
       to actually say anything — observed on a real intake message that triggered
       create_or_get_request, save_customer_details and update_request back to back.
       The tool writes all succeeded, but the customer would have received the generic
       "Could you share a bit more so I can help?" right after describing their problem.

       One more call with tool_choice "none" forces a natural-language reply from the
       state the tools just produced. Skipped when a canonical reply is already
       decided (submit/cancel set ctx.confirmation and it is sent verbatim). */
    if (!reply && !ctx.confirmation && !timedOut && Date.now() < deadline) {
      log.info(`step budget spent on tools for ${phone} — forcing a text reply`);
      const res = await chat({
        model: env.groqModel,
        // `tools` must still be sent: the history contains tool_call/tool messages,
        // and providers reject a request that references tools it wasn't given.
        // tool_choice "none" is what actually blocks another call.
        messages: [
          ...messages,
          {
            role: "system",
            content:
              "Write the WhatsApp reply to the customer now, based on what the tools " +
              "returned. Plain text only. Never mention tools, function names or what " +
              "you are about to do — the customer must not see any of that. If details " +
              "are still missing, ask only for those in one short line.",
          },
        ],
        tools: ACTIVE_TOOL_DEFS,
        tool_choice: "none",
        temperature: 0,
        max_tokens: 300,
      });
      reply = (res.choices?.[0]?.message?.content || "").trim();
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

  // Output guardrail. Runs BEFORE the canonical-text substitutions below so it can
  // never mangle the approved confirmation or OPENING wording.
  // Cut any JSON tool-call the model wrote out as prose, keeping the sentence
  // above it. Done first so a good reply with plumbing stuck on the end is
  // rescued instead of being replaced wholesale by the fallback below.
  const cut = stripToolJson(reply);
  if (cut !== reply) {
    log.warn(`[guardrail] tool JSON stripped from reply to ${phone}: ${reply.slice(0, 140)}`);
    reply = cut;
  }

  if (reply && PROMPT_LEAK_RE.test(reply)) {
    // NOT the off-topic line: a leak usually happens mid-intake, where telling a
    // customer "I only handle purifier service" is both wrong and confusing. Fall
    // back to the neutral prompt-for-more so the conversation can continue.
    log.warn(`[guardrail] prompt leak suppressed in reply to ${phone}: ${reply.slice(0, 120)}`);
    reply = FALLBACK_REPLY;
  } else {
    reply = sanitizeReply(reply);
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

  if (!reply) reply = timedOut ? HOLDING_REPLY : FALLBACK_REPLY;

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
