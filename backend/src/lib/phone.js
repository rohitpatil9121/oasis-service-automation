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
  s = s.replace(/^0+/, "");
  // User typed the country code but omitted the "+" (e.g. "919812345678").
  // An Indian mobile is 10 digits, so anything longer that already leads with
  // the country-code digits is treated as already-prefixed — don't add it again.
  const cc = env.defaultCountryCode.replace(/\D/g, "");
  if (cc && s.length > 10 && s.startsWith(cc)) return "+" + s;
  // bare local number -> prepend default country code
  return env.defaultCountryCode + s;
}

export function toWhatsApp(phone) {
  const p = normalizePhone(phone);
  return p.startsWith("whatsapp:") ? p : `whatsapp:${p}`;
}

export function isValidPhone(raw) {
  const p = normalizePhone(raw);
  return /^\+\d{8,15}$/.test(p);
}
