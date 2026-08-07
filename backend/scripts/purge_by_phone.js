// Delete all requests (tickets) belonging to a customer phone number.
// Dry-run by default; pass --yes to actually delete.
// Run: node scripts/purge_by_phone.js +918668732890 [--yes]
import { supabase } from "../src/config/supabase.js";

const phone = process.argv[2];
const APPLY = process.argv.includes("--yes");
if (!phone) { console.error("usage: node scripts/purge_by_phone.js <E164 phone> [--yes]"); process.exit(1); }

// match with and without the leading +
const variants = [...new Set([phone, phone.replace(/^\+/, ""), phone.startsWith("+") ? phone : "+" + phone])];

async function main() {
  const { data: custs, error: cErr } = await supabase
    .from("customers").select("id, full_name, phone").in("phone", variants);
  if (cErr) throw cErr;
  console.log("Customers:", custs);

  const ids = (custs || []).map((c) => c.id);
  let tickets = [];
  if (ids.length) {
    const { data, error } = await supabase
      .from("tickets").select("id, ticket_number, status, issue_description, created_at")
      .in("customer_id", ids);
    if (error) throw error;
    tickets = data || [];
  }
  console.log(`Tickets found: ${tickets.length}`);
  tickets.forEach((t) => console.log(` - ${t.ticket_number} [${t.status}] ${t.created_at} :: ${String(t.issue_description).slice(0, 60)}`));

  const tids = tickets.map((t) => t.id);
  const { data: sessions } = await supabase.from("intake_sessions").select("id, state").in("phone", variants);
  const { data: inbound } = await supabase.from("wa_inbound").select("id").in("from_phone", variants);
  const { data: invoices } = tids.length
    ? await supabase.from("invoices").select("id, invoice_no, fy, seq, total").in("ticket_id", tids) : { data: [] };
  const { data: issues } = tids.length
    ? await supabase.from("stock_issues").select("id").in("ticket_id", tids) : { data: [] };
  const { data: moves } = tids.length
    ? await supabase.from("stock_movements").select("id").in("ticket_id", tids) : { data: [] };
  console.log(`intake_sessions: ${sessions?.length || 0}, wa_inbound: ${inbound?.length || 0}`);
  console.log(`invoices: ${invoices?.length || 0} ${(invoices || []).map((i) => i.invoice_no).join(", ")}`);
  console.log(`stock_issues: ${issues?.length || 0}, stock_movements: ${moves?.length || 0}`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --yes to delete."); return; }

  if (tids.length) {
    // Clear/remove every FK reference to tickets first (none of these cascade).
    await supabase.from("intake_sessions").update({ ticket_id: null }).in("ticket_id", tids);
    await supabase.from("stock_movements").update({ ticket_id: null }).in("ticket_id", tids);
    for (const tbl of ["invoices", "stock_issues"]) {
      const { error } = await supabase.from(tbl).delete().in("ticket_id", tids);
      if (error) throw new Error(`${tbl}: ${error.message}`);
      console.log(`Cleared ${tbl}.`);
    }
    const { error } = await supabase.from("tickets").delete().in("id", tids);
    if (error) throw error;
    console.log(`Deleted ${tids.length} tickets.`);

    // Re-align each affected FY counter with the highest surviving invoice seq.
    for (const fy of [...new Set((invoices || []).map((i) => i.fy))]) {
      const { data: rest } = await supabase
        .from("invoices").select("seq").eq("fy", fy).order("seq", { ascending: false }).limit(1);
      const last = rest?.[0]?.seq || 0;
      const { error: uErr } = await supabase.from("invoice_counters").update({ last_seq: last }).eq("fy", fy);
      if (uErr) console.error(`invoice_counters ${fy}:`, uErr.message);
      else console.log(`invoice_counters[${fy}].last_seq -> ${last}`);
    }
  }
  const { error: sErr } = await supabase.from("intake_sessions").delete().in("phone", variants);
  if (sErr) console.error("intake_sessions:", sErr.message); else console.log("Deleted intake sessions.");
  const { error: wErr } = await supabase.from("wa_inbound").delete().in("from_phone", variants);
  if (wErr) console.error("wa_inbound:", wErr.message); else console.log("Deleted wa_inbound rows.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
