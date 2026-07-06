// TEMP: hard-delete all LIVE TEST tickets from the DB (except the one active
// test job), clearing FK references first (intake_sessions has no cascade).
// Run: node scripts/purge_test_tickets.js [--all]   (--all also deletes the active job)
import { supabase } from "../src/config/supabase.js";

const KEEP_CODE = process.argv.includes("--all") ? null : "OG-070726-0012";

async function main() {
  const { data: custs } = await supabase.from("customers").select("id").eq("full_name", "LIVE TEST Job");
  const ids = (custs || []).map((c) => c.id);
  if (!ids.length) { console.log("No LIVE TEST customer."); return; }

  let q = supabase.from("tickets").select("id, ticket_number").in("customer_id", ids);
  const { data: tickets } = await q;
  const toDelete = (tickets || []).filter((t) => t.ticket_number !== KEEP_CODE);
  console.log(`Deleting ${toDelete.length} tickets (keeping ${KEEP_CODE || "none"})`);

  const tids = toDelete.map((t) => t.id);
  if (tids.length) {
    // intake_sessions.ticket_id has no ON DELETE clause — clear it first.
    await supabase.from("intake_sessions").update({ ticket_id: null }).in("ticket_id", tids);
    const { error } = await supabase.from("tickets").delete().in("id", tids);
    if (error) { console.error("delete tickets:", error.message); return; }
  }
  console.log("Done. Remaining LIVE TEST tickets:",
    (await supabase.from("tickets").select("ticket_number").in("customer_id", ids)).data?.map((t) => t.ticket_number));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
