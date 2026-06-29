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
// `contextMessageId` (optional) is the wamid of a message to quote — turns this
// into a native WhatsApp "reply" that shows the original message above it.
async function sendViaMeta(toPhone, body, contextMessageId) {
  // Meta wants the number as digits only, no "+" or "whatsapp:".
  const to = normalizePhone(toPhone).replace(/\D/g, "");
  const url = `https://graph.facebook.com/${env.metaGraphVersion}/${env.metaPhoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body },
  };
  if (contextMessageId) payload.context = { message_id: contextMessageId };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Meta returns a helpful error object; surface its message.
    throw new Error(`Meta send failed (${res.status}): ${data.error?.message || "unknown"}`);
  }
  return { sid: data.messages?.[0]?.id };
}

// Send an interactive message (Meta only): reply buttons OR a single-select list.
// `interactive` is the Meta `interactive` object ({ type: "button"|"list", body,
// action }) — the caller builds it (see services/tickets.js for the rating list).
// The customer's tap comes back on the webhook as interactive.button_reply or
// interactive.list_reply, carrying the row/button id we set here.
async function sendInteractiveViaMeta(toPhone, interactive) {
  const to = normalizePhone(toPhone).replace(/\D/g, "");
  const url = `https://graph.facebook.com/${env.metaGraphVersion}/${env.metaPhoneNumberId}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "interactive", interactive }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Meta interactive send failed (${res.status}): ${data.error?.message || "unknown"}`);
  }
  return { sid: data.messages?.[0]?.id };
}

// Send a pre-approved template (Meta only). Templates bypass the 24-hour
// customer-service window, so this is how staff alerts actually get delivered.
// `template` = { name, language, variables: [...] } (see services/waTemplates.js).
async function sendTemplateViaMeta(toPhone, { name, language = "en", variables = [], otpCode }) {
  const to = normalizePhone(toPhone).replace(/\D/g, "");
  const url = `https://graph.facebook.com/${env.metaGraphVersion}/${env.metaPhoneNumberId}/messages`;

  // Body variables map to the {{1}}, {{2}}, ... in the approved template.
  const components = variables.length
    ? [{ type: "body", parameters: variables.map((text) => ({ type: "text", text: String(text ?? "") })) }]
    : [];

  // Authentication templates carry a copy-code button; Meta requires the code to
  // be passed to that button too, or the send fails with a parameter mismatch.
  if (otpCode)
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: String(otpCode) }],
    });

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
// `opts.contextMessageId` (optional) quotes an earlier message (Meta only) so
// the customer sees a native WhatsApp "reply".
export async function sendWhatsApp(toPhone, body, opts = {}) {
  if (env.whatsappMock) {
    const sid = "MOCK-" + Math.random().toString(36).slice(2, 10);
    const q = opts.contextMessageId ? ` [reply→ ${opts.contextMessageId}]` : "";
    log.info(`[WA MOCK] -> ${toPhone}${q}\n${body}\n[sid ${sid}]`);
    return { sid, mock: true };
  }

  const result =
    env.whatsappProvider === "meta"
      ? await sendViaMeta(toPhone, body, opts.contextMessageId)
      : await sendViaTwilio(toPhone, body); // Twilio: no quoting; sends normally

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

// Pull the tappable option titles out of either interactive shape, for the mock log.
function interactiveOptions(interactive) {
  if (interactive?.action?.buttons) return interactive.action.buttons.map((b) => b.reply?.title);
  if (interactive?.action?.sections) return interactive.action.sections.flatMap((s) => (s.rows || []).map((r) => r.title));
  return [];
}

// Send an interactive message with graceful fallbacks. Interactive messages are a
// Meta feature: in mock mode we log, and on Twilio (no equivalent) we send
// `fallbackBody` as plain text so the customer still gets the message.
// `interactive` is the Meta interactive object (button or list).
export async function sendWhatsAppInteractive(toPhone, interactive, fallbackBody) {
  if (env.whatsappMock) {
    const sid = "MOCK-" + Math.random().toString(36).slice(2, 10);
    const opts = interactiveOptions(interactive).map((t) => `[${t}]`).join(" ");
    log.info(`[WA MOCK INTERACTIVE] -> ${toPhone}\n${interactive?.body?.text || fallbackBody || ""}\n${opts}\n[sid ${sid}]`);
    return { sid, mock: true };
  }

  if (env.whatsappProvider !== "meta") {
    const result = await sendViaTwilio(toPhone, fallbackBody || interactive?.body?.text || "");
    log.info(`[WA SENT twilio] ${result.sid} -> ${toPhone}`);
    return { ...result, mock: false };
  }

  const result = await sendInteractiveViaMeta(toPhone, interactive);
  log.info(`[WA INTERACTIVE SENT ${interactive?.type}] ${result.sid} -> ${toPhone}`);
  return { ...result, mock: false };
}
