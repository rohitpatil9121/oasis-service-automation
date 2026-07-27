// Issues the customer's GST tax invoice.
//
// Invoicing rules that shape this file:
//   * An invoice is raised only AFTER payment is collected, so the amounts are
//     final and the document doubles as the receipt.
//   * Once issued it is IMMUTABLE. Seller, buyer and line items are snapshotted
//     into the row; re-rendering a two-year-old bill must not pick up today's
//     company address or a part that has since been repriced.
//   * One invoice per ticket. The technician app replays offline writes, so
//     issueInvoiceForTicket is idempotent — a repeat call returns the existing
//     invoice instead of burning another serial number.
import { supabase } from "../config/supabase.js";
import { log } from "../lib/logger.js";
import { computeInvoiceTax, financialYear, money } from "../lib/gst.js";
import { renderInvoicePdf } from "./invoicePdf.js";

const BUCKET = "invoices";

// Charge id → the description printed on the invoice line.
const CHARGE_LABELS = {
  service: "Service Charge",
  visit: "Visit Charge",
  warranty: "No Charge (Under Warranty)",
  repeat: "Repeat Call",
};
const CHARGE_FREE = new Set(["warranty", "repeat"]);

export async function getCompanyProfile() {
  const { data, error } = await supabase.from("company_profile").select("*").limit(1).maybeSingle();
  // Graceful until phase9_gst_invoice.sql is applied — a missing table must read
  // as "not configured yet" (which just skips invoicing) rather than throwing
  // inside the payment step.
  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message)) return null;
    throw new Error("getCompanyProfile: " + error.message);
  }
  return data;
}

// A tax invoice without a GSTIN is not a tax invoice — and issuing one that
// shows GST without a valid registration is an offence. Refuse rather than
// produce a document that looks official and is not.
function assertInvoiceable(company) {
  const missing = [];
  if (!company) return ["company_profile row (run phase9_gst_invoice.sql)"];
  if (!String(company.gstin || "").trim()) missing.push("GSTIN");
  if (!String(company.legal_name || "").trim()) missing.push("legal name");
  if (!String(company.state_code || "").trim()) missing.push("state code");
  return missing;
}

// Turn the technician's tech_work into invoice lines, pulling HSN/SAC + GST rate
// from the parts catalog (falling back to the company defaults for anything the
// owner hasn't tagged yet).
async function buildLines(work, company) {
  const parts = Array.isArray(work.parts) ? work.parts : [];
  const lines = [];

  const chargeAmt = work.service_charge != null
    ? Number(work.service_charge) || 0
    : (CHARGE_FREE.has(work.charge) ? 0 : 250);

  if (chargeAmt > 0) {
    lines.push({
      description: CHARGE_LABELS[work.charge] || "Service Charge",
      hsn: company.service_sac || "998714",
      qty: 1,
      rate: chargeAmt,
      amount: chargeAmt,
      gstRate: Number(company.default_gst_rate) || 18,
    });
  }

  // One catalog read for every billed part.
  const ids = parts.map((p) => p.id).filter(Boolean);
  const catalog = new Map();
  if (ids.length) {
    const { data } = await supabase.from("stock_items").select("id, name, hsn_code, gst_rate").in("id", ids);
    for (const row of data || []) catalog.set(row.id, row);
  }

  for (const p of parts) {
    const price = Number(p.price) || 0;
    if (price <= 0) continue;
    const cat = catalog.get(p.id);
    lines.push({
      description: p.name || cat?.name || "Part",
      hsn: cat?.hsn_code || "8421",
      qty: Number(p.qty) || 1,
      rate: price,
      amount: price,
      gstRate: cat?.gst_rate != null ? Number(cat.gst_rate) : (Number(company.default_gst_rate) || 18),
    });
  }

  return lines;
}

// Allocate the next gapless serial for the financial year. The counter lives in
// Postgres (next_invoice_seq) so two technicians closing jobs at the same moment
// cannot get the same number.
async function allocateNumber(company, issuedAt) {
  const fy = financialYear(issuedAt);
  const { data, error } = await supabase.rpc("next_invoice_seq", { p_fy: fy });
  if (error) throw new Error("allocateNumber: " + error.message);
  const seq = Number(data);
  const prefix = company.invoice_prefix || "OG";
  return { fy, seq, invoice_no: `${prefix}/${fy}/${String(seq).padStart(4, "0")}` };
}

async function uploadPdf(buffer, invoiceNo) {
  const path = `${invoiceNo.replace(/\//g, "-")}.pdf`;
  let up = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: "application/pdf", upsert: true,
  });
  if (up.error && /bucket|not found/i.test(up.error.message)) {
    // Meta fetches the document by URL, so the bucket has to be publicly readable.
    await supabase.storage.createBucket(BUCKET, { public: true });
    up = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: "application/pdf", upsert: true,
    });
  }
  if (up.error) throw new Error("uploadPdf: " + up.error.message);
  return { path, url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
}

export async function getInvoiceForTicket(ticketId) {
  const { data, error } = await supabase
    .from("invoices").select("*").eq("ticket_id", ticketId)
    .order("issued_at", { ascending: false }).limit(1).maybeSingle();
  // Same graceful-until-migrated rule as getCompanyProfile: no table yet means
  // no invoice, not an exception in the middle of collecting payment.
  if (error) {
    if (/does not exist|schema cache|relation/i.test(error.message)) return null;
    throw new Error("getInvoiceForTicket: " + error.message);
  }
  return data;
}

/* Issue (or return the existing) tax invoice for a paid ticket.
   `ticket` must carry the customer join; `work` is the merged tech_work.
   Returns { invoice, skipped } — `skipped` carries a reason when no invoice
   could be raised, so the caller can still send its normal payment message. */
export async function issueInvoiceForTicket({ ticket, work, paymentMode }) {
  const existing = await getInvoiceForTicket(ticket.id);
  if (existing) return { invoice: existing, skipped: null };

  const company = await getCompanyProfile();
  const missing = assertInvoiceable(company);
  if (missing.length) return { invoice: null, skipped: `company profile incomplete: ${missing.join(", ")}` };

  const lines = await buildLines(work || {}, company);
  if (!lines.length) return { invoice: null, skipped: "nothing billable on this job" };

  const buyer = ticket.customer || {};
  // No customer state recorded → they are local, which is the normal case for a
  // service business and means CGST + SGST.
  const buyerState = String(buyer.state_code || "").trim();
  const isInterstate = !!buyerState && buyerState !== String(company.state_code).trim();

  const tax = computeInvoiceTax(lines, {
    pricesIncludeGst: company.prices_include_gst !== false,
    isInterstate,
  });

  const issuedAt = new Date().toISOString();
  const { fy, seq, invoice_no } = await allocateNumber(company, issuedAt);

  const seller = {
    legal_name: company.legal_name, trade_name: company.trade_name, gstin: company.gstin,
    address_line1: company.address_line1, address_line2: company.address_line2,
    city: company.city, state: company.state, state_code: company.state_code,
    pincode: company.pincode, phone: company.phone, email: company.email,
    bank_name: company.bank_name, bank_account: company.bank_account, bank_ifsc: company.bank_ifsc,
    upi_id: company.upi_id, upi_payee_name: company.upi_payee_name,
    terms: company.terms,
  };
  const buyerSnap = {
    full_name: buyer.full_name || "Customer", address: buyer.address || "",
    phone: buyer.phone || "", state_code: buyerState || company.state_code, gstin: buyer.gstin || null,
  };

  const record = {
    ticket_id: ticket.id,
    invoice_no, fy, seq, issued_at: issuedAt,
    seller, buyer: buyerSnap,
    line_items: tax.lines,
    place_of_supply: `${isInterstate ? buyerSnap.state_code : company.state || ""}`.trim()
      || company.state_code,
    is_interstate: isInterstate,
    prices_include_gst: company.prices_include_gst !== false,
    taxable_value: tax.taxableValue,
    cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst,
    round_off: tax.roundOff, total: tax.total,
    amount_paid: money(work?.total ?? tax.total),
    payment_mode: paymentMode || null,
  };

  // Render before insert: a PDF that fails to build should not leave a numbered
  // invoice row behind with nothing to send.
  const pdf = await renderInvoicePdf({
    ...record,
    ticket_number: ticket.ticket_number,
    lines: tax.lines,
    hsnSummary: tax.hsnSummary,
  });
  const { path, url } = await uploadPdf(pdf, invoice_no);

  const { data, error } = await supabase
    .from("invoices").insert({ ...record, pdf_path: path, pdf_url: url }).select("*").single();
  if (error) throw new Error("issueInvoiceForTicket insert: " + error.message);

  log.info(`Invoice ${invoice_no} issued for ${ticket.ticket_number} (Rs. ${tax.total})`);
  return { invoice: data, skipped: null };
}

// Re-render an already-issued invoice from its frozen snapshot (dashboard
// download / re-send). Never recomputes tax.
export async function renderStoredInvoice(invoiceId) {
  const { data: inv, error } = await supabase
    .from("invoices").select("*, ticket:tickets(ticket_number)").eq("id", invoiceId).maybeSingle();
  if (error) throw new Error("renderStoredInvoice: " + error.message);
  if (!inv) { const e = new Error("Invoice not found"); e.status = 404; throw e; }

  // hsnSummary is derived, not stored — rebuild it from the frozen line items.
  const map = new Map();
  for (const l of inv.line_items || []) {
    const key = `${l.hsn || "-"}|${l.gstRate || 0}`;
    const row = map.get(key) || { hsn: l.hsn || "-", gstRate: Number(l.gstRate) || 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable = money(row.taxable + (l.taxable || 0));
    row.cgst = money(row.cgst + (l.cgst || 0));
    row.sgst = money(row.sgst + (l.sgst || 0));
    row.igst = money(row.igst + (l.igst || 0));
    map.set(key, row);
  }

  return {
    invoice: inv,
    pdf: await renderInvoicePdf({
      ...inv,
      ticket_number: inv.ticket?.ticket_number || "—",
      lines: inv.line_items || [],
      hsnSummary: [...map.values()],
    }),
  };
}
