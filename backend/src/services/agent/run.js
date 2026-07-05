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
import { SYSTEM_PROMPT, OPENING } from "./prompt.js";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Groq (like any hosted LLM) occasionally returns a transient 429/5xx or drops
// the connection. A single failure otherwise surfaces to the customer as the
// "technical issue, send again" message — so retry a couple of times with a
// short backoff before giving up. A 4xx (bad request) won't fix on retry, so we
// fail fast on those.
async function chatWithRetry(params, tries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await groq().chat.completions.create(params);
    } catch (e) {
      lastErr = e;
      const status = e?.status ?? e?.response?.status;
      if (status && status >= 400 && status < 500 && status !== 429) throw e;
      if (attempt < tries) {
        log.warn(`Groq call failed (attempt ${attempt}/${tries}): ${e.message} — retrying`);
        await sleep(500 * attempt);
      }
    }
  }
  throw lastErr;
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
  if (!history.length && isBareGreeting(userText)) {
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
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await chatWithRetry({
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
    log.error("runAgent error:", e.message);
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
