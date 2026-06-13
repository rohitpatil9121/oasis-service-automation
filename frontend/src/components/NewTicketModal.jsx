import { useState } from "react";
import { api } from "../api/client.js";

// Manual ticket entry - for requests that come in by phone call / walk-in
// instead of WhatsApp. Uses the same createTicket path, so the customer
// still gets a WhatsApp confirmation and managers still get alerted.
export default function NewTicketModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: "", phone: "", address: "", issue_description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.createTicket(form);
      onCreated();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h3 className="mb-1 text-lg font-semibold">New service request</h3>
        <p className="mb-4 text-sm text-slate-500">For requests received by phone call or walk-in.</p>
        {err && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}

        <label className="block text-sm font-medium text-slate-600">Customer name</label>
        <input value={form.full_name} onChange={set("full_name")} required autoFocus
          className="mt-1 mb-3 w-full rounded border border-slate-300 px-3 py-2" />

        <label className="block text-sm font-medium text-slate-600">Phone (WhatsApp if possible)</label>
        <input value={form.phone} onChange={set("phone")} required placeholder="98765 43210"
          className="mt-1 mb-3 w-full rounded border border-slate-300 px-3 py-2" />

        <label className="block text-sm font-medium text-slate-600">Address</label>
        <textarea value={form.address} onChange={set("address")} rows={2}
          className="mt-1 mb-3 w-full rounded border border-slate-300 px-3 py-2" />

        <label className="block text-sm font-medium text-slate-600">Issue description</label>
        <textarea value={form.issue_description} onChange={set("issue_description")} rows={3} required
          className="mt-1 mb-4 w-full rounded border border-slate-300 px-3 py-2" />

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="rounded px-4 py-2 text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit" disabled={busy}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Creating…" : "Create request"}
          </button>
        </div>
      </form>
    </div>
  );
}
