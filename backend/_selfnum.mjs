import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IST="Asia/Kolkata", d=(x)=>new Date(x).toLocaleString("en-IN",{timeZone:IST,day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
const OWN = "+918855000092";
const { data: c } = await sb.from("customers").select("*").eq("phone", OWN);
console.log(`apne number (${OWN}) se bane customer: ${c.length}`);
for (const x of c) {
  console.log(`  "${x.full_name}"  bana: ${d(x.created_at)}`);
  const { data: t } = await sb.from("tickets").select("ticket_number,status,created_at,issue_description").eq("customer_id",x.id).order("created_at",{ascending:false});
  console.log(`  tickets: ${t.length}`);
  for (const tk of t) console.log(`    ${tk.ticket_number} ${String(tk.status).padEnd(10)} ${d(tk.created_at)}  "${(tk.issue_description||"").slice(0,30)}"`);
}
const { data: inb } = await sb.from("wa_inbound").select("created_at, body").eq("from_phone", OWN).order("created_at",{ascending:false}).limit(5);
console.log(`\napne number se aaye inbound messages: ${inb?.length||0}`);
for (const m of inb||[]) console.log(`  ${d(m.created_at)} "${(m.body||"").slice(0,50)}"`);
