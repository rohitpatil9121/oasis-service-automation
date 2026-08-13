import { Router } from "express";
import crypto from "crypto";
import twilio from "twilio";
import { runAgent } from "../services/agent/run.js";
import { handleEstimateReply } from "../services/techJobs.js";
import { sendWhatsApp } from "../services/whatsapp.js";
import { isAgentHandling, storeBotMessage } from "../services/conversation.js";
import { handleRatingReply, handleTypedRating } from "../services/rating.js";
import { sendRatingListForPayload } from "../services/tickets.js";
import { supabase } from "../config/supabase.js";
import { normalizePhone } from "../lib/phone.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

const router = Router();

/* Record Meta's delivery receipts against the notification we sent.

   Each entry is { id (wamid), status, timestamp, recipient_id, errors[] }.
   `status` walks sent → delivered → read; `failed` carries an error code, and
   that code is the whole point of this function — 131026 ("message
   undeliverable"), 131047 (re-engagement required) and friends are the
   difference between "the customer ignored us" and "the message never arrived".

   Statuses can arrive out of order and repeat, so never downgrade a row that
   has already reached a later stage. */
const STATUS_RANK = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

async function recordDeliveryStatuses(statuses) {
  for (const s of statuses) {
    if (!s?.id) continue;
    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString();

    const { data: row } = await supabase
      .from("notifications").select("id, delivery_status")
      .eq("provider_sid", s.id).maybeSingle();
    if (!row) continue; // not one of ours (or sent before this column existed)

    // Ignore a stale receipt that would move the row backwards.
    if ((STATUS_RANK[s.status] ?? -1) < (STATUS_RANK[row.delivery_status] ?? -1)) continue;

    const patch = { delivery_status: s.status };
    if (s.status === "delivered") patch.delivered_at = at;
    if (s.status === "read") { patch.read_at = at; if (!row.delivered_at) patch.delivered_at = at; }
    if (s.status === "failed") {
      const err = s.errors?.[0] || {};
      patch.failure_code = err.code ?? null;
      patch.failure_detail = [err.title, err.message, err.error_data?.details]
        .filter(Boolean).join(" — ").slice(0, 500) || "unknown";
      // Surface it on the main status too, so the dashboard stops calling a
      // message that never arrived a success.
      patch.status = "FAILED";
      patch.last_error = `undelivered (${err.code ?? "?"}): ${patch.failure_detail}`.slice(0, 500);
      log.warn(`[WA UNDELIVERED] ${s.id} -> ${s.recipient_id}: ${patch.failure_detail}`);
    }

    const { error } = await supabase.from("notifications").update(patch).eq("id", row.id);
    // Graceful until phase10_delivery_status.sql is applied.
    if (error && /column .* does not exist|schema cache/i.test(error.message)) {
      log.warn("delivery status columns missing — run phase10_delivery_status.sql");
      return;
    }
  }
}

// How long to wait after the customer's LAST message before the bot replies.
// People often fire several messages in a row ("hi" … "my RO is leaking" …
// "since morning"). Without this pause the bot answers the first line while
// they're still typing the rest. Each new message resets the timer, so the bot
// only responds once the customer has actually paused — and it sees all the
// lines together.
// Kept short so replies feel fast; still long enough to batch a rapid follow-up.
// Tunable via BOT_REPLY_DELAY_MS.
const REPLY_DELAY_MS = parseInt(process.env.BOT_REPLY_DELAY_MS || "1200", 10);
const pending = new Map(); // phone -> { parts: [], send, timer }

// Human-like pause BEFORE every bot reply is actually sent (typing delay), on top
// of the debounce above. Off by default: the agent loop already takes seconds, so
// this only added to a wait customers were already feeling. Set a value in ms to
// bring it back.
const SEND_DELAY_MS = parseInt(process.env.BOT_SEND_DELAY_MS || "0", 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Persist the inbound message FIRST (so the inquiry is never lost even if intake
// errors), then decide whether the bot should respond at all.
// Returns false when the message must be swallowed (staff / manager handoff).
async function logInbound(from, text, { mediaId, mediaType, waMessageId, replyToWamid } = {}) {
  const phone = normalizePhone(from);

  // Idempotency: Meta (and network retries) can deliver the SAME message more than
  // once. Each duplicate would otherwise trigger another bot reply and re-run
  // intake — the source of duplicate replies AND duplicate tickets. If we've
  // already stored this wamid, swallow the redelivery.
  if (waMessageId) {
    const { data: seen } = await supabase
      .from("wa_inbound").select("id").eq("wa_message_id", waMessageId).maybeSingle();
    if (seen) { log.info(`[dedupe] duplicate inbound ${waMessageId} ignored`); return false; }
  }

  const row = { from_phone: phone, body: text };
  if (mediaId) { row.media_id = mediaId; row.media_type = mediaType || null; }
  if (waMessageId) row.wa_message_id = waMessageId; // for native WhatsApp "reply" quoting
  if (replyToWamid) row.reply_to_wamid = replyToWamid; // the message THIS one quotes (customer/tech tagged a reply)
  let { error } = await supabase.from("wa_inbound").insert(row);
  if (error) {
    // A concurrent duplicate delivery raced past the check above and hit the
    // unique index on wa_message_id (Postgres 23505). It's the same message —
    // swallow it exactly like the pre-check duplicate.
    if (error.code === "23505") {
      log.info(`[dedupe] duplicate inbound ${waMessageId} ignored (unique index)`);
      return false;
    }
    // An optional-feature migration may not be run yet (e.g. media_* or
    // wa_message_id columns). Never lose the customer's message — retry with
    // only the core columns that always exist.
    log.error("wa_inbound insert failed, retrying with core columns:", error.message);
    ({ error } = await supabase.from("wa_inbound").insert({ from_phone: phone, body: text }));
    // A failed CORE insert means the customer's message is lost — it will never
    // appear in the dashboard chat even though the bot still replies. Shout about
    // it loudly (this is the exact symptom behind "received messages not showing").
    if (error) log.error(`❌ wa_inbound CORE insert FAILED for ${phone} — customer message NOT saved, will be MISSING from the dashboard chat:`, error.message, error.code ? `(code ${error.code})` : "");
  }

  // If a registered TECHNICIAN messages the company number, don't run customer
  // intake — just log it (shows in their chat) so the manager can reply. Their
  // message still opens the 24-hour window, without the AI treating them as a
  // customer or raising a ticket.
  const { data: tech } = await supabase
    .from("users").select("id").eq("phone", phone).eq("role", "technician").maybeSingle();
  if (tech) {
    log.info(`[staff] technician ${phone} messaged — no AI intake`);
    return false;
  }

  // Estimate APPROVE/REJECT ("1"/"2"/yes/no) is a deterministic ticket update,
  // not an AI chat reply — process it BEFORE the handoff pause below. Otherwise
  // a customer in a manager-handoff window taps Approve and the job never advances.
  try { if (await handleEstimateReply(phone, text)) return false; }
  catch (e) { log.error("handleEstimateReply:", e.message); }

  // A typed "1"–"5" after a rating request is a rating, not a chat message —
  // the only way to rate for customers outside the 24-hour window (they get the
  // plain template with no tap buttons). Ack directly, never route to intake.
  try {
    const ack = await handleTypedRating(phone, text);
    if (ack) {
      await sendWhatsApp(phone, ack);
      await storeBotMessage(phone, ack);
      return false;
    }
  } catch (e) { log.error("handleTypedRating:", e.message); }

  // Human handoff: if a manager messaged this customer in the last 12h, stay
  // silent and let them handle it. The inbound is still logged above, so the
  // reply shows in the dashboard chat. AI auto-resumes once the window lapses.
  if (await isAgentHandling(phone)) {
    log.info(`[handoff] AI paused for ${phone} — manager is handling`);
    return false;
  }
  return true;
}

// Run intake through the Groq tool-calling agent (the only intake path) and store
// the bot's reply so the Service Manager sees the full thread on the dashboard.
async function runIntake(from, text) {
  const reply = await runAgent({ fromPhone: from, text });
  if (reply) await storeBotMessage(normalizePhone(from), reply);
  return reply;
}

// Synchronous path (mock/testing): log + reply immediately, no debounce.
async function getReply(from, text, media = {}) {
  if (!(await logInbound(from, text, media))) return null;
  return runIntake(from, text);
}

// Debounced path (live WhatsApp): buffer rapid-fire messages and reply once,
// REPLY_DELAY_MS after the customer's last message. `send` delivers the reply.
/* What the agent is told when a message carries a picture and no words.

   Media used to contribute nothing at all: the attachment was stored, and the
   text buffer stayed empty. A customer who sent a video of the leak and a photo
   of his purifier — the very thing our opening message asks for — got silence,
   and the model never learned he had shown us the problem. It cannot see the
   image, but it can act on the fact that one arrived.

   A short, plainly-worded marker rather than a tag like [MEDIA]: it lands in the
   same transcript the model reads as the customer's own words, so it has to read
   as a sentence about the customer, not as machinery. */
function mediaMarker(mime = "") {
  const m = String(mime || "");
  if (m.startsWith("video")) return "(The customer sent a video of the problem.)";
  if (m.startsWith("image")) return "(The customer sent a photo of the purifier.)";
  return "(The customer sent an attachment.)";
}

async function enqueueReply(from, text, media, send) {
  if (!(await logInbound(from, text, media))) return;
  const phone = normalizePhone(from);
  let p = pending.get(phone);
  if (!p) { p = { parts: [], busy: false }; pending.set(phone, p); }
  if (text) p.parts.push(text);
  else if (media?.mediaId) p.parts.push(mediaMarker(media.mediaType));
  p.send = send;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => flushReply(phone, from), REPLY_DELAY_MS);
}

async function flushReply(phone, from) {
  const p = pending.get(phone);
  if (!p) return;
  // A reply is already being generated for this phone. Don't start a SECOND,
  // parallel cycle — that's what makes the bot fire several replies at once.
  // Whatever the customer sends meanwhile stays buffered in p.parts and is
  // handled in one follow-up flush when the in-flight reply finishes.
  if (p.busy) return;
  if (!p.parts.length) { pending.delete(phone); return; }

  p.busy = true;
  const text = p.parts.join("\n");
  p.parts = [];
  try {
    const reply = await runIntake(from, text);
    if (reply) {
      if (SEND_DELAY_MS > 0) await sleep(SEND_DELAY_MS); // human-like typing pause
      await p.send(reply);
    }
  } catch (e) {
    log.error("flushReply error:", e.message);
  } finally {
    p.busy = false;
    // Messages that arrived while we were replying → flush them together, once.
    if (p.parts.length) {
      if (p.timer) clearTimeout(p.timer);
      p.timer = setTimeout(() => flushReply(phone, from), REPLY_DELAY_MS);
    } else {
      pending.delete(phone);
    }
  }
}

// ---- Meta webhook verification (GET) ----
// Meta calls this once when you save the callback URL in the app dashboard.
router.get("/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === env.metaVerifyToken) {
    log.info("Meta webhook verified");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---- Inbound authenticity ----------------------------------------------------
// Reject forged webhook calls. Twilio signs with X-Twilio-Signature (verified
// against the params + URL); Meta signs the raw body with the app secret
// (X-Hub-Signature-256). Skipped in mock mode, and degrades to a warning when
// the relevant secret isn't configured so a misconfig never drops real messages.
let warnedNoSecret = false;
function warnOnce() {
  if (!warnedNoSecret) { log.warn("Webhook signature secret not set — inbound is NOT verified."); warnedNoSecret = true; }
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function signatureOk(req) {
  if (env.whatsappProvider === "meta") {
    if (!env.metaAppSecret || !req.rawBody) { warnOnce(); return true; }
    const expected = "sha256=" + crypto.createHmac("sha256", env.metaAppSecret).update(req.rawBody).digest("hex");
    return safeEqual(req.get("x-hub-signature-256") || "", expected);
  }
  // Twilio
  if (!env.twilioToken) { warnOnce(); return true; }
  const url = env.publicBaseUrl.replace(/\/+$/, "") + req.originalUrl;
  return twilio.validateRequest(env.twilioToken, req.get("x-twilio-signature") || "", url, req.body || {});
}

// ---- Inbound messages (POST) ----
router.post("/whatsapp", async (req, res) => {
  // Drop forged requests before doing any work (skipped in mock/dev).
  if (!env.whatsappMock && !signatureOk(req)) {
    log.warn(`Webhook rejected: invalid ${env.whatsappProvider} signature`);
    return res.sendStatus(403);
  }

  // ----- Meta WhatsApp Cloud API -----
  if (env.whatsappProvider === "meta") {
    res.sendStatus(200); // ack immediately so Meta doesn't retry/duplicate
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;

      // Delivery receipts. Meta reports every message's fate here (sent →
      // delivered → read, or failed with a code). We used to drop these, which
      // meant an accepted-but-never-delivered message was indistinguishable
      // from a successful one on the dashboard.
      if (value?.statuses?.length) {
        await recordDeliveryStatuses(value.statuses);
        return;
      }

      const msg = value?.messages?.[0];
      if (!msg) return; // nothing actionable in this event

      const from = "+" + msg.from; // Meta sends e.g. "918668732890" (no +)
      // Template quick-reply buttons (e.g. estimate Approve/Reject) come back as
      // type "button" carrying button.text/payload — treat the tapped label as the
      // customer's text so handleEstimateReply / intake see "Approve" / "Reject".
      const buttonTap = msg.type === "button" ? (msg.button?.payload || msg.button?.text || "") : "";
      const text = msg.type === "text" ? (msg.text?.body || "")
        : msg.type === "button" ? buttonTap
        : (msg.image?.caption || msg.video?.caption || "");
      const mediaId = msg.image?.id || msg.video?.id || msg.document?.id || null;
      const mediaType = msg.image?.mime_type || msg.video?.mime_type || msg.document?.mime_type || null;
      const waMessageId = msg.id || null; // wamid — lets the manager later "reply" to this exact message
      const replyToWamid = msg.context?.id || null; // set when the sender quoted an earlier message
      // Interactive tap — list row (the post-close star rating) or reply button.
      const interactiveReply = msg.type === "interactive"
        ? (msg.interactive?.list_reply || msg.interactive?.button_reply)
        : null;
      log.info(`[WA IN] ${from}: ${text || interactiveReply?.title || (mediaId ? `(media ${mediaType})` : "(non-text message)")}`);

      // A rating tap is a structured one-tap response, not a conversation:
      // record it, log the tap to the thread, and acknowledge once — never route
      // it through intake (which would otherwise treat it as a new request).
      /* "Rate our service" on the completion TEMPLATE. The tap is itself a
         message from the customer, so the 24-hour window is open for the next
         few seconds — which is the only reason the star list can go at all to
         someone who last wrote to us days ago. Answer with the list and stop:
         routing this through intake would read it as a new service request. */
      if (msg.type === "button" && /^rate_open_/.test(msg.button?.payload || "")) {
        const sent = await sendRatingListForPayload(msg.button.payload);
        if (sent) {
          await logInbound(from, msg.button.text || "Rate our service", { waMessageId });
          return;
        }
      }

      if (interactiveReply) {
        const ack = await handleRatingReply(interactiveReply.id);
        if (ack !== null) {
          await logInbound(from, interactiveReply.title || interactiveReply.id, { waMessageId });
          await sendWhatsApp(from, ack);
          await storeBotMessage(normalizePhone(from), ack);
          return;
        }
      }

      // Debounced: waits for the customer to finish before the bot replies once.
      // Fall back to an interactive tap's label (non-rating reply buttons) so those
      // taps also reach estimate approval / intake instead of arriving as empty text.
      await enqueueReply(from, text || interactiveReply?.title || "", { mediaId, mediaType, waMessageId, replyToWamid }, (reply) => sendWhatsApp(from, reply));
    } catch (e) {
      log.error("meta webhook error:", e.message);
    }
    return;
  }

  // ----- Twilio (form-encoded: From, Body) -----
  try {
    const from = req.body.From; // e.g. whatsapp:+918668732890
    const body = req.body.Body || "";
    // Twilio sends MediaUrl0 / MediaContentType0 for the first attached media.
    const rawMediaUrl = req.body.MediaUrl0 || null;
    const mediaType = req.body.MediaContentType0 || null;
    // Encode the Twilio URL as base64url so it survives as a URL segment in the proxy route.
    const mediaId = rawMediaUrl ? Buffer.from(rawMediaUrl).toString("base64url").replace(/=/g, "") : null;
    log.info(`[WA IN] ${from}: ${body || (mediaId ? `(media ${mediaType})` : "")}`);

    // Real Twilio mode: reply via the REST API; empty TwiML avoids a duplicate.
    if (!env.whatsappMock) {
      // Debounced: waits for the customer to finish before the bot replies once.
      await enqueueReply(from, body, { mediaId, mediaType }, (reply) => sendWhatsApp(from, reply));
      res.set("Content-Type", "text/xml").send("<Response></Response>");
    } else {
      // Mock mode: reply immediately as JSON so you can test with curl/Postman.
      const reply = await getReply(from, body, { mediaId, mediaType });
      res.json({ from, reply });
    }
  } catch (e) {
    log.error("webhook error:", e.message);
    res.status(200).set("Content-Type", "text/xml").send("<Response></Response>");
  }
});

export default router;
