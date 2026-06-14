import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Field, Select, Textarea, Alert } from "./ui.jsx";
import { Link } from "react-router-dom";

export default function AssignModal({ ticket, onClose, onAssigned }) {
  const [techs, setTechs] = useState([]);
  const [techId, setTechId] = useState(ticket.technician?.id || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listTechnicians()
      .then((r) => setTechs(r.technicians.filter((t) => t.is_active)))
      .catch((e) => setErr(e.message));
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!techId) return setErr("Please select a technician.");
    setBusy(true); setErr("");
    try {
      await api.assign(ticket.id, techId, note);
      onAssigned();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Assign technician" subtitle={`Ticket ${ticket.ticket_number}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Technician">
          <Select value={techId} onChange={(e) => setTechId(e.target.value)}>
            <option value="">— Select a technician —</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.full_name} ({t.phone})</option>)}
          </Select>
        </Field>
        {techs.length === 0 && (
          <p className="text-sm text-slate-500">No active technicians. <Link to="/technicians" className="font-medium text-brand hover:underline">Add one →</Link></p>
        )}
        <Field label="Note (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. priority customer" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !techId}>{busy ? "Assigning…" : "Assign"}</Button>
        </div>
      </form>
    </Modal>
  );
}
