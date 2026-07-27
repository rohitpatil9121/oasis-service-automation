import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { Card, Button, Icon, Alert } from "./ui.jsx";

const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/* The GST tax invoice raised for a ticket, if one exists.
   Renders nothing until payment is collected — the invoice is only issued then,
   so an empty card on every open job would just be noise.

   The PDF route is authenticated, so it can't be a plain <a href>: fetch it with
   the bearer token and open the resulting object URL. */
export default function InvoiceCard({ ticketId }) {
  const [invoice, setInvoice] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const { invoice } = await api.getTicketInvoice(ticketId);
      setInvoice(invoice || null);
    } catch { /* invoicing may not be set up yet — stay silent */ }
    finally { setLoaded(true); }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  async function openPdf() {
    setBusy("pdf"); setErr("");
    try {
      const url = await api.invoicePdfBlobUrl(invoice.id);
      window.open(url, "_blank", "noopener");
      // Let the new tab take the blob before revoking it.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  async function resend() {
    if (!window.confirm(`Send invoice ${invoice.invoice_no} to ${invoice.buyer?.phone} on WhatsApp again?`)) return;
    setBusy("resend"); setErr(""); setMsg("");
    try {
      await api.resendInvoice(invoice.id);
      setMsg("Invoice sent on WhatsApp.");
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }

  if (!loaded || !invoice) return null;

  const tax = Number(invoice.cgst) + Number(invoice.sgst) + Number(invoice.igst);

  return (
    <Card className="mb-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tax invoice</h3>
          <p className="mt-1 font-mono text-sm font-semibold text-slate-800">{invoice.invoice_no}</p>
          <p className="text-xs text-slate-400">{fmtDate(invoice.issued_at)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={openPdf} disabled={busy === "pdf"}>
            <Icon name="file" className="h-4 w-4" /> {busy === "pdf" ? "Opening…" : "View PDF"}
          </Button>
          <Button variant="ghost" onClick={resend} disabled={busy === "resend"}>
            <Icon name="chat" className="h-4 w-4" /> {busy === "resend" ? "Sending…" : "Re-send"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-400">Taxable value</div>
          <div className="font-medium text-slate-700">{money(invoice.taxable_value)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">{invoice.is_interstate ? "IGST" : "CGST + SGST"}</div>
          <div className="font-medium text-slate-700">{money(tax)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Paid via</div>
          <div className="font-medium text-slate-700">{invoice.payment_mode || "—"}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Total</div>
          <div className="text-base font-bold text-slate-900">{money(invoice.total)}</div>
        </div>
      </div>

      {msg && <p className="mt-3 text-sm font-medium text-emerald-600">{msg}</p>}
      {err && <div className="mt-3"><Alert>{err}</Alert></div>}
    </Card>
  );
}
