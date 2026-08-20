/* The commission rules as a shareable web page — the same document as
   commission-explainer.mjs, which writes the PDF, read from the same live data.

   Two formats exist because they are handed over differently: the PDF goes on
   WhatsApp, the page goes as a link and prints to PDF from any browser. Keep the
   figures in step by regenerating both from here when the rules change.

   Usage, from backend/:
     node --env-file=.env scripts/commission-explainer-html.mjs [outfile]
*/
import { writeFileSync } from "node:fs";
import { RULES, partIncentive, paymentMode } from "../src/services/incentives.js";
import { supabase } from "../src/config/supabase.js";

const OUT = process.argv[2] || "d:/all projects/oasis globe/docs/Oasis-Commission-Explained.html";

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pc = (r) => Math.round(r * 100) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/* ---------------------------------------------------------------- data ---- */
const { data: stock } = await supabase.from("stock_items").select("id, name, brand, base_cost, is_active");
const catalog = new Map((stock || []).map((i) => [i.id, {
  name: i.name, brand: i.brand || null, base_cost: Number(i.base_cost || 0),
}]));
/* Only parts that can still be sold. A deactivated part with no floor price
   costs nobody anything, and counting them made the gap look half again as
   large as it is — 32 rather than the 19 that actually need filling in. */
const active = (stock || []).filter((i) => i.is_active !== false);
const oasisParts = active.filter((i) => String(i.brand).toLowerCase() === "oasis");
const oasisNoCost = oasisParts.filter((i) => !Number(i.base_cost));
const brandless = active.filter((i) => !i.brand);

const { data: closed } = await supabase
  .from("tickets")
  .select("ticket_number, tech_work, updated_at, technician:users!tickets_assigned_technician_id_fkey(full_name)")
  .eq("status", "CLOSED").order("updated_at", { ascending: false }).limit(80);
const bills = (closed || []).filter((t) => (t.tech_work?.parts || []).length > 0).slice(0, 3);

const stamp = new Date().toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short",
});

/* --------------------------------------------------------------- render --- */
const zeroCostLines = [];

function billBlock(t) {
  const w = t.tech_work || {};
  const parts = w.parts || [];
  const payments = w.payments || [];
  let total = 0;

  const rows = parts.map((p) => {
    const meta = catalog.get(p.id) || {};
    const r = partIncentive(p, catalog, RULES.BRAND_RATE);
    const qty = Math.max(1, Number(p.qty) || 1);
    total += r.payout;

    let working, flag = "";
    if (r.brand === "kent" || r.brand === "aquaguard") {
      working = `${money(r.price)} × ${pc(RULES.BRAND_RATE)} = ${money(r.gross)}, less ${pc(RULES.GST_RATE)} GST`;
    } else if (r.brand === "oasis") {
      working = `${money(p.price)} sold − ${money(meta.base_cost)} floor = ${money(r.margin)} margin`
        + (qty > 1 ? ` × ${qty}` : "") + `, less ${pc(RULES.GST_RATE)} GST`;
      if (!Number(meta.base_cost)) {
        flag = ' <span class="flag">no floor price</span>';
        zeroCostLines.push(`${t.ticket_number}: ${esc(p.name)} — sold ${money(p.price)}, paid ${money(r.payout)}`);
      }
    } else {
      working = "Unbranded — no commission";
    }

    return `<tr>
      <td>${esc(p.name)}${flag}</td>
      <td class="brand">${esc(r.brand || "—")}</td>
      <td class="num">${money(p.price)} × ${qty}</td>
      <td class="how">${working}</td>
      <td class="num pay">${money(r.payout)}</td>
    </tr>`;
  }).join("");

  const paid = payments.map((p) => `${esc(p.method)} ${money(p.amount)}`).join(", ") || "not recorded";

  return `<article class="bill">
    <h3>${esc(t.ticket_number)} <span class="tech">${esc(t.technician?.full_name || "technician")}</span></h3>
    <p class="meta">Bill ${money(w.total)} · service charge ${money(w.service_charge)} · paid ${esc(paymentMode(payments))} (${paid})</p>
    <div class="scroller"><table>
      <thead><tr><th>Part</th><th>Brand</th><th class="num">Rate × qty</th><th>How it is worked out</th><th class="num">Commission</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4">Technician earns from this bill</td><td class="num pay">${money(total)}</td></tr></tfoot>
    </table></div>
  </article>`;
}

const billsHtml = bills.map(billBlock).join("");

const html = `<title>Oasis Globe Commission Rules</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    --paper:#f7f8fa; --card:#fff; --ink:#10161f; --ink-2:#46505f; --ink-3:#78828f;
    --line:#e3e7ed; --green:#0f6b4f; --blue:#1d4ed8; --amber:#8a5a00; --amber-bg:#fdf6e7;
    --shadow:0 1px 2px rgba(16,22,31,.06), 0 8px 24px -16px rgba(16,22,31,.25);
    --display:Charter,"Bitstream Charter","Iowan Old Style",Georgia,serif;
    --body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:ui-monospace,SFMono-Regular,"Cascadia Mono",Menlo,monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:#0e1218; --card:#161c25; --ink:#eef2f7; --ink-2:#b3bdca; --ink-3:#8792a1;
      --line:#263041; --green:#6fd3ae; --blue:#93b4ff; --amber:#e8b866; --amber-bg:#241d10;
      --shadow:0 1px 2px rgba(0,0,0,.5), 0 10px 30px -18px rgba(0,0,0,.9);
    }
  }
  :root[data-theme="dark"] {
    --paper:#0e1218; --card:#161c25; --ink:#eef2f7; --ink-2:#b3bdca; --ink-3:#8792a1;
    --line:#263041; --green:#6fd3ae; --blue:#93b4ff; --amber:#e8b866; --amber-bg:#241d10;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 10px 30px -18px rgba(0,0,0,.9);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.6}
  .wrap{max-width:900px;margin:0 auto;padding:40px 20px 80px}
  .eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--green);margin:0 0 10px}
  h1{font-family:var(--display);font-size:clamp(28px,5vw,42px);line-height:1.1;margin:0 0 10px;text-wrap:balance}
  .lede{font-size:17px;color:var(--ink-2);max-width:62ch;margin:0}
  header.top{border-bottom:1px solid var(--line);padding-bottom:24px}
  h2{font-family:var(--display);font-size:clamp(21px,3vw,26px);line-height:1.2;margin:0 0 10px;text-wrap:balance}
  h3{font-size:16px;margin:0 0 4px}
  h3 .tech{font-weight:400;color:var(--ink-3)}
  p{margin:0 0 12px;max-width:66ch;color:var(--ink-2)}
  strong{color:var(--ink);font-weight:650}
  section{margin-top:44px}
  .section-head{display:flex;align-items:baseline;gap:12px;margin-bottom:14px}
  .num-chip{font-family:var(--mono);font-size:13px;font-weight:700;color:var(--green);
    border:1px solid var(--line);border-radius:999px;padding:3px 10px;background:var(--card);flex:none}
  ul{margin:0 0 12px;padding-left:20px;color:var(--ink-2);max-width:66ch}
  li{margin-bottom:6px}
  .bill{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:var(--shadow)}
  .bill .meta{font-size:13.5px;color:var(--ink-3);margin:0 0 10px}
  .scroller{overflow-x:auto}
  table{border-collapse:collapse;width:100%;font-size:14px;min-width:560px}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);font-weight:700}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:13px;white-space:nowrap}
  td.pay{font-weight:700;color:var(--ink)}
  td.brand{color:var(--ink-3)}
  td.how{color:var(--ink-2);font-size:13px}
  tfoot td{border-bottom:none;font-weight:700;color:var(--ink);text-align:right}
  .flag{display:inline-block;font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    color:var(--amber);background:var(--amber-bg);border-radius:999px;padding:1px 7px;margin-left:6px;white-space:nowrap}
  .note{border-left:3px solid var(--amber);background:var(--card);padding:12px 16px;border-radius:0 10px 10px 0;
    box-shadow:var(--shadow);margin:14px 0 0;max-width:66ch}
  .note p:last-child{margin-bottom:0}
  .note .tag{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--amber);display:block;margin-bottom:4px}
  .cols{columns:2;column-gap:28px;font-size:14px;color:var(--ink-2);max-width:66ch}
  @media (max-width:620px){.cols{columns:1}}
  footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);color:var(--ink-3);font-size:13.5px}
  :focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:4px}
  @media print{
    :root{--paper:#fff;--card:#fff;--ink:#10161f;--ink-2:#333d4b;--ink-3:#5c6675;--line:#d5dbe3;--shadow:none;--amber-bg:#f7f1e2}
    body{background:#fff;font-size:11pt}.wrap{max-width:none;padding:0}
    section,.bill,.note,table{break-inside:avoid;page-break-inside:avoid}
    h1,h2,h3{break-after:avoid}table{min-width:0}
  }
</style>

<div class="wrap">
  <header class="top">
    <p class="eyebrow">Oasis Globe · Technician pay</p>
    <h1>How technician commission is calculated</h1>
    <p class="lede">Every figure on this page was read from the live system on ${esc(stamp)}. The worked
    examples are real closed jobs, not illustrations.</p>
  </header>

  <section>
    <div class="section-head"><span class="num-chip">1</span><h2>Two rules, and the brand decides which</h2></div>
    <p>Every part on a bill earns the technician something, and how much depends entirely on whose part it
    is. The catalogue records a brand against each part, and that brand picks the rule. Nothing else about
    the job changes it.</p>
    <ul>
      <li><strong>Kent and Aquaguard parts</strong> earn a percentage of what the customer paid for them:
      ${pc(RULES.BRAND_RATE)} normally, ${pc(RULES.BRAND_RATE_BONUS)} on a day the target is met. Neither
      the floor price nor what we paid for the part comes into it.</li>
      <li><strong>Oasis parts</strong> earn the margin — what the customer paid, minus the price we give
      the part to the technician at (“Minimum price” on the stock screen). He may sell anywhere between
      that and the MRP, and keeps whatever he makes above it.</li>
      <li><strong>A part with no brand written against it</strong> earns nothing, because with no brand
      there is no rule to apply. Section 5 covers the ${brandless.length} parts in that state.</li>
    </ul>
    <p>The reasoning behind the split: on another company's product we are a service channel earning a
    slice of the sale, while on our own product the technician is given a floor price and keeps what he
    sells above it.</p>
  </section>

  <section>
    <div class="section-head"><span class="num-chip">2</span><h2>GST comes off every payout</h2></div>
    <p>Part prices are MRP, and MRP already contains ${pc(RULES.GST_RATE)} GST. That tax is owed to the
    government on the sale whichever way the customer pays, so it was never ours to share. Commission is
    worked out first and then reduced by ${pc(RULES.GST_RATE)} — on both rules, cash or online alike.</p>
    <p>This settled in two steps. Until 6 August 2026 the Oasis margin was paid gross, so an identical job
    paid about 22% more if the customer happened to tap UPI. On 12 August 2026 the same correction reached
    Kent and Aquaguard, where the percentage had been taken off the full MRP and so was quietly paying
    commission on the tax as well.</p>
  </section>

  <section>
    <div class="section-head"><span class="num-chip">3</span><h2>The daily target lifts the branded rate</h2></div>
    <p>Add up everything a technician billed in one day. If it reaches ${money(RULES.DAILY_TARGET)}, every
    Kent and Aquaguard part he sold that day earns ${pc(RULES.BRAND_RATE_BONUS)} instead of
    ${pc(RULES.BRAND_RATE)} — including the jobs he finished in the morning, before the target was anywhere
    in sight. The rate applies backwards across the whole day, exactly as promised.</p>
    <p>The Oasis margin rule is not affected by the target. The service charge counts towards reaching the
    target but earns no commission itself, and neither does a job that is still open — commission is
    computed from closed tickets only.</p>
  </section>

  <section>
    <div class="section-head"><span class="num-chip">4</span><h2>Three real bills, worked through</h2></div>
    <p>These are actual closed jobs. Each line shows the arithmetic that produced the figure.</p>
    ${billsHtml}
  </section>

  <section>
    <div class="section-head"><span class="num-chip">5</span><h2>Two gaps in the catalogue</h2></div>
    <p>The Oasis rule pays on the margin, so it needs the floor — the price we give the part to the
    technician at. Of ${oasisParts.length} Oasis parts, <strong>${oasisNoCost.length} have it blank</strong>.
    A blank floor reads as zero, so the whole selling price is treated as margin and he is paid on all of it.</p>
    ${zeroCostLines.length ? `<div class="note"><span class="tag">Seen in the examples above</span><p>${zeroCostLines.map(esc).join("<br />")}</p></div>` : ""}
    <p style="margin-top:16px">The brand is a field somebody fills in, not something the system can work
    out from the name. <strong>${brandless.length} parts have it blank</strong> and therefore pay nothing at
    all, whatever they sell for — and three of them are plainly Kent parts:</p>
    <div class="cols">${brandless.map((p) => esc(p.name)).join("<br />")}</div>
    <div class="note">
      <span class="tag">What fixing them costs</span>
      <p>Nothing in the code. Filling in a cost, or setting a brand, changes the payout the next time the
      figures are read — payouts are always computed from closed tickets and never stored.</p>
    </div>
  </section>

  <section>
    <div class="section-head"><span class="num-chip">6</span><h2>When the rules changed</h2></div>
    <div class="scroller"><table>
      <thead><tr><th>Date</th><th>Change</th></tr></thead>
      <tbody>
        <tr><td class="num">6 Aug 2026</td><td>GST taken off the Oasis margin, cash and online alike.</td></tr>
        <tr><td class="num">7 Aug 2026</td><td>Branded rate raised from 6% to ${pc(RULES.BRAND_RATE)}, and to ${pc(RULES.BRAND_RATE_BONUS)} on a day the ${money(RULES.DAILY_TARGET)} target is met.</td></tr>
        <tr><td class="num">12 Aug 2026</td><td>GST taken off the Kent and Aquaguard percentage too. Jobs already closed were not recalculated; this applies from that date on.</td></tr>
      </tbody>
    </table></div>
  </section>

  <footer>
    <p>The rules live in one place in the code (services/incentives.js). Payouts are always computed from
    closed tickets and never stored, so a corrected price or cost is reflected the next time the figures
    are read.</p>
  </footer>
</div>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(`  bills : ${bills.map((b) => b.ticket_number).join(", ")}`);
console.log(`  gaps  : ${oasisNoCost.length} oasis parts with no cost, ${brandless.length} parts with no brand`);
