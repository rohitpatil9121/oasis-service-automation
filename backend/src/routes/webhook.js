import { Router } from "express";
import { handleInbound } from "../services/intake.js";
import { handleInboundAI } from "../services/aiIntake.js";
import { sendWhatsApp } from "../services/whatsapp.js";
import { isAgentHandling, storeBotMessage } from "../services/conversation.js";
import { supabase } from "../config/supabase.js";
import { normalizePhone } from "../lib/phone.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

const router = Router();

// How long to wait after the customer's LAST message before the bot replies.
// People often fire several messages in a row ("hi" … "my RO is leaking" …
// "since morning"). Without this pause the bot answers the first line while
// they're still typing the rest. Each new message resets the timer, so the bot
// only responds once the customer has actually paused — and it sees all the
// lines together.
const REPLY_DELAY_MS = 4500;
const pending = new Map(); // phone -> { parts: [], send, timer }

// Persist the inbound message FIRST (so the inquiry is never lost even if intake
// errors), then decide whether the bot should respond at all.
// Returns false when the message must be swallowed (staff / manager handoff).
async function logInbound(from, text, { mediaId, mediaType, waMessageId } = {}) {
  const phone = normalizePhone(from);
  const row = { from_phone: phone, body: text };
  if (mediaId) { row.media_id = mediaId; row.media_type = mediaType || null; }
  if (waMessageId) row.wa_message_id = waMessageId; // for native WhatsApp "reply" quoting
  let { error } = await supabase.from("wa_inbound").insert(row);
  if (error) {
    // An optional-feature migration may not be run yet (e.g. media_* or
    // wa_message_id columns). Never lose the customer's message — retry with
    // only the core columns that always exist.
    log.error("wa_inbound insert failed, retrying with core columns:", error.message);
    ({ error } = await supabase.from("wa_inbound").insert({ from_phone: phone, body: text }));
    if (error) log.error("wa_inbound core insert failed:", error.message);
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

  // Human handoff: if a manager messaged this customer in the last 12h, stay
  // silent and let them handle it. The inbound is still logged above, so the
  // reply shows in the dashboard chat. AI auto-resumes once the window lapses.
  if (await isAgentHandling(phone)) {
    log.info(`[handoff] AI paused for ${phone} — manager is handling`);
    return false;
  }
  return true;
}

// Run intake on the (possibly coalesced) text and store the bot's reply so the
// Service Manager sees the full thread on the dashboard.
async function runIntake(from, text) {
  const phone = normalizePhone(from);
  const reply = env.aiIntake
    ? await handleInboundAI({ fromPhone: from, text })
    : await handleInbound({ fromPhone: from, text });
  if (reply) await storeBotMessage(phone, reply);
  return reply;
}

// Synchronous path (mock/testing): log + reply immediately, no debounce.
async function getReply(from, text, media = {}) {
  if (!(await logInbound(from, text, media))) return null;
  return runIntake(from, text);
}

// Debounced path (live WhatsApp): buffer rapid-fire messages and reply once,
// REPLY_DELAY_MS after the customer's last message. `send` delivers the reply.
async function enqueueReply(from, text, media, send) {
  if (!(await logInbound(from, text, media))) return;
  const phone = normalizePhone(from);
  let p = pending.get(phone);
  if (!p) { p = { parts: [] }; pending.set(phone, p); }
  if (text) p.parts.push(text);
  p.send = send;
  if (p.timer) clearTimeout(p.timer);
  p.timer = setTimeout(() => flushReply(phone, from), REPLY_DELAY_MS);
}

async function flushReply(phone, from) {
  const p = pending.get(phone);
  if (!p) return;
  pending.delete(phone);
  try {
    const reply = await runIntake(from, p.parts.join("\n"));
    if (reply) await p.send(reply);
  } catch (e) {
    log.error("flushReply error:", e.message);
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

// ---- Inbound messages (POST) ----
router.post("/whatsapp", async (req, res) => {
  // ----- Meta WhatsApp Cloud API -----
  if (env.whatsappProvider === "meta") {
    res.sendStatus(200); // ack immediately so Meta doesn't retry/duplicate
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const msg = value?.messages?.[0];
      if (!msg) return; // delivery/read status events have no messages — ignore

      const from = "+" + msg.from; // Meta sends e.g. "918668732890" (no +)
      const text = msg.type === "text" ? msg.text?.body || "" : (msg.image?.caption || msg.video?.caption || "");
      const mediaId = msg.image?.id || msg.video?.id || msg.document?.id || null;
      const mediaType = msg.image?.mime_type || msg.video?.mime_type || msg.document?.mime_type || null;
      const waMessageId = msg.id || null; // wamid — lets the manager later "reply" to this exact message
      log.info(`[WA IN] ${from}: ${text || (mediaId ? `(media ${mediaType})` : "(non-text message)")}`);

      // Debounced: waits for the customer to finish before the bot replies once.
      await enqueueReply(from, text, { mediaId, mediaType, waMessageId }, (reply) => sendWhatsApp(from, reply));
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
