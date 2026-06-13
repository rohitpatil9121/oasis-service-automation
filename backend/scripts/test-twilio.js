// Standalone Twilio connectivity test. Ignores WHATSAPP_MOCK and sends ONE
// real WhatsApp message, so you can confirm your credentials + sandbox work.
//
// Usage:
//   node scripts/test-twilio.js                 -> sends to MANAGER_WHATSAPP
//   node scripts/test-twilio.js +918668732890   -> sends to that number
import twilio from "twilio";
import { env } from "../src/config/env.js";
import { toWhatsApp } from "../src/lib/phone.js";

const target = process.argv[2] || env.managerWhatsapp;

console.log("Twilio test ----------------------------------------");
console.log("Account SID :", env.twilioSid ? env.twilioSid.slice(0, 8) + "..." : "(missing)");
console.log("From        :", env.twilioFrom);
console.log("To          :", toWhatsApp(target));
console.log("----------------------------------------------------");

if (!env.twilioSid || !env.twilioToken) {
  console.error("✗ TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing in .env");
  process.exit(1);
}
if (!target) {
  console.error("✗ No recipient. Pass a number or set MANAGER_WHATSAPP in .env");
  process.exit(1);
}

const client = twilio(env.twilioSid, env.twilioToken);

try {
  const msg = await client.messages.create({
    from: env.twilioFrom,
    to: toWhatsApp(target),
    body: "✅ Oasis Globe Twilio test - if you got this, WhatsApp sending works!",
  });
  console.log("✓ Sent. Message SID:", msg.sid);
  console.log("  Status:", msg.status);
  console.log("  Check the WhatsApp on", target, "in a few seconds.");
  process.exit(0);
} catch (e) {
  console.error("✗ Twilio rejected the message.");
  console.error("  Code   :", e.code);
  console.error("  Message:", e.message);
  if (e.code === 20003) console.error("  -> Bad credentials. Re-check SID/auth token (they may have been rotated).");
  if (e.code === 63015 || e.code === 63007)
    console.error("  -> The recipient hasn't joined your WhatsApp sandbox. Send 'join <code>' from that phone first.");
  if (e.code === 21211 || e.code === 21608)
    console.error("  -> Number not valid / not verified for the sandbox.");
  process.exit(1);
}
