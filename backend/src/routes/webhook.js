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

// Persist the inbound message FIRST (so the inquiry is never lost even if intake
// errors), then route to the AI agent or the deterministic state machine.
async function getReply(from, text) {
  const phone = normalizePhone(from);
  const { error } = await supabase
    .from("wa_inbound")
    .insert({ from_phone: phone, body: text });
  if (error) log.error("wa_inbound insert failed:", error.message);

  // If a registered TECHNICIAN messages the company number, don't run customer
  // intake — just log it (shows in their chat) so the manager can reply. Their
  // message still opens the 24-hour window, without the AI treating them as a
  // customer or raising a ticket.
  const { data: tech } = await supabase
    .from("users").select("id").eq("phone", phone).eq("role", "technician").maybeSingle();
  if (tech) {
    log.info(`[staff] technician ${phone} messaged — no AI intake`);
    return null;
  }

  // Human handoff: if a manager messaged this customer in the last 12h, stay
  // silent and let them handle it. The inbound is still logged above, so the
  // reply shows in the dashboard chat. AI auto-resumes once the window lapses.
  if (await isAgentHandling(phone)) {
    log.info(`[handoff] AI paused for ${phone} — manager is handling`);
    return null;
  }

  const reply = env.aiIntake
    ? await handleInboundAI({ fromPhone: from, text })
    : await handleInbound({ fromPhone: from, text });

  // Store the bot's reply so the Service Manager sees the full thread on the dashboard.
  if (reply) await storeBotMessage(phone, reply);
  return reply;
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
      const text = msg.type === "text" ? msg.text?.body || "" : "";
      log.info(`[WA IN] ${from}: ${text || "(non-text message)"}`);

      const reply = await getReply(from, text);
      if (reply) await sendWhatsApp(from, reply); // null = manager handoff, stay quiet
    } catch (e) {
      log.error("meta webhook error:", e.message);
    }
    return;
  }

  // ----- Twilio (form-encoded: From, Body) -----
  try {
    const from = req.body.From; // e.g. whatsapp:+918668732890
    const body = req.body.Body || "";
    log.info(`[WA IN] ${from}: ${body}`);

    const reply = await getReply(from, body);

    // Real Twilio mode: reply via the REST API; empty TwiML avoids a duplicate.
    if (!env.whatsappMock) {
      if (reply) await sendWhatsApp(from, reply); // null = manager handoff, stay quiet
      res.set("Content-Type", "text/xml").send("<Response></Response>");
    } else {
      // Mock mode: return the reply as JSON so you can test with curl/Postman.
      res.json({ from, reply });
    }
  } catch (e) {
    log.error("webhook error:", e.message);
    res.status(200).set("Content-Type", "text/xml").send("<Response></Response>");
  }
});

export default router;
