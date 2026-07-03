// Diagnose why a customer's INBOUND WhatsApp messages aren't showing in the
// dashboard chat. Checks the customer record, counts what's actually stored in
// wa_inbound vs notifications for their phone, and does a live test insert into
// wa_inbound so any schema/permission error surfaces with its exact message.
//
// Usage:  node scripts/diagnose-inbound.js +919136383880
// (Needs the same .env the backend uses — SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.)
import { supabase } from "../src/config/supabase.js";
import { normalizePhone } from "../src/lib/phone.js";
import { env } from "../src/config/env.js";

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node scripts/diagnose-inbound.js <phone>   e.g. +919136383880");
  process.exit(1);
}
const phone = normalizePhone(raw);
const line = () => console.log("─".repeat(60));

console.log(`\nDiagnosing inbound for: ${raw}  →  normalized: ${phone}`);
if (!env.supabaseUrl || !env.supabaseServiceKey || /PASTE_YOUR/.test(env.supabaseUrl + env.supabaseServiceKey)) {
  console.error("\n✗ Supabase credentials not filled in.");
  console.error("  Open backend/.env and replace the PASTE_YOUR_… placeholders with your");
  console.error("  Project URL and service_role key (Supabase → Project Settings → API), then re-run.");
  process.exit(1);
}
line();

// 1) Customer record — confirms the phone the dashboard will look up.
const { data: cust, error: custErr } = await supabase
  .from("customers").select("id, full_name, phone").eq("phone", phone).maybeSingle();
if (custErr) console.log("customers query error:", custErr.message);
console.log("1) Customer record:", cust
  ? `found "${cust.full_name || "(no name)"}"  phone=${cust.phone}`
  : "NOT FOUND for this exact phone — the dashboard keys the chat off customers.phone.");

// 2) What's actually stored for this phone.
const { data: inbound, error: inErr } = await supabase
  .from("wa_inbound").select("id, body, media_id, created_at")
  .eq("from_phone", phone).order("created_at", { ascending: false }).limit(5);
const { count: inCount } = await supabase
  .from("wa_inbound").select("id", { count: "exact", head: true }).eq("from_phone", phone);
const { count: outCount } = await supabase
  .from("notifications").select("id", { count: "exact", head: true })
  .eq("recipient", phone).in("audience", ["customer", "agent", "bot"]);

line();
console.log(`2) Stored for this phone:`);
console.log(`   wa_inbound (customer messages): ${inCount ?? "?"} row(s)`);
console.log(`   notifications (bot/agent replies): ${outCount ?? "?"} row(s)`);
if (inErr) console.log("   wa_inbound query error:", inErr.message);
if (inbound?.length) {
  console.log("   latest inbound:");
  for (const m of inbound) console.log(`     • ${m.created_at} — ${m.body ? JSON.stringify(m.body.slice(0, 50)) : "(no text)"}${m.media_id ? " [media]" : ""}`);
}

// 3) Diagnosis of the mismatch.
line();
if ((inCount ?? 0) === 0 && (outCount ?? 0) > 0) {
  console.log("3) ⚠  Bot replies exist but ZERO customer messages are stored.");
  console.log("   → Inbound inserts are failing. The live test below shows why.");
} else if ((inCount ?? 0) > 0) {
  console.log("3) ✓  Customer messages ARE stored for this phone.");
  console.log("   If they don't show in the dashboard, the mismatch is elsewhere (report this output).");
} else {
  console.log("3) No inbound and no outbound for this phone — nothing has been exchanged, or the phone differs.");
}

// 4) Live test insert — reveals the exact schema/permission error, then cleans up.
line();
console.log("4) Test insert into wa_inbound (will be deleted):");
const marker = "__diag__" + Date.now();
const full = { from_phone: phone, body: marker, media_id: null, media_type: null, wa_message_id: marker, reply_to_wamid: null };
let { error: fullErr } = await supabase.from("wa_inbound").insert(full);
if (fullErr) {
  console.log("   ✗ full insert failed:", fullErr.message, fullErr.code ? `(code ${fullErr.code})` : "");
  const { error: coreErr } = await supabase.from("wa_inbound").insert({ from_phone: phone, body: marker });
  if (coreErr) console.log("   ✗ core insert ALSO failed:", coreErr.message, coreErr.code ? `(code ${coreErr.code})` : "  ← this is the root cause");
  else console.log("   ✓ core insert OK → an optional column is missing. Run the migrations in backend/db (media / reply-context / dedupe).");
} else {
  console.log("   ✓ insert OK — the table accepts writes. Inbound failures are intermittent or elsewhere.");
}
await supabase.from("wa_inbound").delete().eq("body", marker);
line();
console.log("Done. Paste this output back and I'll tell you the exact fix.\n");
process.exit(0);
