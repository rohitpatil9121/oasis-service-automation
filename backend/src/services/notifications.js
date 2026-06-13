// Notification dispatch. We send the WhatsApp message INLINE and record the
// result as already SENT/FAILED — we deliberately do NOT leave a PENDING row.
//
// Why: this Supabase project is (was) shared with another deployment whose
// worker drains PENDING notifications via Twilio. A PENDING row could be picked
// up and sent by that other app, so the same alert went out twice / via the
// wrong provider. Sending inline and storing the final state closes that gap —
// there is no PENDING window for any external worker to grab.
import { supabase } from "../config/supabase.js";
import { sendWhatsApp } from "./whatsapp.js";
import { log } from "../lib/logger.js";

// Send now, then persist the outcome (kept as an audit/outbox record).
export async function queueNotification({ recipient, body, audience, ticketId }) {
  let row = {
    channel: "whatsapp",
    recipient,
    body,
    audience,
    related_ticket_id: ticketId || null,
    status: "SENT",
    attempts: 1,
    sent_at: new Date().toISOString(),
  };

  try {
    const res = await sendWhatsApp(recipient, body);
    row.provider_sid = res.sid;
  } catch (e) {
    // Mark FAILED with attempts maxed so no retry-worker (ours or another
    // deployment's) re-sends it through a different provider.
    row = { ...row, status: "FAILED", sent_at: null, attempts: 5, last_error: e.message };
    log.error("notification send failed:", e.message);
  }

  const { data, error } = await supabase
    .from("notifications").insert(row).select("id").single();
  if (error) { log.error("queueNotification insert failed:", error.message); return null; }
  return data.id;
}
