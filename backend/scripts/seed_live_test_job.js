// TEMP: create test jobs at each workflow state for the given tech, so every
// screen (Start Travel, Diagnosis, Estimate, Payment) can be reviewed in preview.
// Run:   node scripts/seed_live_test_job.js
// Clean: node scripts/seed_live_test_job.js --clean
import { supabase } from "../src/config/supabase.js";

const TECH_ID = "7e6f3de4-a303-4720-bc1b-0c77ac9016ef"; // test adarsh
const CUST_PHONE = "+919702086462";
const CUST_NAME = "LIVE TEST Job";
const now = () => new Date().toISOString();

// One fresh job at the very start of the flow (Start Travel) — walk it end to end.
const STATES = [
  { label: "NEW (Start Travel)", tech_work: {} },
];

async function clean() {
  // Deleting tickets can silently fail on FK references (logs/notifications),
  // so cancel them instead — the tech app hides CANCELLED jobs.
  const { data: custs } = await supabase.from("customers").select("id").eq("full_name", CUST_NAME);
  const ids = (custs || []).map((c) => c.id);
  if (ids.length) {
    const { error, count } = await supabase
      .from("tickets").update({ status: "CANCELLED" }, { count: "exact" })
      .in("customer_id", ids).neq("status", "CANCELLED");
    if (error) console.error("cancel tickets:", error.message);
    else console.log(`Cancelled ${count ?? "?"} LIVE TEST tickets.`);
  } else {
    console.log("No LIVE TEST customer found.");
  }
}

async function main() {
  if (process.argv.includes("--clean")) return clean();
  await clean(); // start fresh so we don't pile up duplicates

  const { data: cust } = await supabase
    .from("customers")
    .upsert({ full_name: CUST_NAME, phone: CUST_PHONE, address: "A1-903, Nandan Inspera, Wakad, Pune - 411057" }, { onConflict: "phone" })
    .select().single();

  for (const s of STATES) {
    const { data: t, error } = await supabase.from("tickets").insert({
      customer_id: cust.id,
      issue_description: "Water flow very slow.",
      appliance: "—",
      status: s.tech_work?.tech_status ? "IN_PROGRESS" : "ASSIGNED",
      assigned_technician_id: TECH_ID,
      source: "manual",
      tech_work: s.tech_work,
    }).select("id, ticket_number").single();
    if (error) throw new Error(`insert ${s.label}: ${error.message}`);
    console.log(`${t.ticket_number} → ${s.label}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
