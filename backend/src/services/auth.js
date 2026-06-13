// Staff authentication: phone + password, plus WhatsApp OTP as a second
// factor / passwordless path. Tokens are signed JWTs (see middleware/auth.js).
import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { normalizePhone } from "../lib/phone.js";
import { queueNotification } from "./notifications.js";
import { log } from "../lib/logger.js";

async function findByPhone(phone) {
  const { data } = await supabase
    .from("users").select("*").eq("phone", normalizePhone(phone)).maybeSingle();
  return data;
}

export async function verifyPassword(phone, password) {
  const user = await findByPhone(phone);
  if (!user || !user.is_active || !user.password_hash) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  return ok ? user : null;
}

// Generate a 6-digit OTP, store its hash + expiry, and WhatsApp it to the user.
export async function requestOtp(phone) {
  const user = await findByPhone(phone);
  // Do not reveal whether the account exists.
  if (!user || !user.is_active) {
    log.warn("OTP requested for unknown/inactive phone:", phone);
    return { sent: true };
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + env.otpTtlSeconds * 1000).toISOString();
  await supabase.from("users")
    .update({ otp_code: await bcrypt.hash(code, 10), otp_expires_at: expires })
    .eq("id", user.id);

  await queueNotification({
    recipient: user.phone, audience: user.role,
    body: `Your Oasis Globe login code is ${code}. It expires in ` +
          `${Math.round(env.otpTtlSeconds / 60)} minutes.`,
  });
  return { sent: true };
}

export async function verifyOtp(phone, code) {
  const user = await findByPhone(phone);
  if (!user || !user.otp_code || !user.otp_expires_at) return null;
  if (new Date(user.otp_expires_at).getTime() < Date.now()) return null;
  const ok = await bcrypt.compare(String(code), user.otp_code);
  if (!ok) return null;
  // Single-use: clear it.
  await supabase.from("users")
    .update({ otp_code: null, otp_expires_at: null }).eq("id", user.id);
  return user;
}

export async function getById(id) {
  const { data } = await supabase
    .from("users").select("id, full_name, phone, email, role, is_active")
    .eq("id", id).single();
  return data;
}

export async function setPassword(phone, password) {
  const hash = await bcrypt.hash(password, 10);
  const { data } = await supabase.from("users")
    .update({ password_hash: hash }).eq("phone", normalizePhone(phone))
    .select("id").maybeSingle();
  return !!data;
}
