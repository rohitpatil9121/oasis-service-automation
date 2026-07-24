import { supabase } from "./src/config/supabase.js";

const { data } = await supabase
  .from("notifications")
  .select("created_at, recipient, status, last_error, body, provider_sid")
  .ilike("body", "%How was our service%")
  .order("created_at", { ascending: false })
  .limit(8);
for (const n of data || []) {
  console.log(`${n.created_at} | ${n.status} | err=${n.last_error || "-"} | sid=${n.provider_sid || "-"} | ${(n.body || "").replace(/\s+/g, " ").slice(0, 60)}`);
}

// did these customers message us within 24h per the same check the code uses?
const { data: msgs } = await supabase
  .from("messages")
  .select("created_at, from_phone, direction")
  .eq("direction", "inbound")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("--- last inbound messages ---");
for (const m of msgs || []) console.log(`${m.created_at} | ${m.from_phone}`);
