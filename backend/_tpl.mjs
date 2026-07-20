import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const IST="Asia/Kolkata", d=(x)=>x?new Date(x).toLocaleString("en-IN",{timeZone:IST,day:"numeric",month:"short",hour:"numeric",minute:"2-digit"}):"—";
const { data } = await sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(3000);

// body ke shuruati shabd se template pehchano
const SIG = [
  ["customer_request_received", /we have received your water purifier/i],
  ["customer_technician_assigned", /Technician assigned for your request|has been assigned to your request/i],
  ["customer_technician_enroute", /is on the way|Technician is on the way/i],
  ["customer_arrival_otp", /is your verification code/i],
  ["customer_estimate", /^Estimate for|Problem found/im],
  ["customer_estimate_approved", /Estimate approved/i],
  ["customer_work_completed", /Work completed for your request/i],
  ["customer_visit_charge", /Repair not approved/i],
  ["customer_payment_received", /Payment received/i],
  ["request_completed_customer", /has been marked/i],
  ["request_cancelled_customer", /has been cancelled/i],
  ["visit_scheduled_customer", /visit is scheduled/i],
  ["manager_new_request", /New service request/i],
  ["technician_new_job", /New job assigned to you/i],
  ["visit_scheduled_technician", /New visit scheduled for ticket/i],
  ["login_otp", /verification code. For your security/i],
];
const stats = {};
for (const n of data) {
  const hit = SIG.find(([,re]) => re.test(n.body||""));
  const key = hit ? hit[0] : "(pehchana nahi)";
  const s = (stats[key] ||= { sent:0, failed:0, last:null, errs:[] });
  if (n.status === "SENT") s.sent++; else { s.failed++; if(n.last_error) s.errs.push(n.last_error.slice(0,70)); }
  if (!s.last || new Date(n.created_at) > new Date(s.last)) s.last = n.created_at;
}
console.log(`kul ${data.length} messages ka record\n`);
console.log("TEMPLATE".padEnd(32) + "SENT".padStart(6) + "FAIL".padStart(6) + "  AAKHRI BAAR");
for (const [k,v] of Object.entries(stats).sort((a,b)=>b[1].sent-a[1].sent))
  console.log(`${k.padEnd(32)}${String(v.sent).padStart(6)}${String(v.failed).padStart(6)}  ${d(v.last)}${v.errs.length?"  err: "+v.errs[0]:""}`);
