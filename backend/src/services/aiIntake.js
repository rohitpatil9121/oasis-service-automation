// AI-powered WhatsApp intake (Groq LLM). Natural conversation that collects
// name, address and issue, then creates a tracked ticket. The customer's
// phone comes from their WhatsApp number, so the agent never has to ask.
//
// Enabled with AI_INTAKE=true (+ GROQ_API_KEY). Falls back to a friendly
// retry message if the LLM is unavailable, and the raw inbound is always
// logged first (in the webhook), so no inquiry is ever lost.
import { supabase } from "../config/supabase.js";
import { getAIResponse } from "./ai.js";
import { createTicket, getLatestTicketByCustomerPhone } from "./tickets.js";
import { normalizePhone } from "../lib/phone.js";
import { log } from "../lib/logger.js";

const RESET_WORDS = ["restart", "reset", "start over", "cancel"];
const STATUS_WORDS = ["status", "track"];
const MAX_HISTORY = 20; // keep the last N turns sent to the model

const GREETING =
  "👋 Welcome to *Oasis Globe Service*! I'm here to help you raise a service " +
  "request. To get started, may I know your *name*?";

// The agent's instructions. Current collected state is injected each turn so
// the model knows what's already captured and what's still missing.
function systemPrompt(collected) {
  return `
You are a friendly WhatsApp intake agent for "Oasis Globe", a water purifier & appliance service company in India.

You must collect three details: the customer's name, their address (for the technician visit), and the issue (what's wrong). You already have their phone number from WhatsApp — never ask for it.

Already collected (do NOT ask for these again):
- name: ${collected.name || "(missing)"}
- address: ${collected.address || "(missing)"}
- issue: ${collected.issue || "(missing)"}

EVERY reply MUST be a single JSON object with exactly these two keys, in this order:
{"fields": { ... }, "message": "..."}

Building "fields" (the extracted data — this is the important part):
- Read the customer's latest message and pull out any name, address, or issue they mention.
- Put each one into "fields" using the keys "name", "address", and/or "issue".
- REQUIRED: if the message contains a name, an address, or an issue, the matching key MUST appear in "fields" with its value. Never leave "fields" empty when the customer gave details. The real data goes in "fields", NOT just in the message.
- If the customer truly gave nothing new, use "fields": {}.

Building "message":
- A short, warm WhatsApp-style reply (emojis ok).
- Ask for whichever of name / address / issue is still missing.
- If all three are now known, thank them and say their request is being registered.

Return ONLY the JSON object. No markdown, no extra text.

Example — customer: "hi I'm Sunil Kale, my RO purifier is leaking badly, I live at 12 Shivaji Nagar Pune 411005"
You return: {"fields":{"name":"Sunil Kale","issue":"RO purifier leaking badly","address":"12 Shivaji Nagar, Pune 411005"},"message":"Thanks Sunil! I've got your details — registering your request now. 🙏"}

Example — customer: "my AC is not cooling"
You return: {"fields":{"issue":"AC not cooling"},"message":"Sorry to hear that! May I know your name and address?"}

Example — customer: "Rohit"
You return: {"fields":{"name":"Rohit"},"message":"Thanks Rohit! What issue are you facing, and your address?"}

Example — customer: "ok thanks"
You return: {"fields":{},"message":"You're welcome! Could you share your address so we can send a technician?"}
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

async function createSession(phone) {
  const { data, error } = await supabase
    .from("intake_sessions")
    .insert({ phone, state: "AWAITING_NAME", data: { collected: {}, history: [] } })
    .select().single();
  if (error) throw new Error("createSession: " + error.message);
  return data;
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
  for (const key of ["name", "address", "issue"]) {
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
    await createSession(phone);
    return GREETING;
  }

  let session = await getActiveSession(phone);

  // "status" outside an active intake -> report the latest ticket.
  if (!session && STATUS_WORDS.includes(lower)) {
    const ticket = await getLatestTicketByCustomerPhone(phone);
    if (ticket) return statusReply(ticket);
    return "You don't have any service requests yet.\n\n" + GREETING;
  }

  if (!session) session = await createSession(phone);

  const collected = session.data?.collected || {};
  const history = session.data?.history || [];

  // Build the model context: fresh system prompt + recent turns + new message.
  const messages = [
    { role: "system", content: systemPrompt(collected) },
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

  // All three fields collected -> create the ticket once.
  const complete = collected.name && collected.address && collected.issue;
  if (complete && !session.ticket_id) {
    try {
      const ticket = await createTicket({
        customer: { full_name: collected.name, phone, address: collected.address },
        issue_description: collected.issue,
        source: "whatsapp",
      });
      await saveSession(session.id, {
        state: "COMPLETED",
        data: { collected, history },
        customer_id: ticket.customer.id,
        ticket_id: ticket.id,
      });
      log.info(`AI intake complete for ${phone} -> ${ticket.ticket_number}`);
      return `${reply}\n\n✅ Your request is logged. Ticket ID: *${ticket.ticket_number}*.\n` +
             `You'll get a WhatsApp update when a technician is assigned.\n` +
             `(Send *status* anytime to check it.)`;
    } catch (e) {
      log.error("AI intake ticket creation failed:", e.message);
      // Keep the session open so the next message can retry.
      await saveSession(session.id, { data: { collected, history } });
      return "I've got all your details — just finishing up registering your request. " +
             "Please send any message to confirm.";
    }
  }

  await saveSession(session.id, { data: { collected, history } });
  return reply;
}
