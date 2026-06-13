import twilio from "twilio";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { toWhatsApp } from "../lib/phone.js";

let client = null;
function getClient() {
  if (!client) client = twilio(env.twilioSid, env.twilioToken);
  return client;
}

// Sends a WhatsApp message. In mock mode (WHATSAPP_MOCK=true) it just logs
// and returns a fake SID, so the whole system runs end-to-end with no creds.
export async function sendWhatsApp(toPhone, body) {
  const to = toWhatsApp(toPhone);

  if (env.whatsappMock) {
    const sid = "MOCK-" + Math.random().toString(36).slice(2, 10);
    log.info(`[WA MOCK] -> ${to}\n${body}\n[sid ${sid}]`);
    return { sid, mock: true };
  }

  const res = await getClient().messages.create({
    from: env.twilioFrom,
    to,
    body,
  });
  log.info(`[WA SENT] ${res.sid} -> ${to}`);
  return { sid: res.sid, mock: false };
}
