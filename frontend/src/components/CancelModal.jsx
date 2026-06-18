import { useState } from "react";
import { Modal, Button, Field, Select, Textarea, Alert } from "./ui.jsx";

const REASONS = [
  "Customer no longer needs the service",
  "Issue resolved on its own",
  "Customer found another service provider",
  "Duplicate request",
  "Unable to reach the customer",
  "Out of service area",
  "Other",
];

export default function CancelModal({ ticket, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!reason) return setErr("Please select a reason for cancellation.");
    const finalReason = reason === "Other" ? note.trim() : reason;
    if (!finalReason) return setErr("Please describe the cancellation reason.");
    setBusy(true); setErr("");
    try {
      await onConfirm(finalReason);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Cancel request" subtitle={`Ticket ${ticket.ticket_number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <p className="text-sm text-slate-500">
          The customer will be notified on WhatsApp that their request was cancelled, along with the reason below.
        </p>
        <Field label="Reason for cancellation">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">— Select a reason —</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        {reason === "Other" && (
          <Field label="Describe the reason">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder="Tell the customer why the request is being cancelled" autoFocus />
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Keep request</Button>
          <Button type="submit" disabled={busy}>{busy ? "Cancelling…" : "Cancel request"}</Button>
        </div>
      </form>
    </Modal>
  );
}
