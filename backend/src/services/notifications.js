// Notification dispatch. We send the WhatsApp message INLINE and record the
// outcome (SENT/FAILED) — no PENDING row for any external worker to grab.
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { sendWhatsApp, sendWhatsAppTemplate, sendWhatsAppInteractive, sendWhatsAppDocument } from "./whatsapp.js";
import { log } from "../lib/logger.js";


/* The last line of defence against telling a customer the same thing twice.

   One path was found and fixed (a technician re-saving the bill re-fired
   "Work completed" — Kshitij Gadwe got it four times in six minutes), but that
   was one path. Any future one lands here, so the check lives here too: an
   IDENTICAL message, to the SAME person, within a few minutes, is a mistake
   somewhere upstream and not something a customer should have to read again.

   Deliberately narrow. Only customer-facing messages, only an exact body match,
   and only inside a short window — two genuine jobs for one customer an hour
   apart can legitimately produce the same words, and that must still send. */
const DUP_WINDOW_MS = 5 * 60 * 1000;

async function sentRecently(recipient, body, audience) {
  if (audience !== "customer" || !recipient || !body) return false;
  const since = new Date(Date.now() - DUP_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("notifications").select("id, created_at")
    .eq("recipient", recipient).eq("body", body).eq("status", "SENT")
    .gte("created_at", since).limit(1);
  if (error) return false;          // a check that cannot run must not block a send
  return !!(data && data.length);
}

export async function queueNotification({ recipient, body, audience, ticketId, template, replyTo, interactive, document }) {
  if (await sentRecently(recipient, body, audience)) {
    log.warn(`duplicate suppressed for ${recipient}: ${String(body).slice(0, 48)}`);
    return null;
  }

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
        : document
          ? await sendWhatsAppDocument(recipient, document, body)
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
        // A rejected template that was carrying a PDF (the GST invoice) must not
        // silently degrade to text — the document IS the message. Try it as a
        // plain document first; that works whenever the customer is inside the
        // 24-hour window, which they normally are right after paying.
        const doc = document || (template?.headerDocument?.link ? template.headerDocument : null);
        if (doc?.link) {
          let sent = null;
          try {
            sent = await sendWhatsAppDocument(recipient, doc, body);
            row.last_error = `template rejected (${e.metaCode ?? e.metaStatus}), sent as document`;
            log.warn("notification template rejected, sent as document:", e.message);
          } catch (docErr) {
            // Outside the 24-hour window nothing free-form is deliverable — only a
            // template is. #132012 means the approved template's header shape does
            // not match what we sent (e.g. it was approved with a TEXT header
            // instead of DOCUMENT), so the BODY is still valid: re-send the same
            // template without the header. The customer then at least gets the
            // invoice number and amount instead of silence, and the PDF follows
            // once the template is re-approved with a document header.
            if (e.metaCode === 132012 && template) {
              const { headerDocument, ...noHeader } = template;
              sent = await sendWhatsAppTemplate(recipient, noHeader, body);
              row.last_error =
                `template header mismatch (132012) and document undeliverable ` +
                `(${docErr.message.slice(0, 60)}); sent template text only — PDF NOT delivered`;
              log.warn("invoice PDF not delivered; sent template text only:", docErr.message);
            } else {
              throw docErr;
            }
          }
          row.provider_sid = sent.sid;
        } else {
          const res = await sendWhatsApp(recipient, body, { contextMessageId: replyTo?.wamid });
          row.provider_sid = res.sid;
          row.last_error = `template rejected (${e.metaCode ?? e.metaStatus}), sent as text`;
          log.warn("notification template rejected, sent as text:", e.message);
        }
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
