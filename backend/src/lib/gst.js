// GST arithmetic for the customer tax invoice. Pure functions, no I/O — the
// numbers on a bill are the one thing that must be trivially checkable.
//
// Two conventions exist and they give different answers, so it is set once on
// company_profile.prices_include_gst rather than guessed per call site:
//   inclusive (our default) — the price the technician quotes IS the final
//     amount; tax is back-calculated out of it. Part prices are MRP, and MRP is
//     inclusive by definition, so this keeps the customer's total exactly the
//     figure they were quoted on site.
//   exclusive — tax is added on top of the quoted price.

// Round half-up to 2 decimals. JS's toFixed rounds half-to-even on some values
// (1.005 → "1.00"), which quietly loses a paisa on a tax line.
export function money(n) {
  const x = Number(n) || 0;
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// Split a line's gross/net into taxable value + tax at `rate` percent.
export function splitLineTax(amount, rate, pricesIncludeGst) {
  const amt = Number(amount) || 0;
  const r = Number(rate) || 0;
  if (r <= 0) return { taxable: money(amt), tax: 0, gross: money(amt) };

  if (pricesIncludeGst) {
    const taxable = money(amt / (1 + r / 100));
    // Derive tax by subtraction so taxable + tax === the quoted amount exactly.
    return { taxable, tax: money(amt - taxable), gross: money(amt) };
  }
  const tax = money((amt * r) / 100);
  return { taxable: money(amt), tax, gross: money(amt + tax) };
}

// Build the full tax summary for a set of billed lines.
//   lines: [{ description, hsn, qty, rate (unit price), amount, gstRate }]
// Returns per-line tax detail, an HSN-wise summary (Tally prints this block),
// and the invoice totals including the statutory round-off.
export function computeInvoiceTax(lines, { pricesIncludeGst = true, isInterstate = false } = {}) {
  const detailed = lines.map((l) => {
    const { taxable, tax, gross } = splitLineTax(l.amount, l.gstRate, pricesIncludeGst);
    return {
      ...l,
      taxable,
      tax,
      gross,
      cgst: isInterstate ? 0 : money(tax / 2),
      sgst: isInterstate ? 0 : money(tax - money(tax / 2)), // remainder, so halves always re-sum
      igst: isInterstate ? tax : 0,
    };
  });

  const sum = (k) => money(detailed.reduce((s, l) => s + (Number(l[k]) || 0), 0));
  const taxableValue = sum("taxable");
  const cgst = sum("cgst");
  const sgst = sum("sgst");
  const igst = sum("igst");

  const beforeRounding = money(taxableValue + cgst + sgst + igst);
  const total = Math.round(beforeRounding);
  const roundOff = money(total - beforeRounding);

  // HSN-wise summary — one row per (hsn, rate) pair.
  const hsnMap = new Map();
  for (const l of detailed) {
    const key = `${l.hsn || "-"}|${l.gstRate || 0}`;
    const row = hsnMap.get(key) || {
      hsn: l.hsn || "-", gstRate: Number(l.gstRate) || 0,
      taxable: 0, cgst: 0, sgst: 0, igst: 0,
    };
    row.taxable = money(row.taxable + l.taxable);
    row.cgst = money(row.cgst + l.cgst);
    row.sgst = money(row.sgst + l.sgst);
    row.igst = money(row.igst + l.igst);
    hsnMap.set(key, row);
  }

  return {
    lines: detailed,
    hsnSummary: [...hsnMap.values()],
    taxableValue, cgst, sgst, igst,
    beforeRounding, roundOff, total,
  };
}

// Indian financial year label for a date: Apr–Mar → '25-26'.
export function financialYear(date = new Date()) {
  // Invoice dates are IST — a job closed at 1 am IST on 1 April is in the new FY,
  // but in UTC it is still 31 March. Shift before reading the month.
  const ist = new Date(new Date(date).getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth(); // 0 = Jan
  const start = m >= 3 ? y : y - 1; // Apr (3) onwards belongs to this year
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

// "One Thousand Two Hundred Fifty Rupees and Fifty Paise Only" — a tax invoice
// must carry the amount in words.
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

// Indian numbering: crore, lakh, thousand, hundred.
function inWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoDigits(n));
  return parts.join(" ");
}

export function amountInWords(amount) {
  const amt = money(amount);
  const rupees = Math.floor(amt);
  const paise = Math.round((amt - rupees) * 100);
  const head = `${inWords(rupees)} Rupees`;
  return paise ? `${head} and ${inWords(paise)} Paise Only` : `${head} Only`;
}

// Indian digit grouping (1,25,000.00) for the PDF.
export function formatAmount(n) {
  return money(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
