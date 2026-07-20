// Notification dispatch. We send the WhatsApp message INLINE and record the
// outcome (SENT/FAILED) — no PENDING row for any external worker to grab.
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
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

  // A record saved with our OWN WhatsApp number (mis-keyed on a manually created
  // request) makes every message to it a guaranteed Meta rejection. Record it
  // with a readable reason instead of retrying a send that cannot work.
  const digits = (p) => String(p || "").replace(/\D/g, "");
  const toSelf = env.metaOwnNumber && digits(recipient) === digits(env.metaOwnNumber);

  if (toSelf) {
    row = { ...row, status: "FAILED", sent_at: null, attempts: 1,
      last_error: "recipient is our own WhatsApp number — check the customer's phone" };
    log.warn(`notification skipped: recipient ${recipient} is our own number`);
  } else try {
    const res = interactive
      ? await sendWhatsAppInteractive(recipient, interactive, body)
      : template
        ? await sendWhatsAppTemplate(recipient, template, body)
        : await sendWhatsApp(recipient, body, { contextMessageId: replyTo?.wamid });
    row.provider_sid = res.sid;
  } catch (e) {
    // Fall back to free-form text ONLY when Meta REJECTED the template — HTTP 4xx
    // (e.g. #132001 not approved, #132000 param mismatch). Those never reach the
    // customer, so a text fallback cannot duplicate. For a 5xx / network error the
    // template MAY already have been delivered, so we do NOT resend — resending
    // there is exactly what causes a repeated message. Then the row is just FAILED.
    const templateRejected =
      template && body && e.metaStatus >= 400 && e.metaStatus < 500;
    if (templateRejected) {
      try {
        const res = await sendWhatsApp(recipient, body, { contextMessageId: replyTo?.wamid });
        row.provider_sid = res.sid;
        row.last_error = `template rejected (${e.metaCode ?? e.metaStatus}), sent as text`;
        log.warn("notification template rejected, sent as text:", e.message);
      } catch (e2) {
        row = { ...row, status: "FAILED", sent_at: null, attempts: 5, last_error: e2.message };
        log.error("notification send failed (template + text):", e2.message);
      }
    } else {
      row = { ...row, status: "FAILED", sent_at: null, attempts: 5, last_error: e.message };
      log.error("notification send failed:", e.message);
    }
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
