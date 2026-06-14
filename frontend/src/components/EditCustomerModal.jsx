import { useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Field, Input, Textarea, Alert } from "./ui.jsx";

// Service Manager edits the customer's details on a ticket — name, WhatsApp
// number, and address (e.g. after confirming the right info over chat).
export default function EditCustomerModal({ ticket, onClose, onUpdated }) {
  const c = ticket.customer || {};
  const [form, setForm] = useState({ full_name: c.full_name || "", phone: c.phone || "", address: c.address || "" });
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
    <Modal title="Edit customer details" subtitle={`Ticket ${ticket.ticket_number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Full name"><Input value={form.full_name} onChange={set("full_name")} required autoFocus /></Field>
        <Field label="WhatsApp number" hint="Changing this updates where the customer is reached.">
          <Input value={form.phone} onChange={set("phone")} placeholder="+9198XXXXXXXX" />
        </Field>
        <Field label="Address"><Textarea value={form.address} onChange={set("address")} rows={2} placeholder="House / street, area, city" /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>
    </Modal>
  );
}
