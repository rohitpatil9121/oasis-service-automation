import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IST="Asia/Kolkata", d=(x)=>new Date(x).toLocaleString("en-IN",{timeZone:IST,day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
const { data } = await sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(3000);

console.log("=== FAILED messages ===");
for (const n of data.filter(x=>x.status!=="SENT"))
  console.log(`  ${d(n.created_at)}  ${n.audience}  attempts=${n.attempts}\n    body: "${(n.body||"").slice(0,60).replace(/\n/g,' ')}"\n    err : ${n.last_error}`);

console.log("\n=== OTP / technician wale dhoondho ===");
const otp = data.filter(x=>/verification code|OTP/i.test(x.body||""));
console.log(`  verification code wale: ${otp.length}  (aakhri ${otp[0]?d(otp[0].created_at):"—"})`);
const tech = data.filter(x=>x.audience==="technician");
console.log(`  audience=technician   : ${tech.length}  (aakhri ${tech[0]?d(tech[0].created_at):"—"})`);
if(tech[0]) console.log(`    body: "${(tech[0].body||"").slice(0,70).replace(/\n/g,' ')}"`);

console.log("\n=== 'pehchana nahi' me se 5 namune ===");
const SIG=[/we have received/i,/assigned/i,/on the way/i,/verification code/i,/^Estimate for|Problem found/im,/Estimate approved/i,/Work completed/i,/Repair not approved/i,/Payment received/i,/marked/i,/cancelled/i,/scheduled/i,/New service request/i];
const unk = data.filter(n=>!SIG.some(re=>re.test(n.body||"")));
for(const n of unk.slice(0,5)) console.log(`  [${n.audience}] "${(n.body||"").slice(0,75).replace(/\n/g,' ')}"`);
const byAud={}; for(const n of unk) byAud[n.audience||"?"]=(byAud[n.audience||"?"]||0)+1;
console.log("  audience:", JSON.stringify(byAud));
