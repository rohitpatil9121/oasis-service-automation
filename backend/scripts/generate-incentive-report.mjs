/* Renders the current incentive position to a self-contained HTML file.
   Reads live from the database through services/incentives.js, so the figures
   are whatever they are at the moment you run it.

   Usage, from backend/:
     node --env-file=.env scripts/generate-incentive-report.mjs [outfile]
*/
import { writeFileSync } from "node:fs";
import { RULES, incentiveReport } from "../src/services/incentives.js";
import { supabase } from "../src/config/supabase.js";

const OUT = process.argv[2] || "d:/all projects/oasis globe/docs/10-INCENTIVE-LIVE.html";

const ist = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
const monthStart = ist.slice(0, 8) + "01";

const rep = await incentiveReport({ from: monthStart, to: ist });
const { data: stock } = await supabase.from("stock_items").select("id, brand, base_cost");
const parts = stock || [];
const zeroCost = parts.filter((s) => !Number(s.base_cost)).length;

const money = (n) => "\u20B9" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const totBill = rep.technicians.reduce((s, t) => s + t.total_billing, 0);

// Today, per technician, with progress toward the daily target.
const today = rep.technicians
  .map((t) => {
    const d = t.days.find((x) => x.date === ist);
    return {
      name: t.technician_name, billing: d?.billing || 0, payout: d?.payout || 0,
      hit: !!d?.target_hit, rate: d?.brand_rate || RULES.BRAND_RATE, jobs: d?.jobs?.length || 0,
    };
  })
  .sort((a, b) => b.billing - a.billing);

// The largest payout of the period, shown line by line so the arithmetic is visible.
let worked = null;
for (const t of rep.technicians)
  for (const d of t.days)
    for (const j of d.jobs)
      if (j.parts.length && (!worked || j.payout > worked.j.payout)) worked = { t, d, j };

const monthRows = rep.technicians.map((t) => `
  <tr><td>${esc(t.technician_name)}</td>
      <td class="r n">${money(t.total_billing)}</td>
      <td class="r n">${money(t.total_payout)}</td>
      <td class="r n ${pct(t.total_payout, t.total_billing) > 50 ? "hot" : ""}">${pct(t.total_payout, t.total_billing)}%</td>
      <td class="r n">${t.days.length}</td></tr>`).join("");

const todayRows = today.map((t) => {
  const rem = Math.max(0, RULES.DAILY_TARGET - t.billing);
  const w = Math.min(100, (t.billing / RULES.DAILY_TARGET) * 100);
  return `<tr><td>${esc(t.name)}</td>
    <td><div class="mini"><div class="mini-f${t.hit ? " ok" : ""}" style="width:${w}%"></div></div></td>
    <td class="r n">${money(t.billing)}</td>
    <td class="r n">${t.hit ? '<span class="pill ok">hit</span>' : money(rem) + " to go"}</td>
    <td class="r n">${t.rate * 100}%</td>
    <td class="r n">${money(t.payout)}</td>
    <td class="r n">${t.jobs}</td></tr>`;
}).join("");

const workedRows = worked ? worked.j.parts.map((p) => {
  const branded = p.brand === "kent" || p.brand === "aquaguard";
  const working = branded
    ? `${p.price} \u00D7 ${worked.d.brand_rate * 100}%`
    : p.margin != null
      ? `margin ${money(p.margin)}${worked.j.payment_mode === "online" ? " \u00D7 0.82" : ""}`
      : "not a paying brand";
  return `<tr><td><span class="pill ${esc(p.brand)}">${esc(p.brand)}</span></td>
    <td class="r n">${money(p.price)}</td><td class="r n">${p.qty}</td>
    <td class="n">${working}</td><td class="r n">${money(p.payout)}</td></tr>`;
}).join("") : "";

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Oasis Globe &mdash; Incentive right now</title>
<style>
:root{--ink:#141B17;--ink2:#39463D;--muted:#6B7A70;--hair:#DEE4DF;--paper:#F7F8F6;--card:#fff;--sunk:#EFF2EE;
--accent:#8A6212;--accent-soft:#F6EEDC;--ok:#1F7A4C;--ok-soft:#E4F1E9;--bad:#A32B1C;--bad-soft:#FBE9E6;
--shadow:0 1px 2px rgba(20,27,23,.05),0 10px 28px -20px rgba(20,27,23,.3)}
@media(prefers-color-scheme:dark){:root{--ink:#E9EEE9;--ink2:#BAC7BD;--muted:#8A9A8E;--hair:#26332A;--paper:#0C110E;
--card:#131A15;--sunk:#111713;--accent:#D9A441;--accent-soft:#2A2213;--ok:#5FCB94;--ok-soft:#11291F;
--bad:#F08A78;--bad-soft:#2C1714;--shadow:0 1px 2px rgba(0,0,0,.45),0 10px 28px -20px rgba(0,0,0,.8)}}
:root[data-theme=dark]{--ink:#E9EEE9;--ink2:#BAC7BD;--muted:#8A9A8E;--hair:#26332A;--paper:#0C110E;--card:#131A15;
--sunk:#111713;--accent:#D9A441;--accent-soft:#2A2213;--ok:#5FCB94;--ok-soft:#11291F;--bad:#F08A78;--bad-soft:#2C1714}
:root[data-theme=light]{--ink:#141B17;--ink2:#39463D;--muted:#6B7A70;--hair:#DEE4DF;--paper:#F7F8F6;--card:#fff;
--sunk:#EFF2EE;--accent:#8A6212;--accent-soft:#F6EEDC;--ok:#1F7A4C;--ok-soft:#E4F1E9;--bad:#A32B1C;--bad-soft:#FBE9E6}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);
font:400 16px/1.6 Georgia,"Iowan Old Style","Times New Roman",serif}
h1,h2,h3,th,.ui{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.n{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-variant-numeric:tabular-nums}
.wrap{max-width:1040px;margin:0 auto;padding:0 24px}
header{border-bottom:1px solid var(--hair);background:var(--card)}
.mast{padding:42px 0 32px}
.eyebrow{font:600 11px/1 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 12px}
h1{font-size:clamp(27px,4vw,40px);line-height:1.1;letter-spacing:-.025em;margin:0;font-weight:700}
.asof{margin:12px 0 0;color:var(--muted);font:500 13px/1.6 ui-monospace,Consolas,monospace}
main{padding:38px 0 80px}
h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600;
margin:46px 0 16px;padding-bottom:9px;border-bottom:1px solid var(--hair)}
p{max-width:70ch}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.kpi{background:var(--card);border:1px solid var(--hair);border-radius:10px;padding:16px 18px;box-shadow:var(--shadow)}
.kpi .k{font:600 10px/1.3 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.kpi .v{font:700 27px/1 ui-monospace,Consolas,monospace;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi .d{margin:8px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5;max-width:none}
.kpi.warn .v{color:var(--bad)}
.tbl{overflow-x:auto;border:1px solid var(--hair);border-radius:10px;background:var(--card);box-shadow:var(--shadow);margin:14px 0}
table{border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;font-size:14px}
th{text-align:left;font:600 10px/1.3 system-ui,sans-serif;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);
padding:12px 14px;border-bottom:1px solid var(--hair);white-space:nowrap}
th.r,td.r{text-align:right}td{padding:11px 14px;border-bottom:1px solid var(--hair)}
tbody tr:last-child td{border-bottom:0}
tfoot td{border-top:2px solid var(--hair);font-weight:650}
td.n,th.n{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;font-variant-numeric:tabular-nums}
td.hot{color:var(--bad);font-weight:700}
.mini{width:110px;height:8px;background:var(--sunk);border-radius:5px;overflow:hidden;border:1px solid var(--hair)}
.mini-f{height:100%;background:var(--accent);opacity:.5}.mini-f.ok{background:var(--ok);opacity:.8}
.pill{display:inline-block;font:600 10px/1 system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;padding:4px 8px;border-radius:20px}
.pill.ok,.pill.oasis{background:var(--ok-soft);color:var(--ok)}
.pill.kent,.pill.aquaguard{background:var(--accent-soft);color:var(--accent)}
.pill.other,.pill.null{background:var(--sunk);color:var(--muted)}
.alarm{border-left:4px solid var(--bad);background:var(--bad-soft);padding:18px 20px;border-radius:0 10px 10px 0;margin:0 0 32px}
.alarm h3{margin:0 0 8px;font:700 15.5px/1.35 system-ui,sans-serif;color:var(--bad)}
.alarm p{margin:0 0 9px;font-size:14.5px}.alarm p:last-child{margin:0}
.alarm code{font-family:ui-monospace,Consolas,monospace;font-size:13px;background:var(--card);padding:1px 5px;border-radius:3px}
.f{background:var(--sunk);border:1px solid var(--hair);border-left:3px solid var(--accent);border-radius:0 8px 8px 0;
padding:13px 17px;margin:13px 0;overflow-x:auto}
.f code{font-family:ui-monospace,Consolas,monospace;font-size:13.5px;line-height:1.85;white-space:pre;display:block}
footer{border-top:1px solid var(--hair);padding:24px 0 50px;color:var(--muted);font-size:13px}
footer code{font-size:12.5px}
</style></head><body>
<header><div class="wrap mast">
<p class="eyebrow">Oasis Globe &middot; Live figures</p>
<h1>Incentive, as it stands right now</h1>
<p class="asof">Generated ${esc(stamp)} IST &nbsp;&middot;&nbsp; period ${monthStart} to ${ist} &nbsp;&middot;&nbsp; ${rep.technicians.length} technicians</p>
</div></header>
<main class="wrap">

<div class="alarm">
  <h3>Every part in the catalogue has a cost of zero, so payouts are far higher than the rule intends</h3>
  <p>All <b>${parts.length} parts</b> carry <code>base_cost = 0</code>. The Oasis rule pays
  <code>price &minus; base_cost</code>, so with no cost recorded it hands over
  <b>the entire selling price</b> of every Oasis part instead of the margin on it.</p>
  <p>This period that is <b>${money(rep.total_payout)}</b> of incentive against <b>${money(totBill)}</b> billed —
  <b>${pct(rep.total_payout, totBill)}%</b> of everything the team invoiced. Individual jobs run above 80%.</p>
  <p>Kent and Aquaguard parts are unaffected — they pay a percentage of the price and never look at cost.
  Filling in <code>base_cost</code> for the Oasis parts corrects this with no code change.</p>
</div>

<h2>This period at a glance</h2>
<div class="kpis">
  <div class="kpi"><p class="k">Billed</p><div class="v">${money(totBill)}</div>
    <p class="d">Every closed job from ${monthStart}.</p></div>
  <div class="kpi warn"><p class="k">Incentive owed</p><div class="v">${money(rep.total_payout)}</div>
    <p class="d">${pct(rep.total_payout, totBill)}% of everything billed.</p></div>
  <div class="kpi"><p class="k">Daily target</p><div class="v">${money(RULES.DAILY_TARGET)}</div>
    <p class="d">Per technician. Unlocks ${RULES.BRAND_RATE_BONUS * 100}% on branded parts, backdated across the whole day.</p></div>
  <div class="kpi"><p class="k">Parts with no cost</p><div class="v">${zeroCost}/${parts.length}</div>
    <p class="d">Each pays out its full price rather than its margin.</p></div>
</div>

<h2>Today &mdash; ${ist}</h2>
<div class="tbl"><table>
<thead><tr><th>Technician</th><th>Toward ${money(RULES.DAILY_TARGET)}</th><th class="r">Billed</th>
<th class="r">Target</th><th class="r">Rate</th><th class="r">Earned</th><th class="r">Jobs</th></tr></thead>
<tbody>${todayRows}</tbody></table></div>

<h2>Period to date</h2>
<div class="tbl"><table>
<thead><tr><th>Technician</th><th class="r">Billed</th><th class="r">Incentive</th><th class="r">Share of billing</th><th class="r">Days worked</th></tr></thead>
<tbody>${monthRows}</tbody>
<tfoot><tr><td>Total</td><td class="r n">${money(totBill)}</td><td class="r n">${money(rep.total_payout)}</td>
<td class="r n">${pct(rep.total_payout, totBill)}%</td><td class="r n">&mdash;</td></tr></tfoot>
</table></div>

${worked ? `<h2>One real job, worked through</h2>
<p>${esc(worked.t.technician_name)} &middot; <b>${esc(worked.j.ticket_number)}</b> &middot; ${worked.d.date} &middot;
billed ${money(worked.j.bill)} &middot; paid ${worked.j.payment_mode} &middot;
day rate ${worked.d.brand_rate * 100}% ${worked.d.target_hit ? "(target was reached)" : "(target not reached)"}</p>
<div class="tbl"><table>
<thead><tr><th>Part</th><th class="r">Price</th><th class="r">Qty</th><th>Working</th><th class="r">Payout</th></tr></thead>
<tbody>${workedRows}</tbody>
<tfoot><tr><td colspan="4">Job payout &mdash; ${pct(worked.j.payout, worked.j.bill)}% of the bill</td>
<td class="r n">${money(worked.j.payout)}</td></tr></tfoot>
</table></div>` : ""}

<h2>The rules being applied</h2>
<div class="f"><code>Kent / Aquaguard   payout = price &times; qty &times; rate        rate = ${RULES.BRAND_RATE * 100}% or ${RULES.BRAND_RATE_BONUS * 100}%
Oasis              margin = (price &minus; base_cost) &times; qty
                   payout = margin                     paid in cash
                   payout = margin &times; ${1 - RULES.GST_RATE}                paid online (${RULES.GST_RATE * 100}% GST removed)
Any other brand    payout = 0
Service charge     payout = 0   (still counts toward the ${money(RULES.DAILY_TARGET)} target)

Day rate           ${RULES.BRAND_RATE_BONUS * 100}% when that technician billed ${money(RULES.DAILY_TARGET)} or more in one
                   IST day, applied backwards across every job of that day</code></div>

</main>
<footer><div class="wrap">Read live from the database at generation time through <code>services/incentives.js</code>.
Re-run <code>node --env-file=.env scripts/generate-incentive-report.mjs</code> to refresh.</div></footer>
</body></html>`;

writeFileSync(OUT, html, "utf8");
console.log(
  `written ${OUT}\n  technicians ${rep.technicians.length} | billed ${money(totBill)}` +
  ` | payout ${money(rep.total_payout)} (${pct(rep.total_payout, totBill)}%)` +
  ` | zero-cost parts ${zeroCost}/${parts.length}`
);
