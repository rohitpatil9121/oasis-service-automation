import { useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Field, Input, Textarea, PhoneInput, Select, Alert } from "./ui.jsx";

// Service Manager edits the details shown on the ticket's Details card — the
// customer (name / WhatsApp number / address) plus request fields (appliance,
// source, lead source). Technician is intentionally NOT here: assigning sends
// WhatsApp notifications, so it stays on the dedicated Assign / Reassign button.
export default function EditCustomerModal({ ticket, onClose, onUpdated }) {
  const c = ticket.customer || {};
  const [form, setForm] = useState({
    full_name: c.full_name || "",
    phone: c.phone || "",
    address: c.address || "",
    appliance: ticket.appliance || "",
    source: ticket.source || "whatsapp",
    lead_source: ticket.lead_source || "our service team",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.updateCustomer(ticket.id, form);
      onUpdated();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Edit details" subtitle={`Ticket ${ticket.ticket_number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Full name"><Input value={form.full_name} onChange={set("full_name")} required autoFocus /></Field>
        <Field label="WhatsApp number" hint="Changing this updates where the customer is reached.">
          <PhoneInput value={form.phone} onChange={set("phone")} placeholder="98765 43210" />
        </Field>
        <Field label="Address"><Textarea value={form.address} onChange={set("address")} rows={2} placeholder="House / street, area, city" /></Field>
        <Field label="Appliance" hint="Water purifier brand / model, e.g. Kent RO, Prospera.">
          <Input value={form.appliance} onChange={set("appliance")} placeholder="e.g. Kent RO" />
        </Field>
        <Field label="Source" hint="How this request came in.">
          <Select value={form.source} onChange={set("source")}>
            <option value="whatsapp">WhatsApp</option>
            <option value="manual">Manual entry</option>
          </Select>
        </Field>
        <Field label="Lead source" hint="Which brand / partner this request came through.">
          <Select value={form.lead_source} onChange={set("lead_source")}>
            <option value="our service team">Oasis Globe (our service team)</option>
            <option value="KENT">KENT</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Modal>
  );
}
