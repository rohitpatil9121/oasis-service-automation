import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const v = (val) => String(val ?? "").replace(/[\t\n\r]+/g," ").replace(/ {5,}/g,"    ").trim() || "—";
const show = (s) => JSON.stringify(s);

const { data: c } = await sb.from("customers").select("*").ilike("full_name","%Varsha%");
for (const x of c||[]) {
  console.log(`customer: ${show(x.full_name)}`);
  console.log(`  phone  : ${show(x.phone)}`);
  console.log(`  address: ${show(x.address)}`);
  console.log(`  v(name)   -> ${show(v(x.full_name))}`);
  console.log(`  v(address)-> ${show(v(x.address))}`);
  // Meta ke niyam: newline/tab nahi, 4 se zyada lagataar space nahi
  for (const [k,val] of [["name",v(x.full_name)],["address",v(x.address)]]) {
    const bad = [];
    if (/[\n\r\t]/.test(val)) bad.push("newline/tab");
    if (/ {5,}/.test(val)) bad.push("5+ space");
    if (!val) bad.push("khaali");
    if (val.length > 1024) bad.push("bahut lamba");
    console.log(`    ${k}: ${bad.length ? "GADBAD -> "+bad.join(", ") : "theek ✓"}  (length ${val.length})`);
  }
  const { data: t } = await sb.from("tickets").select("ticket_number, issue_description, status, created_at").eq("customer_id", x.id).order("created_at",{ascending:false}).limit(3);
  for (const tk of t||[]) console.log(`  ticket ${tk.ticket_number} issue=${show((tk.issue_description||"").slice(0,40))}`);
  console.log("");
}
