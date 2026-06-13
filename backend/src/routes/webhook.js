import { Router } from "express";
import { handleInbound } from "../services/intake.js";
import { sendWhatsApp } from "../services/whatsapp.js";
import { supabase } from "../config/supabase.js";
import { normalizePhone } from "../lib/phone.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

const router = Router();

// Twilio WhatsApp inbound webhook.
// Twilio posts application/x-www-form-urlencoded: From, To, Body, ...
router.post("/whatsapp", async (req, res) => {
  try {
    const from = req.body.From;   // e.g. whatsapp:+918668732890
    const body = req.body.Body || "";
    log.info(`[WA IN] ${from}: ${body}`);

    // Persist the raw inbound FIRST - even if intake fails below, the
    // inquiry is on record and can be recovered.
    const { error: logErr } = await supabase
      .from("wa_inbound")
      .insert({ from_phone: normalizePhone(from), body });
    if (logErr) log.error("wa_inbound insert failed:", logErr.message);

    const reply = await handleInbound({ fromPhone: from, text: body });

    // In real Twilio mode we reply via the REST API (works for sandbox too).
    // Returning empty TwiML prevents Twilio from sending a duplicate.
    if (!env.whatsappMock) {
      await sendWhatsApp(from, reply);
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
