/* Part-by-part incentive sheet: every active part in the catalogue, the rule
   that applies to it, and what it pays a technician today.

   Payouts are computed by calling partIncentive() from services/incentives.js —
   the same function the technician app and the dashboard use — so this sheet
   cannot drift from what actually gets paid.

   Usage, from backend/:
     node --env-file=.env scripts/generate-parts-incentive.mjs [outfile]
*/
import { writeFileSync } from "node:fs";
import { RULES, partIncentive } from "../src/services/incentives.js";
import { supabase } from "../src/config/supabase.js";

const OUT = process.argv[2] || "d:/all projects/oasis globe/docs/11-PARTS-INCENTIVE.html";

const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const { data, error } = await supabase
  .from("stock_items")
  .select("id, name, brand, unit_price, base_cost, is_active")
  .order("brand")
  .order("name");
if (error) throw new Error(error.message);

const parts = (data || []).filter((p) => p.is_active !== false);

// The catalog shape partIncentive() expects, keyed by id.
const catalog = new Map(parts.map((p) => [p.id, { name: p.name, brand: p.brand || null, base_cost: Number(p.base_cost || 0) }]));

const money = (n) => "\u20B9" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const BRAND_ORDER = ["kent", "aquaguard", "oasis"];
const label = { kent: "Kent", aquaguard: "Aquaguard", oasis: "Oasis", other: "No brand set" };

const rows = parts.map((p) => {
  const price = Number(p.unit_price || 0);
  const cost = Number(p.base_cost || 0);
  const brand = p.brand || "other";
  const line = { id: p.id, price, qty: 1 };
  return {
    name: p.name, brand, price, cost,
    at6: partIncentive(line, catalog, RULES.BRAND_RATE, "cash").payout,
    at10: partIncentive(line, catalog, RULES.BRAND_RATE_BONUS, "cash").payout,
    online: partIncentive(line, catalog, RULES.BRAND_RATE_BONUS, "online").payout,
  };
});

const groups = BRAND_ORDER.concat(["other"])
  .map((b) => ({ brand: b, items: rows.filter((r) => r.brand === b) }))
  .filter((g) => g.items.length);

const noCost = rows.filter((r) => r.brand === "oasis" && !r.cost).length;
const oasisCount = rows.filter((r) => r.brand === "oasis").length;

function table(g) {
  const branded = g.brand === "kent" || g.brand === "aquaguard";
  const head = branded
    ? `<tr><th>Part</th><th class="r">Price</th><th class="r">Pays at ${RULES.BRAND_RATE * 100}%</th><th class="r">Pays at ${RULES.BRAND_RATE_BONUS * 100}%</th></tr>`
    : g.brand === "oasis"
      ? `<tr><th>Part</th><th class="r">MRP</th><th class="r">Given to tech at</th><th class="r">He earns</th></tr>`
      : `<tr><th>Part</th><th class="r">Price</th><th class="r">Pays</th></tr>`;

  const body = g.items.map((r) => {
    if (branded) {
      return `<tr><td>${esc(r.name)}</td><td class="r n">${money(r.price)}</td>
        <td class="r n">${money(r.at6)}</td><td class="r n">${money(r.at10)}</td></tr>`;
    }
    if (g.brand === "oasis") {
      return `<tr><td>${esc(r.name)}</td><td class="r n">${money(r.price)}</td>
        <td class="r n ${r.cost ? "" : "warn"}">${r.cost ? money(r.cost) : "not set"}</td>
        <td class="r n ${r.cost ? "" : "warn"}">${money(r.at10)}</td></tr>`;
    }
    return `<tr><td>${esc(r.name)}</td><td class="r n">${money(r.price)}</td><td class="r n zero">${money(0)}</td></tr>`;
  }).join("");

  const note = branded
    ? `A flat percentage of the price. The ${RULES.BRAND_RATE_BONUS * 100}% column applies for the whole day once that technician bills ${money(RULES.DAILY_TARGET)}.`
    : g.brand === "oasis"
      ? `He may bill anything from the price we give him the part at, up to MRP, and keeps the difference less ${RULES.GST_RATE * 100}% GST — cash or online, it makes no difference. <b>With no price on file the whole sale becomes his margin</b>, and there is no floor either, which is what every row below is currently doing.`
      : `No brand recorded, so nothing is paid on these.`;

  return `<h2>${label[g.brand]} &mdash; ${g.items.length} parts</h2>
    <p class="note">${note}</p>
    <div class="tbl"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Oasis Globe &mdash; What each part pays</title>
<style>
:root{--ink:#141B17;--muted:#6B7A70;--hair:#DEE4DF;--paper:#F7F8F6;--card:#fff;--sunk:#EFF2EE;
--accent:#8A6212;--accent-soft:#F6EEDC;--bad:#A32B1C;--bad-soft:#FBE9E6;
--shadow:0 1px 2px rgba(20,27,23,.05),0 10px 28px -20px rgba(20,27,23,.3)}
@media(prefers-color-scheme:dark){:root{--ink:#E9EEE9;--muted:#8A9A8E;--hair:#26332A;--paper:#0C110E;--card:#131A15;
--sunk:#111713;--accent:#D9A441;--accent-soft:#2A2213;--bad:#F08A78;--bad-soft:#2C1714;
--shadow:0 1px 2px rgba(0,0,0,.45),0 10px 28px -20px rgba(0,0,0,.8)}}
:root[data-theme=dark]{--ink:#E9EEE9;--muted:#8A9A8E;--hair:#26332A;--paper:#0C110E;--card:#131A15;--sunk:#111713;
--accent:#D9A441;--accent-soft:#2A2213;--bad:#F08A78;--bad-soft:#2C1714}
:root[data-theme=light]{--ink:#141B17;--muted:#6B7A70;--hair:#DEE4DF;--paper:#F7F8F6;--card:#fff;--sunk:#EFF2EE;
--accent:#8A6212;--accent-soft:#F6EEDC;--bad:#A32B1C;--bad-soft:#FBE9E6}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);
font:400 16px/1.6 Georgia,"Iowan Old Style","Times New Roman",serif}
h1,h2,th,.ui{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.n{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:900px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--hair);background:var(--card)}
.mast{padding:40px 0 30px}
.eyebrow{font:600 11px/1 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 12px}
h1{font-size:clamp(26px,4vw,38px);line-height:1.1;letter-spacing:-.025em;margin:0;font-weight:700}
.asof{margin:12px 0 0;color:var(--muted);font:500 13px/1.6 ui-monospace,Consolas,monospace}
main{padding:34px 0 80px}
h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;
margin:44px 0 6px;padding-bottom:9px;border-bottom:1px solid var(--hair)}
.note{margin:0 0 14px;color:var(--muted);font-size:14px;max-width:76ch}
.tbl{overflow-x:auto;border:1px solid var(--hair);border-radius:10px;background:var(--card);box-shadow:var(--shadow)}
table{border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;font-size:14px}
th{text-align:left;font:600 10px/1.3 system-ui,sans-serif;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);
padding:11px 14px;border-bottom:1px solid var(--hair);white-space:nowrap}
th.r,td.r{text-align:right}td{padding:9px 14px;border-bottom:1px solid var(--hair)}
tbody tr:last-child td{border-bottom:0}
td.n{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;font-variant-numeric:tabular-nums}
td.warn{color:var(--bad);font-weight:600}td.zero{color:var(--muted)}
.alarm{border-left:4px solid var(--bad);background:var(--bad-soft);padding:17px 20px;border-radius:0 10px 10px 0;margin:0 0 8px}
.alarm h3{margin:0 0 8px;font:700 15px/1.35 system-ui,sans-serif;color:var(--bad)}
.alarm p{margin:0 0 8px;font-size:14.5px;max-width:76ch}.alarm p:last-child{margin:0}
.alarm code{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:var(--card);padding:1px 5px;border-radius:3px}
footer{border-top:1px solid var(--hair);padding:24px 0 50px;color:var(--muted);font-size:13px}
</style></head><body>
<header><div class="wrap mast">
<p class="eyebrow">Oasis Globe &middot; Parts catalogue</p>
<h1>What each part pays a technician</h1>
<p class="asof">${esc(stamp)} IST &nbsp;&middot;&nbsp; ${parts.length} active parts &nbsp;&middot;&nbsp; live from the portal</p>
</div></header>
<main class="wrap">

<div class="alarm">
  <h3>${noCost} of the ${oasisCount} Oasis parts have no cost on file</h3>
  <p>The Oasis rule pays <code>price &minus; cost</code>. With the cost left at zero the margin
  becomes the whole selling price, so those parts are paying out their full price today.</p>
  <p>Fill in the cost for each Oasis part and the payouts in the table below drop to the real
  margin automatically. Kent and Aquaguard are unaffected &mdash; they pay a percentage of the
  price and never look at cost.</p>
</div>

${groups.map(table).join("\n")}

<h2>The rules in one line each</h2>
<div class="tbl"><table>
<thead><tr><th>Brand</th><th>What the technician gets</th></tr></thead>
<tbody>
<tr><td>Kent</td><td>${RULES.BRAND_RATE * 100}% of the price, or ${RULES.BRAND_RATE_BONUS * 100}% once the day passes ${money(RULES.DAILY_TARGET)}</td></tr>
<tr><td>Aquaguard</td><td>Same as Kent</td></tr>
<tr><td>Oasis</td><td>What he billed minus the price we gave him the part at, less ${RULES.GST_RATE * 100}% GST. Same for cash and online.</td></tr>
<tr><td>No brand set</td><td>Nothing</td></tr>
<tr><td>Service charge</td><td>Nothing &mdash; but it counts toward the ${money(RULES.DAILY_TARGET)} daily target</td></tr>
</tbody></table></div>

</main>
<footer><div class="wrap">Payouts computed with <code>partIncentive()</code> from <code>services/incentives.js</code>,
the same function that pays the technicians. Prices and costs read live from the portal.
Quantities of 1 assumed; two of a part pays twice.</div></footer>
</body></html>`;

writeFileSync(OUT, html, "utf8");
console.log(`written ${OUT}`);
for (const g of groups) console.log(`  ${label[g.brand].padEnd(14)} ${String(g.items.length).padStart(3)} parts`);
console.log(`  Oasis parts with no cost on file: ${noCost}/${oasisCount}`);
