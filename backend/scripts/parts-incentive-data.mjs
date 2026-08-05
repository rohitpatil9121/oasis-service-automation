/* Emits the part-by-part incentive data as JSON on stdout.
   Feeds scripts/make-parts-excel.py — kept separate so the numbers come from
   partIncentive() (the function that actually pays technicians) while the
   spreadsheet formatting lives in Python.

   Usage, from backend/:
     node --env-file=.env scripts/parts-incentive-data.mjs > parts.json
*/
import { RULES, partIncentive } from "../src/services/incentives.js";
import { supabase } from "../src/config/supabase.js";

const { data, error } = await supabase
  .from("stock_items")
  .select("id, name, brand, unit_price, base_cost, is_active, hsn_code, gst_rate")
  .order("brand")
  .order("name");
if (error) throw new Error(error.message);

const parts = (data || []).filter((p) => p.is_active !== false);
const catalog = new Map(parts.map((p) => [p.id, {
  name: p.name, brand: p.brand || null, base_cost: Number(p.base_cost || 0),
}]));

const RULE_TEXT = {
  kent: `${RULES.BRAND_RATE * 100}% / ${RULES.BRAND_RATE_BONUS * 100}% of price`,
  aquaguard: `${RULES.BRAND_RATE * 100}% / ${RULES.BRAND_RATE_BONUS * 100}% of price`,
  oasis: "Margin (price - cost)",
  other: "No incentive",
};

const rows = parts.map((p) => {
  const price = Number(p.unit_price || 0);
  const cost = Number(p.base_cost || 0);
  const brand = p.brand || "other";
  const line = { id: p.id, price, qty: 1 };
  const branded = brand === "kent" || brand === "aquaguard";
  return {
    name: p.name,
    brand,
    brand_label: { kent: "Kent", aquaguard: "Aquaguard", oasis: "Oasis", other: "No brand" }[brand],
    price,
    cost,
    cost_missing: brand === "oasis" && !cost,
    rule: RULE_TEXT[brand],
    pays_6_cash: partIncentive(line, catalog, RULES.BRAND_RATE, "cash").payout,
    pays_10_cash: partIncentive(line, catalog, RULES.BRAND_RATE_BONUS, "cash").payout,
    pays_online: partIncentive(line, catalog, RULES.BRAND_RATE_BONUS, "online").payout,
    gst_affects: brand === "oasis",   // only the Oasis margin takes the GST cut
    rate_affects: branded,            // only branded parts move with the daily rate
    hsn: p.hsn_code || "",
    gst_rate: p.gst_rate ?? "",
  };
});

process.stdout.write(JSON.stringify({
  generated_at: new Date().toISOString(),
  rules: RULES,
  count: rows.length,
  rows,
}, null, 0));
