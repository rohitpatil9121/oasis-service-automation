import { supabase } from "./src/config/supabase.js";

const { data } = await supabase.from("wa_inbound").select("created_at, body")
  .eq("from_phone", "+918668732890").order("created_at", { ascending: false }).limit(8);
console.log("inbound from +918668732890:", (data || []).length);
for (const m of data || []) console.log(`${m.created_at} | ${(m.body || "").slice(0, 50)}`);

const { data: t } = await supabase.from("tickets")
  .select("ticket_number, source, created_at, issue_description, customer:customers(phone, full_name)")
  .in("ticket_number", ["OG-250726-0001", "OG-250726-0002"]);
for (const x of t || []) console.log(JSON.stringify(x));
