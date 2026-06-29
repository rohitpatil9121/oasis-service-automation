// TEMP test seeder for the Technician App. Creates a dummy technician + dummy
// clients + tickets assigned to that technician, and prints a JWT so we can call
// /api/tech/* as them. Direct DB inserts only — no WhatsApp messages are sent.
// Safe to re-run. Delete with: node scripts/seed_tech_test.js --clean
import { supabase } from "../src/config/supabase.js";
import { signToken } from "../src/middleware/auth.js";

const TECH_PHONE = "+919900000001";
const CLIENTS = [
  { full_name: "TEST Client Sharma", phone: "+919900000010", address: "Flat 7, Rose Icon, Wakad, Pune 411057", appliance: "Aquaguard RO+UV Marvel", issue: "Leakage near storage tank" },
  { full_name: "TEST Client Kulkarni", phone: "+919900000011", address: "Flat 9, Crystal Residency, Baner, Pune 411045", appliance: "Kent RO Grand Plus", issue: "Low water flow from purifier" },
];

async function upsert(table, match, row) {
  const { data: existing } = await supabase.from(table).select("*").match(match).maybeSingle();
  if (existing) {
    const { data } = await supabase.from(table).update(row).eq("id", existing.id).select().single();
    return data;
  }
  const { data, error } = await supabase.from(table).insert({ ...match, ...row }).select().single();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data;
}

async function clean() {
  // Remove tickets for our test customers, then the customers + technician.
  const { data: custs } = await supabase.from("customers").select("id").like("full_name", "TEST Client%");
  const ids = (custs || []).map((c) => c.id);
  if (ids.length) await supabase.from("tickets").delete().in("customer_id", ids);
  if (ids.length) await supabase.from("customers").delete().in("id", ids);
  await supabase.from("users").delete().eq("phone", TECH_PHONE);
  console.log("Cleaned up TEST technician + clients + their tickets.");
}

async function main() {
  if (process.argv.includes("--clean")) return clean();

  // tech_work column present?
  const { error: colErr } = await supabase.from("tickets").select("tech_work").limit(1);
  const migrated = !colErr;
  console.log(`tech_work column: ${migrated ? "PRESENT ✅" : "MISSING ❌ (run db/phase4_technician_app.sql)"}`);

  const tech = await upsert("users", { phone: TECH_PHONE }, {
    full_name: "TEST Technician Ramesh", role: "technician", is_active: true,
  });
  console.log(`Technician: ${tech.full_name} (${tech.id})`);

  for (const c of CLIENTS) {
    const cust = await upsert("customers", { phone: c.phone }, { full_name: c.full_name, address: c.address });
    // One ticket per test client, assigned to our technician.
    const { data: existing } = await supabase
      .from("tickets").select("id").eq("customer_id", cust.id).eq("assigned_technician_id", tech.id).maybeSingle();
    if (!existing) {
      const { data: t, error } = await supabase.from("tickets").insert({
        customer_id: cust.id, issue_description: c.issue, appliance: c.appliance,
        status: "ASSIGNED", assigned_technician_id: tech.id, source: "manual",
      }).select("id, ticket_number").single();
      if (error) throw new Error("ticket insert: " + error.message);
      console.log(`Ticket ${t.ticket_number || t.id} → ${c.full_name}`);
    } else {
      console.log(`Ticket already exists for ${c.full_name}`);
    }
  }

  const token = signToken(tech);
  console.log("\nTECH_TOKEN=" + token);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
