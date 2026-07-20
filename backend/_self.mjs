import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const V=process.env.META_GRAPH_VERSION||"v21.0";
const r = await fetch(`https://graph.facebook.com/${V}/${process.env.META_PHONE_NUMBER_ID}?access_token=${process.env.META_ACCESS_TOKEN}`);
const me = await r.json();
const own = String(me.display_phone_number||"").replace(/\D/g,"");
console.log(`business ka apna number : +${own}`);

const { data: fails } = await sb.from("notifications").select("recipient, body, last_error, created_at, attempts").neq("status","SENT");
console.log(`\nFAILED messages: ${fails.length}`);
for (const f of fails) {
  const rec = String(f.recipient||"").replace(/\D/g,"");
  console.log(`  -> ${f.recipient}  ${rec===own ? "*** APNE HI NUMBER PAR *** <- yahi wajah" : ""}`);
  console.log(`     ${f.last_error?.slice(0,60)}  (attempts ${f.attempts})`);
}
const { data: selfCust } = await sb.from("customers").select("id, full_name, phone").eq("phone", "+"+own);
console.log(`\napne number se bane customer records: ${selfCust?.length||0}`);
for (const c of selfCust||[]) {
  const { data: t } = await sb.from("tickets").select("ticket_number, status, created_at").eq("customer_id", c.id);
  console.log(`  "${c.full_name}" -> ${t?.length||0} tickets: ${(t||[]).map(x=>x.ticket_number+"("+x.status+")").join(", ")}`);
}
