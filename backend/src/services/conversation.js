// Customer WhatsApp conversation for a ticket. We reconstruct the thread from
// what we already store: inbound messages live in `wa_inbound`, outbound ones
// (confirmations, alerts, and the manager's manual replies) live in
// `notifications`. Merge by the customer's phone and sort by time.
//
// Sending a manual message reuses queueNotification (free-form WhatsApp), so it
// goes out now and is stored — which makes it show up in this same thread.
import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { getTicket } from "./tickets.js";

// How long the AI agent stays quiet after a manager manually messages a customer.
// Rolling: each manual message resets the window. After this gap with no manual
// message, the AI auto-resumes (so a fresh request another day is handled normally).
const HANDOFF_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

// True if a manager messaged this customer within the handoff window — the AI
// agent should stay silent (a human is handling the conversation).
export async function isAgentHandling(phone) {
  if (!phone) return false;
  const since = new Date(Date.now() - HANDOFF_WINDOW_MS).toISOString();
  const { data } = await supabase
    .from("notifications").select("id")
    .eq("recipient", phone).eq("audience", "agent")
    .gte("created_at", since).limit(1);
  return (data || []).length > 0;
}

export async function getConversation(ticketId) {
  const ticket = await getTicket(ticketId);
  const phone = ticket.customer?.phone;
  if (!phone) return { phone: null, messages: [] };

  const [inbound, outbound] = await Promise.all([
    supabase.from("wa_inbound").select("id, body, created_at").eq("from_phone", phone),
    // Only customer-facing outbound (confirmations + manual agent replies). Staff
    // alerts (manager/technician) can share a phone in testing — keep them out.
    supabase.from("notifications").select("id, body, sent_at, created_at, status, audience")
      .eq("recipient", phone).in("audience", ["customer", "agent"]),
  ]);

  const messages = [
    ...(inbound.data || []).map((m) => ({ id: "in-" + m.id, dir: "in", body: m.body, at: m.created_at })),
    ...(outbound.data || []).map((m) => ({
      id: "out-" + m.id, dir: "out", body: m.body,
      at: m.sent_at || m.created_at, status: m.status, audience: m.audience,
    })),
  ]
    .filter((m) => m.body)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  return { phone, customer: ticket.customer.full_name, messages };
}

// Manager sends a free-form WhatsApp message to the customer (e.g. to ask for a
// missing/clearer detail). Returns the delivery status so the UI can warn if it
// couldn't be delivered (e.g. outside WhatsApp's 24-hour window).
export async function sendCustomerMessage({ ticketId, body, actorId }) {
  const text = (body || "").trim();
  if (!text) { const e = new Error("Message is empty"); e.status = 400; throw e; }

  const ticket = await getTicket(ticketId);
  if (!ticket.customer?.phone) { const e = new Error("This ticket has no customer phone"); e.status = 400; throw e; }

  const id = await queueNotification({
    recipient: ticket.customer.phone, audience: "agent", ticketId, body: text,
  });
  const { data } = await supabase
    .from("notifications").select("status, last_error").eq("id", id).maybeSingle();

  return { ok: data?.status === "SENT", status: data?.status, error: data?.last_error || null };
}
