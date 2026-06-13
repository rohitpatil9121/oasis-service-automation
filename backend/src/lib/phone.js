import { env } from "../config/env.js";

// Normalise a phone number to E.164-ish (+<digits>).
// Strips Twilio "whatsapp:" prefix and spaces; prepends default country code
// when the user types a bare local number.
export function normalizePhone(raw) {
  if (!raw) return "";
  let s = String(raw).trim().replace(/^whatsapp:/i, "");
  s = s.replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  // bare local number -> prepend default country code
  return env.defaultCountryCode + s.replace(/^0+/, "");
}

export function toWhatsApp(phone) {
  const p = normalizePhone(phone);
  return p.startsWith("whatsapp:") ? p : `whatsapp:${p}`;
}

export function isValidPhone(raw) {
  const p = normalizePhone(raw);
  return /^\+\d{8,15}$/.test(p);
}
