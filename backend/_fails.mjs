import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IST="Asia/Kolkata", d=(x)=>new Date(x).toLocaleString("en-IN",{timeZone:IST,day:"numeric",month:"short",hour:"numeric",minute:"2-digit"});
const { data } = await sb.from("notifications").select("*").neq("status","SENT").order("created_at",{ascending:false});
const SIG=[["customer_request_received",/we have received your water purifier/i],["customer_technician_assigned",/assigned/i],["customer_technician_enroute",/on the way/i],["customer_arrival_otp",/verification code/i],["customer_estimate",/^Estimate for|Problem found/im],["customer_estimate_approved",/Estimate approved/i],["customer_work_completed",/Work completed/i],["customer_visit_charge",/Repair not approved/i],["customer_payment_received",/Payment received/i],["request_completed_customer",/has been marked/i],["request_cancelled_customer",/cancelled/i],["visit_scheduled_customer",/visit is scheduled/i],["manager_new_request",/New service request/i],["technician_new_job",/New (job )?assignment|New job assigned/i]];
const g={};
for(const n of data){
  const hit=SIG.find(([,re])=>re.test(n.body||""));
  const tpl=hit?hit[0]:"(pehchana nahi)";
  const err=(n.last_error||"").match(/#\d+\)?[^:]*/)?.[0]?.slice(0,40)||"?";
  const k=`${tpl} || ${err}`;
  (g[k] ||= {n:0, last:null, sample:n});
  g[k].n++; if(!g[k].last||new Date(n.created_at)>new Date(g[k].last)) g[k].last=n.created_at;
}
console.log(`kul FAILED: ${data.length}\n`);
for(const [k,v] of Object.entries(g).sort((a,b)=>b[1].n-a[1].n)){
  const [tpl,err]=k.split(" || ");
  console.log(`${String(v.n).padStart(3)}x  ${tpl.padEnd(30)} ${err}`);
  console.log(`      aakhri: ${d(v.last)}   -> ${v.sample.recipient}`);
}
