// Notification dispatch. We send the WhatsApp message INLINE and record the
// outcome (SENT/FAILED) — no PENDING row for any external worker to grab.
import { supabase } from "../config/supabase.js";
import { sendWhatsApp, sendWhatsAppTemplate, sendWhatsAppInteractive } from "./whatsapp.js";
import { log } from "../lib/logger.js";


export async function queueNotification({ recipient, body, audience, ticketId, template, replyTo, interactive }) {
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
  // Quoting an earlier message (dashboard "reply"): remember what we quoted so
  // the thread can render it, and ask Meta to render it as a native reply.
  if (replyTo?.body) row.reply_to_body = replyTo.body;
  if (replyTo?.wamid) row.reply_to_wamid = replyTo.wamid;

  try {
    const res = interactive
      ? await sendWhatsAppInteractive(recipient, interactive, body)
      : template
        ? await sendWhatsAppTemplate(recipient, template, body)
        : await sendWhatsApp(recipient, body, { contextMessageId: replyTo?.wamid });
    row.provider_sid = res.sid;
  } catch (e) {

    row = { ...row, status: "FAILED", sent_at: null, attempts: 5, last_error: e.message };
    log.error("notification send failed:", e.message);
  }

  let { data, error } = await supabase
    .from("notifications").insert(row).select("id").single();
  if (error && (row.reply_to_body || row.reply_to_wamid)) {
    // The reply-context migration may not be run yet — don't drop the message.
    // Retry without the quote columns so the reply is still stored & sent.
    log.error("notification insert failed, retrying without reply context:", error.message);
    const { reply_to_body, reply_to_wamid, ...core } = row;
    ({ data, error } = await supabase.from("notifications").insert(core).select("id").single());
  }
  if (error) { log.error("queueNotification insert failed:", error.message); return null; }
  return data.id;
}
