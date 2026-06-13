// WhatsApp AI intake flow - a deterministic conversation state machine.
// Collects mandatory fields IN ORDER: name -> phone -> address -> issue.
// A request can NEVER be completed until all four are captured & valid.
import { supabase } from "../config/supabase.js";
import { createTicket, getLatestTicketByCustomerPhone } from "./tickets.js";
import { normalizePhone, isValidPhone } from "../lib/phone.js";
import { log } from "../lib/logger.js";

const GREETING =
  "👋 Welcome to *Oasis Globe Service*!\n" +
  "I'll help you raise a service request. It takes under a minute.\n\n" +
  "First, what is your *full name*?";

const RESET_WORDS = ["restart", "reset", "start over", "cancel"];
const STATUS_WORDS = ["status", "track"];

function statusReply(ticket) {
  const lines = [
    `🎫 Your latest request: *${ticket.ticket_number}*`,
    `Status: *${ticket.status}*`,
  ];
  if (ticket.technician) lines.push(`Technician: ${ticket.technician.full_name}`);
  else if (ticket.status === "NEW") lines.push("A technician will be assigned shortly.");
  return lines.join("\n");
}

// Field order + the prompt shown when we ENTER that state.
const PROMPTS = {
  AWAITING_NAME:    "Please share your *full name*.",
  AWAITING_PHONE:   "Thanks! What's the best *contact phone number*? (with country code if possible)",
  AWAITING_ADDRESS: "Got it. What's the *service address*? (house/area/city)",
  AWAITING_ISSUE:   "Last step - briefly *describe the issue* you're facing.",
};

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
    .insert({ phone, state: "AWAITING_NAME", data: {} })
    .select().single();
  if (error) throw new Error("createSession: " + error.message);
  return data;
}

async function updateSession(id, patch) {
  const { data, error } = await supabase
    .from("intake_sessions").update(patch).eq("id", id).select().single();
  if (error) throw new Error("updateSession: " + error.message);
  return data;
}

// Main entry: given an inbound WhatsApp message, return the reply text.
// `fromPhone` is the WhatsApp sender (used to prefill the phone field).
export async function handleInbound({ fromPhone, text }) {
  const phone = normalizePhone(fromPhone);
  const body = (text || "").trim();
  const lower = body.toLowerCase();

  // Global reset.
  if (RESET_WORDS.includes(lower)) {
    const active = await getActiveSession(phone);
    if (active) await updateSession(active.id, { state: "COMPLETED" }); // close stale
    await createSession(phone);
    return GREETING;
  }

  let session = await getActiveSession(phone);

  // "status" / "track" outside an active intake -> report the latest ticket.
  if (!session && STATUS_WORDS.includes(lower)) {
    const ticket = await getLatestTicketByCustomerPhone(phone);
    if (ticket) return statusReply(ticket);
    return "You don't have any service requests yet.\n\n" + GREETING;
  }

  // No active session -> greet and begin.
  if (!session) {
    session = await createSession(phone);
    return GREETING;
  }

  const data = session.data || {};

  switch (session.state) {
    case "AWAITING_NAME": {
      if (body.length < 2)
        return "I need your name to continue. " + PROMPTS.AWAITING_NAME;
      data.name = body;
      await updateSession(session.id, { state: "AWAITING_PHONE", data });
      // Offer the WhatsApp number as a quick default.
      return `Nice to meet you, ${body}!\n` + PROMPTS.AWAITING_PHONE +
             `\n(Reply *same* to use this WhatsApp number ${phone}.)`;
    }

    case "AWAITING_PHONE": {
      const candidate = lower === "same" ? phone : body;
      if (!isValidPhone(candidate))
        return "That doesn't look like a valid number. " + PROMPTS.AWAITING_PHONE;
      data.phone = normalizePhone(candidate);
      await updateSession(session.id, { state: "AWAITING_ADDRESS", data });
      return PROMPTS.AWAITING_ADDRESS;
    }

    case "AWAITING_ADDRESS": {
      if (body.length < 5)
        return "Please give a bit more detail on the address. " + PROMPTS.AWAITING_ADDRESS;
      data.address = body;
      await updateSession(session.id, { state: "AWAITING_ISSUE", data });
      return PROMPTS.AWAITING_ISSUE;
    }

    case "AWAITING_ISSUE": {
      if (body.length < 3)
        return "Please describe the issue so a technician can help. " + PROMPTS.AWAITING_ISSUE;
      data.issue = body;

      // Final guard: ALL mandatory fields must be present before completing.
      const missing = ["name", "phone", "address", "issue"].filter((k) => !data[k]);
      if (missing.length) {
        // Roll back to the first missing field instead of completing.
        const stateFor = {
          name: "AWAITING_NAME", phone: "AWAITING_PHONE",
          address: "AWAITING_ADDRESS", issue: "AWAITING_ISSUE",
        }[missing[0]];
        await updateSession(session.id, { state: stateFor, data });
        return "I'm missing some details. " + PROMPTS[stateFor];
      }

      // Create the tracked ticket.
      const ticket = await createTicket({
        customer: { full_name: data.name, phone: data.phone, address: data.address },
        issue_description: data.issue,
        source: "whatsapp",
      });
      await updateSession(session.id, {
        state: "COMPLETED", data,
        customer_id: ticket.customer.id, ticket_id: ticket.id,
      });

      log.info(`Intake complete for ${phone} -> ${ticket.ticket_number}`);
      return `🎉 All set! Your request is logged.\n` +
             `Your ticket ID is *${ticket.ticket_number}*.\n` +
             `You'll get a WhatsApp update when a technician is assigned.\n\n` +
             `(Send *status* to check your request, or *restart* to raise another.)`;
    }

    default:
      // Shouldn't happen; recover gracefully.
      await createSession(phone);
      return GREETING;
  }
}
