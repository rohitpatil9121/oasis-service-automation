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

// Send a pre-approved template (Meta only). Templates bypass the 24-hour
// customer-service window, so this is how staff alerts actually get delivered.
// `template` = { name, language, variables: [...] } (see services/waTemplates.js).
async function sendTemplateViaMeta(toPhone, { name, language = "en", variables = [] }) {
  const to = normalizePhone(toPhone).replace(/\D/g, "");
  const url = `https://graph.facebook.com/${env.metaGraphVersion}/${env.metaPhoneNumberId}/messages`;

  // Body variables map to the {{1}}, {{2}}, ... in the approved template.
  const components = variables.length
    ? [{ type: "body", parameters: variables.map((text) => ({ type: "text", text: String(text ?? "") })) }]
    : [];

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name, language: { code: language }, components },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Meta template send failed (${res.status}): ${data.error?.message || "unknown"}`);
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

// Send a template, falling back to free-form text where templates don't apply.
// `fallbackBody` is the readable version used for mock logs and for Twilio
// (which doesn't use Meta templates). On Meta it sends the real template so the
// message reaches staff who are outside the 24-hour window.
export async function sendWhatsAppTemplate(toPhone, template, fallbackBody) {
  if (env.whatsappMock) {
    const sid = "MOCK-" + Math.random().toString(36).slice(2, 10);
    log.info(`[WA MOCK TEMPLATE ${template.name}] -> ${toPhone}\n${fallbackBody}\n[sid ${sid}]`);
    return { sid, mock: true };
  }

  if (env.whatsappProvider !== "meta") {
    // Templates are a Meta concept; on Twilio just send the readable text.
    const result = await sendViaTwilio(toPhone, fallbackBody);
    log.info(`[WA SENT twilio] ${result.sid} -> ${toPhone}`);
    return { ...result, mock: false };
  }

  const result = await sendTemplateViaMeta(toPhone, template);
  log.info(`[WA TEMPLATE SENT ${template.name}] ${result.sid} -> ${toPhone}`);
  return { ...result, mock: false };
}
