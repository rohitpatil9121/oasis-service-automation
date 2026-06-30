import { useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Field, Input, Textarea, Select, PhoneInput, Alert } from "./ui.jsx";

// Manual ticket entry — for requests that come in by phone call / walk-in.
// Uses the same createTicket path, so the customer still gets a WhatsApp
// confirmation and managers still get alerted.
export default function NewTicketModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ full_name: "", phone: "", address: "", issue_description: "", lead_source: "our service team" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.createTicket(form);
      onCreated();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="New service request" subtitle="For requests received by phone call or walk-in." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Customer name"><Input value={form.full_name} onChange={set("full_name")} required autoFocus /></Field>
        <Field label="Phone (WhatsApp if possible)"><PhoneInput value={form.phone} onChange={set("phone")} required placeholder="98765 43210" /></Field>
        <Field label="Address"><Textarea value={form.address} onChange={set("address")} rows={2} /></Field>
        <Field label="Issue description"><Textarea value={form.issue_description} onChange={set("issue_description")} rows={3} required /></Field>
        <Field label="Lead source" hint="Shown to the customer in their request confirmation.">
          <Select value={form.lead_source} onChange={set("lead_source")}>
            <option value="our service team">Oasis Globe (our service team)</option>
            <option value="KENT">KENT</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create request"}</Button>
        </div>
      </form>
    </Modal>
  );
}
