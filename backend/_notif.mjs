import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const probe = await sb.from("notifications").select("*").limit(1);
if (probe.error) { console.log("notifications table:", probe.error.message); process.exit(0); }
console.log("columns:", Object.keys(probe.data[0]||{}).join(", "));
const { data } = await sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(1500);
console.log(`kul records: ${data.length}\n`);
const byStatus = {}; for (const n of data) byStatus[n.status||"?"] = (byStatus[n.status||"?"]||0)+1;
console.log("status:", JSON.stringify(byStatus));
