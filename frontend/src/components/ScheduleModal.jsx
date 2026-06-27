import { useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Field, Input, Alert } from "./ui.jsx";

// Service Manager sets / changes the visit slot. Date + start time + optional
// end time. Times are the manager's local time; we convert to ISO before sending.
function toLocalParts(iso) {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export default function ScheduleModal({ ticket, onClose, onScheduled }) {
  const startParts = toLocalParts(ticket.scheduled_start);
  const endParts = toLocalParts(ticket.scheduled_end);
  const [date, setDate] = useState(startParts.date);
  const [startTime, setStartTime] = useState(startParts.time);
  const [endTime, setEndTime] = useState(endParts.time);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const rescheduling = !!ticket.scheduled_start;

  // Today as YYYY-MM-DD (local) — used to block scheduling a visit in the past.
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  async function submit(e) {
    e.preventDefault();
    if (!date || !startTime) return setErr("Please pick a date and start time.");
    const start = new Date(`${date}T${startTime}`).toISOString();
    const end = endTime ? new Date(`${date}T${endTime}`).toISOString() : null;
    if (new Date(start) < new Date()) return setErr("Visit time can't be in the past.");
    if (end && end <= start) return setErr("End time must be after the start time.");
    setBusy(true); setErr("");
    try {
      await api.scheduleVisit(ticket.id, start, end);
      onScheduled();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={rescheduling ? "Reschedule visit" : "Schedule visit"}
      subtitle={`Ticket ${ticket.ticket_number}${ticket.technician ? " · " + ticket.technician.full_name : ""}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Visit date"><Input type="date" min={todayStr} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></Field>
          <Field label="End time (optional)"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
        </div>
        {!ticket.technician && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
            No technician assigned — the customer will be notified, but assign a technician so they get the slot too.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : rescheduling ? "Reschedule" : "Schedule"}</Button>
        </div>
      </form>
    </Modal>
  );
}
