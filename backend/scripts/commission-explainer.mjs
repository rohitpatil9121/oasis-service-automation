/* Renders the technician commission rules to a PDF, explained from first
   principles and worked through on REAL bills read live from the database.

   Written because the rules now have three moving parts — two different
   formulas depending on the brand, a daily target that changes one of them
   retroactively, and GST coming off both — and nobody should have to read
   services/incentives.js to know what a technician gets paid.

   pdfmake, like the customer invoice (services/invoicePdf.js): pure JS, no
   headless browser to install. Currency is printed "Rs." because the PDF
   standard-14 fonts have no glyph for the rupee sign.

   Usage, from backend/:
     node --env-file=.env scripts/commission-explainer.mjs [outfile]
*/
import { writeFileSync } from "node:fs";
import PdfPrinter from "pdfmake";
import { RULES, partIncentive, paymentMode } from "../src/services/incentives.js";
import { supabase } from "../src/config/supabase.js";

const OUT = process.argv[2] || "d:/all projects/oasis globe/docs/Oasis-Commission-Explained.pdf";

const printer = new PdfPrinter({
  Helvetica: {
    normal: "Helvetica", bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique",
  },
});

const rs = (n) => "Rs. " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const pc = (r) => Math.round(r * 100) + "%";

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
// No brand means no rule, which means no commission — see section 7.
const brandless = active.filter((i) => !i.brand);

const { data: closed } = await supabase
  .from("tickets")
  .select("ticket_number, tech_work, updated_at, technician:users!tickets_assigned_technician_id_fkey(full_name)")
  .eq("status", "CLOSED").order("updated_at", { ascending: false }).limit(80);

// Three real bills that actually have parts on them — a pure-Oasis one, a
// branded one and whatever else is recent, so both formulas appear.
const bills = (closed || []).filter((t) => (t.tech_work?.parts || []).length > 0).slice(0, 3);

const stamp = new Date().toLocaleString("en-IN", {
  timeZone: "Asia/Kolkata", dateStyle: "long", timeStyle: "short",
});

/* ------------------------------------------------------------- document --- */

const H = (text) => ({ text, style: "h2", margin: [0, 16, 0, 6] });
const P = (text) => ({ text, style: "p", margin: [0, 0, 0, 6] });

const rule = { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => "#d9d9d9" };

// Lines in the worked examples where the part has no cost recorded, collected
// as the tables are built so section 6 can name them instead of speaking in
// general terms. The first reader of this document spotted both immediately.
const zeroCostLines = [];

/** One bill, worked line by line. */
function billSection(t) {
  const w = t.tech_work || {};
  const parts = w.parts || [];
  const payments = w.payments || [];

  const rows = [[
    { text: "Part", style: "th" }, { text: "Brand", style: "th" },
    { text: "Rate x Qty", style: "th", alignment: "right" },
    { text: "How it is worked out", style: "th" },
    { text: "Commission", style: "th", alignment: "right" },
  ]];

  let total = 0;
  for (const p of parts) {
    const meta = catalog.get(p.id) || {};
    const r = partIncentive(p, catalog, RULES.BRAND_RATE);
    const qty = Math.max(1, Number(p.qty) || 1);
    total += r.payout;

    let working;
    if (r.brand === "kent" || r.brand === "aquaguard") {
      working = `${rs(r.price)} x ${pc(RULES.BRAND_RATE)} = ${rs(r.gross)}, less ${pc(RULES.GST_RATE)} GST`;
    } else if (r.brand === "oasis") {
      working = `${rs(Number(p.price || 0))} sold - ${rs(meta.base_cost)} floor = ${rs(r.margin)} margin${qty > 1 ? ` x ${qty}` : ""}, less ${pc(RULES.GST_RATE)} GST`;
      if (!Number(meta.base_cost)) {
        working += "   << no floor price set, so the WHOLE price counts as margin (section 6)";
        zeroCostLines.push(`${t.ticket_number}: ${p.name} - sold ${rs(p.price)}, paid ${rs(r.payout)} commission`);
      }
    } else {
      working = "Unbranded - no commission";
    }

    rows.push([
      { text: p.name || "-", style: "td" },
      { text: r.brand || "-", style: "td" },
      { text: `${rs(p.price)} x ${qty}`, style: "td", alignment: "right" },
      { text: working, style: "tdSmall" },
      { text: rs(r.payout), style: "td", alignment: "right", bold: true },
    ]);
  }

  rows.push([
    { text: "", border: [false, true, false, false] },
    { text: "", border: [false, true, false, false] },
    { text: "", border: [false, true, false, false] },
    { text: "Technician earns from this bill", style: "td", alignment: "right", bold: true, border: [false, true, false, false] },
    { text: rs(total), style: "td", alignment: "right", bold: true, border: [false, true, false, false] },
  ]);

  const paid = payments.map((p) => `${p.method} ${rs(p.amount)}`).join(", ") || "not recorded";

  return [
    { text: `${t.ticket_number}  -  ${t.technician?.full_name || "technician"}`, style: "h3", margin: [0, 14, 0, 2] },
    {
      text: `Bill ${rs(w.total)}   |   service charge ${rs(w.service_charge)}   |   paid ${paymentMode(payments)} (${paid})`,
      style: "meta", margin: [0, 0, 0, 6],
    },
    { table: { headerRows: 1, widths: ["*", 52, 70, 175, 62], body: rows }, layout: rule },
  ];
}

const doc = {
  pageSize: "A4",
  pageMargins: [42, 46, 42, 52],
  defaultStyle: { font: "Helvetica", fontSize: 10, color: "#1a1a1a", lineHeight: 1.25 },
  footer: (page, count) => ({
    text: `Oasis Globe - technician commission - page ${page} of ${count}`,
    alignment: "center", fontSize: 8, color: "#888", margin: [0, 14, 0, 0],
  }),
  styles: {
    h1: { fontSize: 19, bold: true },
    h2: { fontSize: 13, bold: true, color: "#0b3d63" },
    h3: { fontSize: 11, bold: true },
    p: { fontSize: 10 },
    meta: { fontSize: 9, color: "#555" },
    th: { fontSize: 8.5, bold: true, color: "#444", margin: [0, 4, 0, 4] },
    td: { fontSize: 9, margin: [0, 4, 0, 4] },
    tdSmall: { fontSize: 8.5, color: "#333", margin: [0, 4, 0, 4] },
    note: { fontSize: 9.5, color: "#7a3b00" },
  },
  content: [
    { text: "How technician commission is calculated", style: "h1" },
    { text: `Oasis Globe  -  figures read live from the system on ${stamp}`, style: "meta", margin: [0, 4, 0, 2] },

    H("1. There are two rules, and the brand decides which one applies"),
    P("Every part on a bill earns the technician something, and how much depends entirely on whose part it is. The catalogue records a brand against each part, and that brand picks the rule. Nothing else about the job changes it."),
    {
      ul: [
        { text: [{ text: "Kent and Aquaguard parts ", bold: true }, `earn a percentage of what the customer paid for them: ${pc(RULES.BRAND_RATE)} normally, ${pc(RULES.BRAND_RATE_BONUS)} on a day the target is met. Neither the floor price nor what we paid for it comes into it.`] },
        { text: [{ text: "Oasis parts ", bold: true }, "earn the margin — what the customer paid, minus the price we give the part to the technician at. Sell an Oasis filter for Rs. 450 that we give him at Rs. 350, and the Rs. 100 difference is what the commission is worked out on."] },
        { text: [{ text: "A part with no brand written against it ", bold: true }, "earns nothing — not because such parts are meant to be unpaid, but because with no brand there is no rule to apply. See section 7: seven parts are in that state today, and three of them are Kent parts."] },
      ],
      margin: [0, 0, 0, 6],
    },
    P("The reasoning behind the split: on another company's product we are a service channel earning a slice of the sale, while on our own product the technician is given a floor price and keeps what he sells above it."),

    H("2. GST comes off every payout"),
    P(`Part prices are MRP, and MRP already contains ${pc(RULES.GST_RATE)} GST. That tax is owed to the government on the sale whichever way the customer pays, so it was never ours to share. Commission is therefore worked out first and then reduced by ${pc(RULES.GST_RATE)} — on both rules, cash or online alike.`),
    P("This settled in two steps. Until 6 August 2026 the Oasis margin was paid gross, which meant an identical job paid about 22% more if the customer happened to tap UPI. On 12 August 2026 the same correction reached Kent and Aquaguard, where the percentage had been taken off the full MRP and so was quietly paying commission on the tax as well."),

    H("3. The daily target lifts the branded rate for the whole day"),
    P(`Add up everything a technician billed in one day. If it reaches ${rs(RULES.DAILY_TARGET)}, every Kent and Aquaguard part he sold that day earns ${pc(RULES.BRAND_RATE_BONUS)} instead of ${pc(RULES.BRAND_RATE)} — including the jobs he finished in the morning, before the target was anywhere in sight. The rate is applied backwards across the whole day, exactly as promised.`),
    P("The Oasis margin rule is not affected by the target. The service charge counts towards reaching the target but earns no commission itself."),

    H("4. What earns nothing"),
    {
      ul: [
        "The service charge — it counts towards the daily target, but pays no commission.",
        "Jobs that are still open. Commission is computed from closed tickets only.",
        "Parts whose brand is blank in the catalogue — covered in section 7, because that is a gap in the data rather than a decision about pay.",
      ],
      margin: [0, 0, 0, 6],
    },

    H("5. Three real bills, worked through"),
    P("These are actual closed jobs from the system, not examples. Each line shows the arithmetic that produced the figure."),
    ...bills.flatMap(billSection),

    { text: "", pageBreak: "before" },
    H("6. Missing floor prices, and what they do to the payout"),
    P(`The Oasis rule pays on the margin, so it needs the floor — the price we give the part to the technician at ("Minimum price" on the stock screen). Of ${oasisParts.length} Oasis parts, ${oasisNoCost.length} have it blank.`),
    P("A blank floor reads as zero, so the whole selling price is treated as margin and the technician is paid on all of it. The examples above contain such a line:"),
    { ul: zeroCostLines, style: "note", margin: [0, 0, 0, 8] },
    {
      text: "This may be exactly what was intended for parts we assemble ourselves. If it is not, filling in the cost against those parts changes the payout immediately — nothing else has to be altered.",
      style: "note", margin: [0, 4, 0, 8],
    },
    P("Kent and Aquaguard parts have it blank too, but that is harmless: their rule is a percentage of the selling price and never looks at the floor."),
    {
      table: {
        headerRows: 1, widths: ["*", 90],
        body: [
          [{ text: "Oasis parts with no floor price set", style: "th" }, { text: "", style: "th" }],
          ...oasisNoCost.slice(0, 34).map((p) => [{ text: p.name, style: "td" }, { text: "", style: "td" }]),
        ],
      },
      layout: rule,
    },

    H("7. Parts with no brand — currently paying nothing"),
    P(`The brand is what selects the rule, and it is a field someone fills in, not something the system can work out from the name. ${brandless.length} parts in the catalogue have it blank. Those parts pay the technician nothing at all, whatever they sell for.`),
    P("Three of them are plainly Kent parts. Sold today they would earn nothing, when by the rule they should earn the Kent percentage. Only one has reached a bill so far — a Kent ballast billed at zero on OG-270726-0005 — so no commission has actually been lost yet. Setting the brand on these fixes them; no code change is involved."),
    {
      table: {
        headerRows: 1, widths: ["*", 130],
        body: [
          [{ text: "Part with no brand", style: "th" }, { text: "Should probably be", style: "th" }],
          ...brandless.map((p) => [
            { text: p.name, style: "td" },
            { text: /kent/i.test(p.name) ? "Kent - earns 8% today it is set" : "decide: Oasis, or genuinely unbranded", style: "td" },
          ]),
        ],
      },
      layout: rule,
    },

    H("8. When the rules changed"),
    {
      table: {
        headerRows: 1, widths: [80, "*"],
        body: [
          [{ text: "Date", style: "th" }, { text: "Change", style: "th" }],
          [{ text: "6 Aug 2026", style: "td" }, { text: "GST taken off the Oasis margin, cash and online alike. Before this the same job paid noticeably more when the customer paid by UPI.", style: "td" }],
          [{ text: "7 Aug 2026", style: "td" }, { text: `Branded rate raised from 6% to ${pc(RULES.BRAND_RATE)}, and to ${pc(RULES.BRAND_RATE_BONUS)} on a day the ${rs(RULES.DAILY_TARGET)} target is met.`, style: "td" }],
          [{ text: "12 Aug 2026", style: "td" }, { text: "GST taken off the Kent and Aquaguard percentage too, which had been calculated on the full MRP. Jobs already closed were not recalculated; this applies from that date on.", style: "td" }],
        ],
      },
      layout: rule,
    },
    P(""),
    { text: "The rules live in one place in the code (services/incentives.js). Payouts are always computed from closed tickets and never stored, so a corrected price or cost is reflected the next time the figures are read.", style: "meta", margin: [0, 8, 0, 0] },
  ],
};

const pdf = printer.createPdfKitDocument(doc);
const chunks = [];
pdf.on("data", (c) => chunks.push(c));
pdf.on("end", () => {
  writeFileSync(OUT, Buffer.concat(chunks));
  console.log(`wrote ${OUT}`);
  console.log(`  bills explained : ${bills.map((b) => b.ticket_number).join(", ")}`);
  console.log(`  oasis parts     : ${oasisParts.length}, of which ${oasisNoCost.length} have no floor price`);
});
pdf.end();
