// Renders the customer's GST tax invoice as a PDF, laid out like a Tally sales
// invoice: bordered header block, seller/buyer panels, an itemised table with
// HSN/SAC, the HSN-wise tax summary Tally prints below it, amount in words,
// bank details and a signature block.
//
// pdfmake (not Puppeteer) on purpose: it is pure JS, so the deploy stays small
// and there is no headless Chromium to keep alive on the server for what is a
// fixed, table-shaped document.
//
// Currency is printed as "Rs." rather than the rupee sign: the PDF standard-14
// fonts use WinAnsi encoding, which has no glyph for U+20B9, and embedding a
// Unicode TTF just for one symbol is not worth the weight.
import PdfPrinter from "pdfmake";
import { amountInWords, formatAmount } from "../lib/gst.js";

const FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

const printer = new PdfPrinter(FONTS);

const BORDER = "#333333";
const rs = (n) => `Rs. ${formatAmount(n)}`;

const istDate = (d) =>
  new Date(d).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
  });

// A labelled block of lines, used for both the seller and buyer panels.
function partyBlock(title, lines) {
  return {
    stack: [
      { text: title, bold: true, fontSize: 8, color: "#666666", margin: [0, 0, 0, 3] },
      ...lines.filter(Boolean).map((l, i) => ({
        text: l, fontSize: i === 0 ? 11 : 8.5, bold: i === 0, margin: [0, 0, 0, 1],
      })),
    ],
  };
}

function labelValueRows(pairs) {
  return {
    table: {
      widths: ["45%", "55%"],
      body: pairs.filter(Boolean).map(([k, v]) => [
        { text: k, fontSize: 8.5, color: "#555555", border: [false, false, false, false], margin: [0, 1, 0, 1] },
        { text: String(v ?? "—"), fontSize: 8.5, bold: true, border: [false, false, false, false], margin: [0, 1, 0, 1] },
      ]),
    },
    layout: "noBorders",
  };
}

export function buildInvoiceDoc(inv) {
  const { seller, buyer, lines, hsnSummary } = inv;
  const interstate = inv.is_interstate;
  const upi = upiLink(seller, inv);

  // ---- itemised table ----
  // No HSN/SAC column by owner's decision — the codes are still stored on every
  // line (invoices.line_items) for the Tally export and the GST returns, they
  // just aren't printed on the customer's copy.
  const itemHeader = ["Sl", "Description of Goods / Services", "Qty", "Rate", "Amount"].map((t) => ({
    text: t, bold: true, fontSize: 8.5, fillColor: "#eeeeee", margin: [3, 4, 3, 4],
    alignment: t === "Sl" || t === "Description of Goods / Services" ? "left" : "right",
  }));

  const itemRows = lines.map((l, i) => [
    { text: String(i + 1), fontSize: 8.5, margin: [3, 3, 3, 3] },
    { text: l.description, fontSize: 8.5, margin: [3, 3, 3, 3] },
    { text: String(l.qty ?? 1), fontSize: 8.5, alignment: "right", margin: [3, 3, 3, 3] },
    { text: formatAmount(l.rate ?? l.amount), fontSize: 8.5, alignment: "right", margin: [3, 3, 3, 3] },
    { text: formatAmount(l.gross), fontSize: 8.5, alignment: "right", margin: [3, 3, 3, 3] },
  ]);

  // Totals ride in the same table so the column rules line up, exactly as Tally
  // prints them. Borders are [left, top, right, bottom]; `closeBox` draws the
  // bottom edge across every cell so the last row seals the table instead of
  // leaving it open under TOTAL.
  const totalRow = (label, value, opts = {}) => {
    const b = !!opts.closeBox;
    return [
      { text: "", border: [true, false, false, b] },
      { text: "", border: [false, false, false, b] },
      { text: "", border: [false, false, false, b] },
      { text: label, fontSize: 8.5, alignment: "right", bold: !!opts.bold, margin: [3, 2, 3, 2], border: [false, false, false, b] },
      {
        text: value, fontSize: opts.big ? 10 : 8.5, alignment: "right", bold: !!opts.bold,
        margin: [3, 2, 3, 2], border: [true, !!opts.ruleAbove, true, b],
      },
    ];
  };

  const taxRows = interstate
    ? [totalRow(`IGST`, formatAmount(inv.igst))]
    : [totalRow(`CGST`, formatAmount(inv.cgst)), totalRow(`SGST`, formatAmount(inv.sgst))];

  // ---- rate-wise tax summary ----
  // Grouped by GST rate rather than by HSN, since the codes are off the printed
  // copy. Collapse the HSN-wise rows the caller passed in.
  const rateMap = new Map();
  for (const h of hsnSummary) {
    const row = rateMap.get(h.gstRate) || { gstRate: h.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += h.taxable; row.cgst += h.cgst; row.sgst += h.sgst; row.igst += h.igst;
    rateMap.set(h.gstRate, row);
  }
  const rateSummary = [...rateMap.values()].sort((a, b) => a.gstRate - b.gstRate);

  const summaryHead = interstate
    ? ["Taxable Value", "IGST Rate", "IGST Amount", "Total Tax"]
    : ["Taxable Value", "CGST Rate", "CGST Amt", "SGST Rate", "SGST Amt", "Total Tax"];

  const summaryBody = rateSummary.map((h) => {
    const tax = interstate ? h.igst : h.cgst + h.sgst;
    const cells = interstate
      ? [formatAmount(h.taxable), `${h.gstRate}%`, formatAmount(h.igst), formatAmount(tax)]
      : [formatAmount(h.taxable), `${h.gstRate / 2}%`, formatAmount(h.cgst),
         `${h.gstRate / 2}%`, formatAmount(h.sgst), formatAmount(tax)];
    return cells.map((c) => ({
      text: String(c), fontSize: 8, alignment: "right", margin: [3, 3, 3, 3],
    }));
  });

  const totalTax = interstate ? inv.igst : inv.cgst + inv.sgst;
  const summaryTotal = (interstate
    ? [formatAmount(inv.taxable_value), "", formatAmount(inv.igst), formatAmount(totalTax)]
    : [formatAmount(inv.taxable_value), "", formatAmount(inv.cgst), "", formatAmount(inv.sgst), formatAmount(totalTax)]
  ).map((c) => ({
    text: String(c), fontSize: 8, bold: true, fillColor: "#f6f6f6",
    alignment: "right", margin: [3, 3, 3, 3],
  }));

  const sellerAddr = [seller.address_line1, seller.address_line2,
    [seller.city, seller.pincode].filter(Boolean).join(" - ")].filter(Boolean);

  return {
    pageSize: "A4",
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { font: "Helvetica", color: "#111111" },

    footer: (page, count) => ({
      columns: [
        { text: "This is a computer-generated invoice.", fontSize: 7, color: "#888888", margin: [28, 0, 0, 0] },
        { text: `Page ${page} of ${count}`, fontSize: 7, color: "#888888", alignment: "right", margin: [0, 0, 28, 0] },
      ],
    }),

    content: [
      { text: "TAX INVOICE", alignment: "center", bold: true, fontSize: 13, margin: [0, 0, 0, 2] },
      {
        text: seller.gstin ? `GSTIN: ${seller.gstin}` : "",
        alignment: "center", fontSize: 8.5, color: "#555555", margin: [0, 0, 0, 8],
      },

      // Seller + invoice meta
      {
        table: {
          widths: ["58%", "42%"],
          body: [[
            partyBlock("SOLD BY", [
              seller.legal_name,
              seller.trade_name && seller.trade_name !== seller.legal_name ? seller.trade_name : null,
              ...sellerAddr,
              seller.state ? `State: ${seller.state}${seller.state_code ? ` (${seller.state_code})` : ""}` : null,
              seller.phone ? `Phone: ${seller.phone}` : null,
              seller.email ? `Email: ${seller.email}` : null,
            ]),
            labelValueRows([
              ["Invoice No.", inv.invoice_no],
              ["Dated", istDate(inv.issued_at)],
              ["Reference", inv.ticket_number],
              ["Place of Supply", inv.place_of_supply],
              ["Payment Mode", inv.payment_mode],
            ]),
          ]],
        },
        layout: {
          hLineColor: () => BORDER, vLineColor: () => BORDER,
          hLineWidth: () => 0.7, vLineWidth: () => 0.7,
          paddingLeft: () => 7, paddingRight: () => 7, paddingTop: () => 6, paddingBottom: () => 6,
        },
        margin: [0, 0, 0, 0],
      },

      // Buyer
      {
        table: {
          widths: ["100%"],
          body: [[
            partyBlock("BUYER (BILL TO)", [
              buyer.full_name,
              buyer.address,
              buyer.phone ? `Phone: ${buyer.phone}` : null,
              buyer.gstin ? `GSTIN: ${buyer.gstin}` : null,
            ]),
          ]],
        },
        layout: {
          hLineColor: () => BORDER, vLineColor: () => BORDER,
          hLineWidth: () => 0.7, vLineWidth: () => 0.7,
          paddingLeft: () => 7, paddingRight: () => 7, paddingTop: () => 6, paddingBottom: () => 6,
        },
        margin: [0, -0.7, 0, 0],
      },

      // Items + totals
      {
        table: {
          headerRows: 1,
          widths: [22, "*", 40, 70, 80],
          body: [
            itemHeader,
            ...itemRows,
            totalRow("Taxable Value", formatAmount(inv.taxable_value), { ruleAbove: true }),
            ...taxRows,
            ...(Number(inv.round_off) !== 0 ? [totalRow("Round Off", formatAmount(inv.round_off))] : []),
            totalRow("TOTAL", rs(inv.total), { bold: true, big: true, ruleAbove: true, closeBox: true }),
          ],
        },
        layout: {
          hLineColor: () => BORDER, vLineColor: () => BORDER,
          hLineWidth: () => 0.7, vLineWidth: () => 0.7,
        },
        margin: [0, -0.7, 0, 10],
      },

      {
        text: [{ text: "Amount Chargeable (in words): ", fontSize: 8.5, color: "#555555" },
               { text: amountInWords(inv.total), fontSize: 9, bold: true }],
        margin: [0, 0, 0, 10],
      },

      { text: "Tax Summary", bold: true, fontSize: 9, margin: [0, 0, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: interstate ? ["*", 70, 80, 80] : ["*", 55, 70, 55, 70, 75],
          body: [
            summaryHead.map((t) => ({
              text: t, bold: true, fontSize: 8, fillColor: "#eeeeee", margin: [3, 4, 3, 4],
              alignment: "right",
            })),
            ...summaryBody,
            summaryTotal,
          ],
        },
        layout: {
          hLineColor: () => BORDER, vLineColor: () => BORDER,
          hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        },
        margin: [0, 0, 0, 12],
      },

      {
        columns: [
          {
            width: "42%",
            stack: [
              ...(seller.bank_name || seller.bank_account ? [
                { text: "Bank Details", bold: true, fontSize: 8.5, margin: [0, 0, 0, 2] },
                { text: [seller.bank_name, seller.bank_account ? `A/c: ${seller.bank_account}` : null,
                         seller.bank_ifsc ? `IFSC: ${seller.bank_ifsc}` : null]
                    .filter(Boolean).join("\n"), fontSize: 8, margin: [0, 0, 0, 8] },
              ] : []),
              { text: "Declaration", bold: true, fontSize: 8.5, margin: [0, 0, 0, 2] },
              {
                text: seller.terms
                  || "We declare that this invoice shows the actual price of the goods and services described and that all particulars are true and correct.",
                fontSize: 7.5, color: "#555555",
              },
            ],
          },
          // UPI payment QR, generated by pdfmake from the standard upi:// intent
          // so any payment app can read it. Rendered only when a UPI ID is set
          // on the company profile — an unscannable placeholder box would be
          // worse than no QR at all.
          {
            width: "26%",
            stack: upi
              ? [
                  { qr: upi, fit: 92, alignment: "center", margin: [0, 0, 0, 3] },
                  { text: "Scan to pay (UPI)", fontSize: 7, alignment: "center", color: "#555555" },
                  { text: seller.upi_id, fontSize: 6.5, alignment: "center", color: "#888888" },
                ]
              : [],
          },
          {
            width: "32%",
            stack: [
              { text: `for ${seller.trade_name || seller.legal_name}`, fontSize: 8.5, alignment: "right", margin: [0, 0, 0, 34] },
              { text: "Authorised Signatory", fontSize: 8.5, alignment: "right", bold: true },
            ],
          },
        ],
      },
    ],
  };
}

// A Virtual Payment Address: local-part@handle, e.g. oasisglobe@okhdfcbank.
const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

/* Standard UPI deep link.

   Encoding matters here. URLSearchParams serialises to
   application/x-www-form-urlencoded, which turns a space into "+" — but a upi://
   link is a URI, and payment apps read "+" literally, so the payee would show as
   "Oasisglobe+Enterprises". Percent-encode instead. `pa` is left raw because its
   "@" is legal unencoded in a query and that is the form every real-world UPI QR
   uses; some apps reject the %40 variant.

   No `am` (amount) on purpose: this invoice is issued AFTER the money is
   collected, so a QR pre-filled with the amount is an invitation to pay twice.
   It is a plain "pay us" QR, with the invoice number as the note so any future
   payment still reconciles. */
function upiLink(seller, inv) {
  const pa = String(seller?.upi_id || "").trim();
  if (!pa || !VPA_RE.test(pa)) return null;

  const pn = String(seller.upi_payee_name || seller.trade_name || seller.legal_name || "").trim();
  const parts = [`pa=${pa}`, "cu=INR"];
  if (pn) parts.push(`pn=${encodeURIComponent(pn)}`);
  if (inv?.invoice_no) parts.push(`tn=${encodeURIComponent(`Invoice ${inv.invoice_no}`)}`);
  return `upi://pay?${parts.join("&")}`;
}

// Render to a Buffer.
export function renderInvoicePdf(inv) {
  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(buildInvoiceDoc(inv));
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    } catch (e) { reject(e); }
  });
}
