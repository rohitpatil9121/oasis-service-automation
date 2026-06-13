import { useEffect, useState } from "react";
import { api } from "../api/client.js";

export default function AssignModal({ ticket, onClose, onAssigned }) {
  const [techs, setTechs] = useState([]);
  const [techId, setTechId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listTechnicians().then((r) => setTechs(r.technicians)).catch((e) => setErr(e.message));
  }, []);

  async function submit() {
    if (!techId) return setErr("Select a technician");
    setBusy(true); setErr("");
    try {
      await api.assign(ticket.id, techId, note);
      onAssigned();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h3 className="mb-1 text-lg font-semibold">Assign technician</h3>
        <p className="mb-4 text-sm text-slate-500">Ticket {ticket.ticket_number}</p>
        {err && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
        <label className="block text-sm font-medium text-slate-600">Technician</label>
        <select value={techId} onChange={(e) => setTechId(e.target.value)}
          className="mt-1 mb-3 w-full rounded border border-slate-300 px-3 py-2">
          <option value="">— Select —</option>
          {techs.map((t) => (
            <option key={t.id} value={t.id}>{t.full_name} ({t.phone})</option>
          ))}
        </select>
        <label className="block text-sm font-medium text-slate-600">Note (optional)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          className="mt-1 mb-4 w-full rounded border border-slate-300 px-3 py-2"
          placeholder="e.g. priority customer" />
        <div className="flex justify-end gap-2">
          <button onClick={onClose}
            className="rounded px-4 py-2 text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={submit} disabled={busy}
            className="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-50">
            {busy ? "Assigning…" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
