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
import { log } from "../lib/logger.js";

// AI bot on/off is stored per customer in `customers.ai_paused_until`:
//   null / past timestamp  => bot ON (auto-replies)
//   future timestamp       => bot OFF (manager is handling)
// Sending a manual message auto-pauses for 12h (rolling); the chat toggle sets it
// explicitly (ON = clear, OFF = far future).
const HANDOFF_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const OFF_UNTIL = "2099-01-01T00:00:00.000Z"; // "indefinitely off" until toggled on

const isPaused = (ts) => !!ts && new Date(ts).getTime() > Date.now();

// True if the AI bot is currently paused for this customer (manager handling).
export async function isAgentHandling(phone) {
  if (!phone) return false;
  const { data } = await supabase
    .from("customers").select("ai_paused_until").eq("phone", phone).maybeSingle();
  return isPaused(data?.ai_paused_until);
}

// Record an AI bot reply (sent straight to WhatsApp by the webhook) so it shows
// in the dashboard chat — the Service Manager monitors the full conversation.
export async function storeBotMessage(phone, body) {
  const text = (body || "").trim();
  if (!phone || !text) return;
  const { error } = await supabase.from("notifications").insert({
    channel: "whatsapp", recipient: phone, body: text, audience: "bot",
    status: "SENT", attempts: 1, sent_at: new Date().toISOString(),
  });
  if (error) log.error("storeBotMessage failed:", error.message);
}

// Manager toggles the bot for a customer. on=true clears the pause (bot replies);
// on=false pauses it until they turn it back on.
export async function setCustomerBot(customerId, on) {
  await supabase.from("customers")
    .update({ ai_paused_until: on ? null : OFF_UNTIL }).eq("id", customerId);
  return { on };
}

export async function getConversation(ticketId) {
  const ticket = await getTicket(ticketId);
  const phone = ticket.customer?.phone;
  if (!phone) return { phone: null, messages: [] };

  const [inbound, outbound] = await Promise.all([
    supabase.from("wa_inbound").select("id, body, created_at, media_id, media_type").eq("from_phone", phone),
    // Only customer-facing outbound (confirmations + manual agent replies). Staff
    // alerts (manager/technician) can share a phone in testing — keep them out.
    supabase.from("notifications").select("id, body, sent_at, created_at, status, audience")
      .eq("recipient", phone).in("audience", ["customer", "agent", "bot"]),
  ]);

  const messages = [
    ...(inbound.data || []).map((m) => ({
      id: "in-" + m.id, dir: "in", body: m.body, at: m.created_at,
      mediaId: m.media_id || null, mediaType: m.media_type || null,
    })),
    ...(outbound.data || []).map((m) => ({
      id: "out-" + m.id, dir: "out", body: m.body,
      at: m.sent_at || m.created_at, status: m.status, audience: m.audience,
    })),
  ]
    .filter((m) => m.body || m.mediaId)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  return {
    phone, customer: ticket.customer.full_name, messages,
    botOn: !isPaused(ticket.customer.ai_paused_until),
  };
}

// Same thread, but with a TECHNICIAN — what the company (92 number) has sent
// them (job alerts, schedules, manual messages) plus anything they replied.
export async function getTechnicianConversation(technicianId) {
  const { data: tech } = await supabase
    .from("users").select("id, full_name, phone").eq("id", technicianId).maybeSingle();
  if (!tech?.phone) return { phone: null, name: tech?.full_name || null, messages: [] };
  const phone = tech.phone;

  const [inbound, outbound] = await Promise.all([
    supabase.from("wa_inbound").select("id, body, created_at, media_id, media_type").eq("from_phone", phone),
    supabase.from("notifications").select("id, body, sent_at, created_at, status, audience")
      .eq("recipient", phone).in("audience", ["technician", "agent"]),
  ]);

  const messages = [
    ...(inbound.data || []).map((m) => ({
      id: "in-" + m.id, dir: "in", body: m.body, at: m.created_at,
      mediaId: m.media_id || null, mediaType: m.media_type || null,
    })),
    ...(outbound.data || []).map((m) => ({
      id: "out-" + m.id, dir: "out", body: m.body,
      at: m.sent_at || m.created_at, status: m.status, audience: m.audience,
    })),
  ]
    .filter((m) => m.body || m.mediaId)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  return { phone, name: tech.full_name, messages };
}

// Manager replies to a technician on WhatsApp.
export async function sendTechnicianMessage({ technicianId, body }) {
  const text = (body || "").trim();
  if (!text) { const e = new Error("Message is empty"); e.status = 400; throw e; }
  const { data: tech } = await supabase
    .from("users").select("id, phone").eq("id", technicianId).maybeSingle();
  if (!tech?.phone) { const e = new Error("Technician has no phone"); e.status = 400; throw e; }

  const id = await queueNotification({ recipient: tech.phone, audience: "agent", body: text });
  const { data } = await supabase
    .from("notifications").select("status, last_error").eq("id", id).maybeSingle();
  return { ok: data?.status === "SENT", status: data?.status, error: data?.last_error || null };
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

  // Auto-pause the AI for 12h so it doesn't talk over the manager — unless it's
  // already paused for longer (e.g. toggled off). Keeps the longer pause.
  const next = new Date(Date.now() + HANDOFF_WINDOW_MS);
  const cur = ticket.customer.ai_paused_until ? new Date(ticket.customer.ai_paused_until) : null;
  await supabase.from("customers")
    .update({ ai_paused_until: (cur && cur > next ? cur : next).toISOString() })
    .eq("id", ticket.customer.id);

  const { data } = await supabase
    .from("notifications").select("status, last_error").eq("id", id).maybeSingle();

  return { ok: data?.status === "SENT", status: data?.status, error: data?.last_error || null };
}
