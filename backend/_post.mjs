import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IST="Asia/Kolkata", d=(x)=>new Date(x).toLocaleString("en-IN",{timeZone:IST,day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
const since = new Date(Date.now()-6*3600*1000).toISOString();
const { data } = await sb.from("notifications").select("*").gte("created_at", since).order("created_at",{ascending:false});
console.log(`pichhle 6 ghante me ${data.length} messages`);
const byAud={}, byStatus={};
for(const n of data){ byAud[n.audience||"?"]=(byAud[n.audience||"?"]||0)+1; byStatus[n.status]=(byStatus[n.status]||0)+1; }
console.log("  audience:", JSON.stringify(byAud));
console.log("  status  :", JSON.stringify(byStatus));
const tech = data.filter(n=>n.audience==="technician");
console.log(`\n  technician ko gaye: ${tech.length}  ${tech.length?"<- ABHI BHI JA RAHE ✗":"<- band ho gaye ✓"}`);
if(tech[0]) console.log(`    aakhri: ${d(tech[0].created_at)} "${(tech[0].body||"").slice(0,50).replace(/\n/g,' ')}"`);
const fails = data.filter(n=>n.status!=="SENT");
console.log(`\n  FAILED: ${fails.length}`);
for(const f of fails.slice(0,5)) console.log(`    ${d(f.created_at)} [${f.audience}] ${f.last_error?.slice(0,70)}\n      "${(f.body||"").slice(0,55).replace(/\n/g,' ')}"`);
