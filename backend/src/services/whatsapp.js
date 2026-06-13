import twilio from "twilio";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";
import { toWhatsApp, normalizePhone } from "../lib/phone.js";

// ---------- Twilio ----------
let twilioClient = null;
function getTwilio() {
  if (!twilioClient) twilioClient = twilio(env.twilioSid, env.twilioToken);
  return twilioClient;
}

async function sendViaTwilio(toPhone, body) {
  const res = await getTwilio().messages.create({
    from: env.twilioFrom,
    to: toWhatsApp(toPhone),
    body,
  });
  return { sid: res.sid };
}

// ---------- Meta WhatsApp Cloud API ----------
async function sendViaMeta(toPhone, body) {
  // Meta wants the number as digits only, no "+" or "whatsapp:".
  const to = normalizePhone(toPhone).replace(/\D/g, "");
  const url = `https://graph.facebook.com/${env.metaGraphVersion}/${env.metaPhoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Meta returns a helpful error object; surface its message.
    throw new Error(`Meta send failed (${res.status}): ${data.error?.message || "unknown"}`);
  }
  return { sid: data.messages?.[0]?.id };
}

// ---------- Unified send ----------
// In mock mode (WHATSAPP_MOCK=true) it just logs and returns a fake SID, so the
// whole system runs end-to-end with no credentials. Otherwise it dispatches to
// the configured provider (WHATSAPP_PROVIDER=twilio|meta).
export async function sendWhatsApp(toPhone, body) {
  if (env.whatsappMock) {
    const sid = "MOCK-" + Math.random().toString(36).slice(2, 10);
    log.info(`[WA MOCK] -> ${toPhone}\n${body}\n[sid ${sid}]`);
    return { sid, mock: true };
  }

  const result =
    env.whatsappProvider === "meta"
      ? await sendViaMeta(toPhone, body)
      : await sendViaTwilio(toPhone, body);

  log.info(`[WA SENT ${env.whatsappProvider}] ${result.sid} -> ${toPhone}`);
  return { ...result, mock: false };
}
