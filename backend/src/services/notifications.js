// Notification outbox: every message is persisted FIRST (so it is never lost),
// then dispatched via the queue. The worker can retry PENDING rows.
import { supabase } from "../config/supabase.js";
import { enqueue, registerHandler } from "../queue/queue.js";
import { sendWhatsApp } from "./whatsapp.js";
import { log } from "../lib/logger.js";

const JOB = "notification.send";

// Persist + enqueue a WhatsApp notification.
export async function queueNotification({ recipient, body, audience, ticketId }) {
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      channel: "whatsapp",
      recipient,
      body,
      audience,
      related_ticket_id: ticketId || null,
      status: "PENDING",
    })
    .select("id")
    .single();
  if (error) { log.error("queueNotification insert failed:", error.message); return null; }
  enqueue(JOB, { id: data.id });
  return data.id;
}

// Process one outbox row by id.
async function processOne({ id }) {
  const { data: n, error } = await supabase
    .from("notifications").select("*").eq("id", id).single();
  if (error || !n || n.status === "SENT") return;
  try {
    const res = await sendWhatsApp(n.recipient, n.body);
    await supabase.from("notifications").update({
      status: "SENT", provider_sid: res.sid, sent_at: new Date().toISOString(),
      attempts: n.attempts + 1,
    }).eq("id", id);
  } catch (e) {
    await supabase.from("notifications").update({
      status: "FAILED", last_error: e.message, attempts: n.attempts + 1,
    }).eq("id", id);
    log.error("notification send failed:", e.message);
  }
}

registerHandler(JOB, processOne);

// Used by the standalone worker to drain anything still PENDING/FAILED.
export async function retryPending(limit = 25) {
  const { data } = await supabase
    .from("notifications").select("id")
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", 5)
    .limit(limit);
  for (const row of data || []) await processOne({ id: row.id });
  return (data || []).length;
}
