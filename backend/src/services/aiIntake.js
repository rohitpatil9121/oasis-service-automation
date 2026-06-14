// AI-powered WhatsApp intake (Groq LLM). Natural conversation that collects
// name, address and issue, then creates a tracked ticket. The customer's
// phone comes from their WhatsApp number, so the agent never has to ask.
//
// Enabled with AI_INTAKE=true (+ GROQ_API_KEY). Falls back to a friendly
// retry message if the LLM is unavailable, and the raw inbound is always
// logged first (in the webhook), so no inquiry is ever lost.
import { supabase } from "../config/supabase.js";
import { getAIResponse } from "./ai.js";
import {
  upsertCustomerByPhone, createDraftTicket, updateTicketIntake, completeIntake,
  getLatestTicketByCustomerPhone,
} from "./tickets.js";
import { normalizePhone } from "../lib/phone.js";
import { log } from "../lib/logger.js";

const RESET_WORDS = ["restart", "reset", "start over", "cancel"];
const STATUS_WORDS = ["status", "track"];
const MAX_HISTORY = 20; // keep the last N turns sent to the model

const GREETING =
  "👋 Welcome to *Oasis Globe Service*! I'm here to help you raise a service " +
  "request. To get started, may I know your *name*?";

const AGENT_INTRO =
  `You are a warm, helpful WhatsApp service agent for "Oasis Globe", a water purifier & ` +
  `appliance service company in India. You already have the customer's phone number from ` +
  `WhatsApp — never ask for it.\n\n` +
  `Hold a NATURAL conversation: actually read and ANSWER whatever the customer says or asks. ` +
  `If they ask you a question (e.g. "do you want the purifier type/model?"), answer it ` +
  `helpfully ("Yes please — the brand/model and what's going wrong will help us send the ` +
  `right technician!") instead of ignoring it or repeating the same request word-for-word. ` +
  `Acknowledge what they just said, then gently continue. Keep replies short and friendly.`;

// The agent's instructions. For RETURNING customers we already have name+address,
// so the agent confirms them (and only re-captures what changed) instead of asking
// from scratch. Current collected state is injected each turn.
function systemPrompt(collected, returning) {
  if (returning) {
    return `
${AGENT_INTRO}

This is a RETURNING customer — we already have their details on file:
- name: ${collected.name || "(not on file)"}
- address: ${collected.address || "(not on file)"}
- appliance: ${collected.appliance || "(not on file)"}

Greet them warmly BY NAME. Do NOT ask for their name or address from scratch — instead
briefly confirm the name and address above are still correct, ask what issue they're facing
today, and which water purifier it is (brand/model) if not on file.

EVERY reply MUST be a single JSON object with exactly these two keys: {"fields": { ... }, "message": "..."}

"fields" — include ONLY new or changed details:
- "issue": their problem (required) — the symptoms / what's wrong.
- "appliance": which water purifier it is — brand + model (e.g. "Kent RO", "Aquaguard UV"). Ask for this if not on file.
- "name": ONLY if they say their name has changed.
- "address": ONLY if they give a new/changed address.
- Use {} if nothing new was provided.

"message" — short, warm, WhatsApp style. Confirm the details on file, ask for the issue and
the purifier brand/model. When you have the issue, thank them and say it's being registered.

Return ONLY the JSON object. No markdown.

Example — "hi": {"fields":{},"message":"Hi ${collected.name || "there"}! Welcome back 😊 Address still ${collected.address || "—"}? What issue are you facing, and which purifier is it (brand/model)?"}
Example — "yes same, Kent RO not working": {"fields":{"issue":"purifier not working","appliance":"Kent RO"},"message":"Thanks ${collected.name || ""}! Registering your request now. 🙏"}
`.trim();
  }

  return `
${AGENT_INTRO}

Collect FOUR details: the customer's name, their address (for the technician visit), the issue
(what's wrong), and the appliance — which water purifier it is (brand + model).

Already collected (do NOT ask for these again):
- name: ${collected.name || "(missing)"}
- address: ${collected.address || "(missing)"}
- issue: ${collected.issue || "(missing)"}
- appliance: ${collected.appliance || "(missing)"}

EVERY reply MUST be a single JSON object with exactly these two keys, in this order:
{"fields": { ... }, "message": "..."}

Building "fields" (the extracted data):
- Pull any name / address / problem / purifier detail the customer mentions into "name" / "address" / "issue" / "appliance".
- "issue" = the symptoms / what's wrong (e.g. "water leaking", "low flow", "not working").
- "appliance" = the water purifier brand + model (e.g. "Kent RO", "Aquaguard UV", "Pureit"). Always ask which purifier it is.
- REQUIRED: whenever the message contains one of these, the matching key MUST appear in "fields". Never leave "fields" empty when the customer gave real details.
- Use "fields": {} only when they gave nothing new (just a greeting or a question).

Building "message":
- A short, warm WhatsApp reply (emojis ok). Answer any question they asked.
- Then ask only for whichever of name / address / issue / purifier brand-model is still missing.
- When you have the name, address and issue, thank them and say their request is being registered.

Return ONLY the JSON object. No markdown, no extra text.

Example — "hi I'm Sunil Kale, my Kent RO is leaking badly, I live at 12 Shivaji Nagar Pune 411005": {"fields":{"name":"Sunil Kale","issue":"RO purifier leaking badly","appliance":"Kent RO","address":"12 Shivaji Nagar, Pune 411005"},"message":"Thanks Sunil! Registering your request now. 🙏"}
Example — "my purifier is not working": {"fields":{"issue":"purifier not working"},"message":"Sorry to hear that! 🙏 May I know your name, address, and which purifier it is (brand/model)?"}
Example — "it's an Aquaguard": {"fields":{"appliance":"Aquaguard"},"message":"Got it — Aquaguard. 👍 And your name and address for the technician visit?"}
`.trim();
}

// ---------- session persistence (reuses the intake_sessions table) ----------
// data shape for AI mode: { collected: {name,address,issue}, history: [{role,content}] }

async function getActiveSession(phone) {
  const { data } = await supabase
    .from("intake_sessions").select("*")
    .eq("phone", phone).neq("state", "COMPLETED")
    .order("created_at", { ascending: false }).maybeSingle();
  return data;
}

// Look up an existing customer by their WhatsApp number (returning customer).
async function getCustomerByPhone(phone) {
  const { data } = await supabase
    .from("customers").select("full_name, address")
    .eq("phone", phone).maybeSingle();
  return data;
}

// Build the starting session data. For a returning customer we pre-fill their
// name + address so the agent confirms them instead of re-asking; if they say
// something changed, the new value flows through to the customer record on save.
async function buildInitialData(phone) {
  const existing = await getCustomerByPhone(phone);
  if (existing && existing.full_name) {
    const collected = { name: existing.full_name };
    if (existing.address) collected.address = existing.address;
    return { collected, history: [], returning: true };
  }
  return { collected: {}, history: [], returning: false };
}

async function createSession(phone, initialData) {
  const data = initialData || { collected: {}, history: [], returning: false };
  const { data: row, error } = await supabase
    .from("intake_sessions")
    .insert({ phone, state: "AWAITING_NAME", data })
    .select().single();
  if (error) throw new Error("createSession: " + error.message);
  return row;
}

async function saveSession(id, patch) {
  const { error } = await supabase.from("intake_sessions").update(patch).eq("id", id);
  if (error) throw new Error("saveSession: " + error.message);
}

// ---------- function-call parsing ----------

// Merge any newly-provided fields from the model's "fields" object into the
// collected state. Only accepts the three known string fields.
function mergeFields(collected, fields) {
  if (!fields || typeof fields !== "object") return;
  for (const key of ["name", "address", "issue", "appliance"]) {
    if (typeof fields[key] === "string" && fields[key].trim()) {
      collected[key] = fields[key].trim();
    }
  }
}

function statusReply(ticket) {
  const lines = [
    `🎫 Your latest request: *${ticket.ticket_number}*`,
    `Status: *${ticket.status}*`,
  ];
  if (ticket.technician) lines.push(`Technician: ${ticket.technician.full_name}`);
  else if (ticket.status === "NEW") lines.push("A technician will be assigned shortly.");
  return lines.join("\n");
}

// ---------- main entry ----------

export async function handleInboundAI({ fromPhone, text }) {
  const phone = normalizePhone(fromPhone);
  const body = (text || "").trim();
  const lower = body.toLowerCase();

  // Global reset.
  if (RESET_WORDS.includes(lower)) {
    const active = await getActiveSession(phone);
    if (active) await saveSession(active.id, { state: "COMPLETED" });
    const initial = await buildInitialData(phone);
    await createSession(phone, initial);
    if (initial.returning) {
      return `🔄 Sure, ${initial.collected.name}! Let's raise a new request. ` +
             `I have your address as *${initial.collected.address || "—"}*. ` +
             `Is your name and address still the same, and what issue are you facing today?`;
    }
    return GREETING;
  }

  let session = await getActiveSession(phone);

  // "status" outside an active intake -> report the latest ticket.
  if (!session && STATUS_WORDS.includes(lower)) {
    const ticket = await getLatestTicketByCustomerPhone(phone);
    if (ticket) return statusReply(ticket);
    return "You don't have any service requests yet.\n\n" + GREETING;
  }

  if (!session) session = await createSession(phone, await buildInitialData(phone));

  const collected = session.data?.collected || {};
  const history = session.data?.history || [];
  const returning = session.data?.returning || false;

  // Create the dashboard request on the very FIRST message so the Service Manager
  // can watch it fill in live as the customer shares details.
  if (!session.ticket_id) {
    try {
      const customer = await upsertCustomerByPhone(phone, { full_name: collected.name, address: collected.address });
      const ticket = await createDraftTicket({ customerId: customer.id });
      session.customer_id = customer.id;
      session.ticket_id = ticket.id;
      await saveSession(session.id, { customer_id: customer.id, ticket_id: ticket.id });
      log.info(`Draft request created for ${phone} -> ${ticket.ticket_number}`);
    } catch (e) { log.error("draft creation failed:", e.message); }
  }

  // Build the model context: fresh system prompt + recent turns + new message.
  const messages = [
    { role: "system", content: systemPrompt(collected, returning) },
    ...history.slice(-MAX_HISTORY),
    { role: "user", content: body },
  ];

  let reply;
  try {
    const raw = await getAIResponse(messages);
    const parsed = JSON.parse(raw);
    reply = (parsed.message || "").trim();

    mergeFields(collected, parsed.fields);
  } catch (e) {
    log.error("AI intake error:", e.message);
    // Don't lose the turn — ask the customer to resend. Inbound is already logged.
    return "Sorry, I had a small hiccup 🤖. Could you please send that again?";
  }

  if (!reply) reply = "Could you tell me a bit more?";

  // Persist the conversation (store readable assistant text, not raw JSON).
  history.push({ role: "user", content: body });
  history.push({ role: "assistant", content: reply });

  // Live-update the request with whatever we have so far (shows on the dashboard).
  try {
    await upsertCustomerByPhone(phone, { full_name: collected.name, address: collected.address });
    if (session.ticket_id) await updateTicketIntake(session.ticket_id, { issue: collected.issue, appliance: collected.appliance });
  } catch (e) { log.error("live intake update failed:", e.message); }

  // Required fields all in -> finalise once (alerts + customer confirmation).
  const complete = collected.name && collected.address && collected.issue;
  if (complete && session.ticket_id && !session.data?.completed) {
    try {
      const ticket = await completeIntake(session.ticket_id);
      await saveSession(session.id, { state: "COMPLETED", data: { collected, history, returning, completed: true } });
      log.info(`AI intake complete for ${phone} -> ${ticket.ticket_number}`);
      return `${reply}\n\n✅ Your request is logged. Ticket ID: *${ticket.ticket_number}*.\n` +
             `You'll get a WhatsApp update when a technician is assigned.\n` +
             `(Send *status* anytime to check it.)`;
    } catch (e) {
      log.error("completeIntake failed:", e.message);
      await saveSession(session.id, { data: { collected, history, returning } });
      return reply;
    }
  }

  await saveSession(session.id, { data: { collected, history, returning } });
  return reply;
}
