import { supabase } from "./src/config/supabase.js";

const r = await supabase.from("wa_inbound").select("created_at, from_phone").order("created_at", { ascending: false }).limit(5);
console.log("wa_inbound err:", r.error?.message || "-");
for (const m of r.data || []) console.log(`${m.created_at} | [${m.from_phone}]`);

const c = await supabase.from("customers").select("phone, full_name").order("created_at", { ascending: false }).limit(5);
console.log("--- customers ---", c.error?.message || "");
for (const x of c.data || []) console.log(`[${x.phone}] ${x.full_name}`);
