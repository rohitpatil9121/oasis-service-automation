import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { supabase } from "../config/supabase.js";
import { getCompanyProfile, getInvoiceForTicket, renderStoredInvoice } from "../services/invoice.js";
import { queueNotification } from "../services/notifications.js";
import { customerInvoice } from "../services/waTemplates.js";
import { buildTallyXml } from "../services/tallyExport.js";

const router = Router();
router.use(requireAuth);

const rupees = (n) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Invoice register for the dashboard.
router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("id, invoice_no, issued_at, total, taxable_value, cgst, sgst, igst, payment_mode, pdf_url, buyer, ticket:tickets(ticket_number)")
      .order("issued_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    res.json({ invoices: data });
  } catch (e) { next(e); }
});

// Our own GST details — the dashboard warns when these are incomplete, because
// nothing can be invoiced until they are filled in.
router.get("/company", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json({ company: await getCompanyProfile() }); }
  catch (e) { next(e); }
});

router.patch("/company", requireRole("owner"), async (req, res, next) => {
  try {
    const allowed = ["legal_name", "trade_name", "gstin", "address_line1", "address_line2",
      "city", "state", "state_code", "pincode", "phone", "email", "bank_name", "bank_account",
      "bank_ifsc", "upi_id", "upi_payee_name", "prices_include_gst", "default_gst_rate",
      "service_sac", "invoice_prefix", "terms", "tally_company_name", "tally_sales_ledger",
      "tally_cgst_ledger", "tally_sgst_ledger", "tally_igst_ledger", "tally_roundoff_ledger"];
    const patch = {};
    for (const k of allowed) if (req.body?.[k] !== undefined) patch[k] = req.body[k];
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("company_profile").update(patch).eq("id", true).select("*").single();
    if (error) throw new Error(error.message);
    res.json({ company: data });
  } catch (e) { next(e); }
});

/* Tally import file. Gateway of Tally → Import Data → Vouchers → point it at
   this .xml. Range defaults to the current month. */
router.get("/tally.xml", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const now = new Date();
    const from = req.query.from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const to = req.query.to || now.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("invoices").select("*")
      .gte("issued_at", `${from}T00:00:00Z`)
      .lte("issued_at", `${to}T23:59:59Z`)
      .order("seq", { ascending: true });
    if (error) throw new Error(error.message);

    const xml = buildTallyXml(data || [], await getCompanyProfile());
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tally-invoices-${from}-to-${to}.xml"`);
    res.send(xml);
  } catch (e) { next(e); }
});

// The invoice a ticket was billed under (null if not yet issued).
router.get("/ticket/:ticketId", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json({ invoice: await getInvoiceForTicket(req.params.ticketId) }); }
  catch (e) { next(e); }
});

// Download — re-rendered from the frozen snapshot, so it is byte-for-byte the
// same document the customer received.
router.get("/:id/pdf", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { invoice, pdf } = await renderStoredInvoice(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoice.invoice_no.replace(/\//g, "-")}.pdf"`);
    res.send(pdf);
  } catch (e) { next(e); }
});

// Re-send an already-issued invoice on WhatsApp (customer lost it / wrong number
// fixed). Does NOT re-issue — same number, same document.
router.post("/:id/resend", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { data: inv, error } = await supabase
      .from("invoices").select("*, ticket:tickets(id, ticket_number)").eq("id", req.params.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) return res.status(404).json({ error: "Invoice not found" });

    const phone = req.body?.phone || inv.buyer?.phone;
    if (!phone) return res.status(400).json({ error: "No phone on this invoice" });

    const tpl = customerInvoice({
      customerName: inv.buyer?.full_name || "Customer",
      invoiceNo: inv.invoice_no, amount: rupees(inv.total),
      mode: inv.payment_mode || "—", pdfUrl: inv.pdf_url,
    });
    const id = await queueNotification({
      recipient: phone, audience: "customer", ticketId: inv.ticket?.id,
      body: tpl.body, template: tpl.template, document: tpl.document,
    });
    res.json({ ok: true, notificationId: id });
  } catch (e) { next(e); }
});

export default router;
