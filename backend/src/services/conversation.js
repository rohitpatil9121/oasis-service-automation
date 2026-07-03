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

// Short, single-line label for a quoted ("reply to") message.
function quoteSnippet(body, hasMedia) {
  const t = (body || "").replace(/\s+/g, " ").trim();
  if (t) return t.length > 120 ? t.slice(0, 120) + "…" : t;
  return hasMedia ? "📎 Attachment" : "";
}

// Merge inbound (wa_inbound) + outbound (notifications) rows into one sorted
// thread, resolving "reply to" quotes on BOTH sides:
//  - outbound: the manager's reply stores a snapshot (reply_to_body).
//  - inbound:  the customer/technician quoted a message — we only get its wamid
//    (reply_to_wamid), so we look the text up among messages in this thread.
function buildThread(inboundRows = [], outboundRows = []) {
  const byWamid = new Map(); // wamid -> { body, media }
  for (const m of inboundRows) if (m.wa_message_id) byWamid.set(m.wa_message_id, { body: m.body, media: !!m.media_id });
  for (const m of outboundRows) if (m.provider_sid) byWamid.set(m.provider_sid, { body: m.body, media: false });
  const resolve = (wamid) => {
    if (!wamid) return null;
    const q = byWamid.get(wamid);
    return q ? { body: quoteSnippet(q.body, q.media) } : null;
  };

  return [
    ...inboundRows.map((m) => ({
      id: "in-" + m.id, dir: "in", body: m.body, at: m.created_at,
      mediaId: m.media_id || null, mediaType: m.media_type || null,
      waMessageId: m.wa_message_id || null,
      replyTo: resolve(m.reply_to_wamid),
    })),
    ...outboundRows.map((m) => ({
      id: "out-" + m.id, dir: "out", body: m.body,
      at: m.sent_at || m.created_at, status: m.status, audience: m.audience,
      waMessageId: m.provider_sid || null,
      replyTo: m.reply_to_body ? { body: quoteSnippet(m.reply_to_body, false) } : resolve(m.reply_to_wamid),
    })),
  ]
    .filter((m) => m.body || m.mediaId)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

// Inbox for the "all chats" screen — one row per customer who has a WhatsApp
// thread, newest activity first (WhatsApp-Web style list). Built from the same
// two tables getConversation merges, but we only keep the LATEST message per
// phone (for the preview line + sort) rather than the whole thread. The latest
// ticket id rides along as the entry point ChatPanel needs to open the thread.
export async function listConversations() {
  const [custRes, ticketRes, inboundRes, outboundRes] = await Promise.all([
    supabase.from("customers").select("id, full_name, phone, ai_paused_until"),
    supabase.from("tickets").select("id, customer_id, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("wa_inbound").select("from_phone, body, media_id, created_at")
      .order("created_at", { ascending: false }).limit(3000),
    supabase.from("notifications").select("recipient, body, audience, sent_at, created_at")
      .in("audience", ["customer", "agent", "bot"])
      .order("created_at", { ascending: false }).limit(3000),
  ]);

  // Latest ticket id per customer (rows come newest-first, so first wins).
  const latestTicket = new Map();
  for (const t of ticketRes.data || []) {
    if (!latestTicket.has(t.customer_id)) latestTicket.set(t.customer_id, t.id);
  }
  // Latest inbound + latest outbound per phone.
  const lastIn = new Map();
  for (const m of inboundRes.data || []) if (!lastIn.has(m.from_phone)) lastIn.set(m.from_phone, m);
  const lastOut = new Map();
  for (const m of outboundRes.data || []) if (!lastOut.has(m.recipient)) lastOut.set(m.recipient, m);

  const preview = (body, hasMedia) => {
    const t = (body || "").replace(/\s+/g, " ").trim();
    if (t) return t.length > 80 ? t.slice(0, 80) + "…" : t;
    return hasMedia ? "📎 Attachment" : "";
  };

  const rows = [];
  for (const c of custRes.data || []) {
    const ticketId = latestTicket.get(c.id);
    if (!ticketId) continue; // no ticket → no chat entry point (rare in practice)
    const inb = lastIn.get(c.phone);
    const out = lastOut.get(c.phone);
    const outAt = out ? out.sent_at || out.created_at : null;

    // Preview = the newer of the customer's last inbound and our last outbound.
    let lastAt = null, lastMessage = "", lastDir = null;
    if (inb && (!outAt || new Date(inb.created_at) >= new Date(outAt))) {
      lastAt = inb.created_at; lastMessage = preview(inb.body, !!inb.media_id); lastDir = "in";
    } else if (out) {
      lastAt = outAt; lastMessage = preview(out.body, false); lastDir = out.audience === "bot" ? "bot" : "out";
    }
    if (!lastAt) continue; // never exchanged a message → skip empty threads

    rows.push({
      customer: { id: c.id, full_name: c.full_name, phone: c.phone },
      ticketId, lastMessage, lastAt, lastDir,
      lastInboundAt: inb ? inb.created_at : null,
      botOn: !isPaused(c.ai_paused_until),
    });
  }
  rows.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  return { conversations: rows };
}

export async function getConversation(ticketId) {
  const ticket = await getTicket(ticketId);
  const phone = ticket.customer?.phone;
  if (!phone) return { phone: null, messages: [] };

  const [inbound, outbound] = await Promise.all([
    supabase.from("wa_inbound").select("*").eq("from_phone", phone),
    // Only customer-facing outbound (confirmations + manual agent replies). Staff
    // alerts (manager/technician) can share a phone in testing — keep them out.
    // select("*") so new reply-context columns work even before the migration runs.
    supabase.from("notifications").select("*")
      .eq("recipient", phone).in("audience", ["customer", "agent", "bot"]),
  ]);

  const messages = buildThread(inbound.data, outbound.data);

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
    supabase.from("wa_inbound").select("*").eq("from_phone", phone),
    // select("*") to get provider_sid + reply-context columns for quote resolution.
    supabase.from("notifications").select("*")
      .eq("recipient", phone).in("audience", ["technician", "agent"]),
  ]);

  const messages = buildThread(inbound.data, outbound.data);

  return { phone, name: tech.full_name, messages };
}

// Manager replies to a technician on WhatsApp. `replyTo` (optional) quotes an
// earlier message so it renders as a native WhatsApp reply (Meta) and shows in
// the thread; mirrors sendCustomerMessage.
export async function sendTechnicianMessage({ technicianId, body, replyTo }) {
  const text = (body || "").trim();
  if (!text) { const e = new Error("Message is empty"); e.status = 400; throw e; }
  const { data: tech } = await supabase
    .from("users").select("id, phone").eq("id", technicianId).maybeSingle();
  if (!tech?.phone) { const e = new Error("Technician has no phone"); e.status = 400; throw e; }

  const quote = replyTo?.body
    ? { body: String(replyTo.body).slice(0, 300), wamid: replyTo.wamid || null }
    : null;

  const id = await queueNotification({ recipient: tech.phone, audience: "agent", body: text, replyTo: quote });
  const { data } = await supabase
    .from("notifications").select("status, last_error").eq("id", id).maybeSingle();
  return { ok: data?.status === "SENT", status: data?.status, error: data?.last_error || null };
}

// Manager sends a free-form WhatsApp message to the customer (e.g. to ask for a
// missing/clearer detail). Returns the delivery status so the UI can warn if it
// couldn't be delivered (e.g. outside WhatsApp's 24-hour window).
export async function sendCustomerMessage({ ticketId, body, actorId, replyTo }) {
  const text = (body || "").trim();
  if (!text) { const e = new Error("Message is empty"); e.status = 400; throw e; }

  const ticket = await getTicket(ticketId);
  if (!ticket.customer?.phone) { const e = new Error("This ticket has no customer phone"); e.status = 400; throw e; }

  // Optional quoted reply: keep a short snapshot for the thread + the wamid so
  // Meta renders it as a native WhatsApp reply (wamid may be null in mock/Twilio).
  const quote = replyTo?.body
    ? { body: String(replyTo.body).slice(0, 300), wamid: replyTo.wamid || null }
    : null;

  const id = await queueNotification({
    recipient: ticket.customer.phone, audience: "agent", ticketId, body: text, replyTo: quote,
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
