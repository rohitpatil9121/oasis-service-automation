import { useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Input, Alert } from "./ui.jsx";

// After the visit: per line, record how much was USED and RETURNED. Whatever's
// left over (issued − used − returned) is variance — shown live and flagged.
export default function ReconcileModal({ issue, onClose, onDone }) {
  const [rows, setRows] = useState(
    (issue.lines || []).map((l) => ({ line_id: l.id, name: l.item?.name, unit: l.item?.unit, issued: Number(l.qty_issued), used: "", returned: "" }))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setVal = (i, key) => (e) => {
    const next = rows.slice();
    next[i] = { ...next[i], [key]: e.target.value };
    setRows(next);
  };
  const overfilled = (r) => (Number(r.used) || 0) + (Number(r.returned) || 0) > r.issued;

  async function submit(e) {
    e.preventDefault();
    if (rows.some(overfilled)) return setErr("Used + returned can't be more than issued.");
    setBusy(true); setErr("");
    try {
      await api.reconcileStock(issue.id, rows.map((r) => ({ line_id: r.line_id, qty_used: Number(r.used) || 0, qty_returned: Number(r.returned) || 0 })));
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Reconcile stock" subtitle="Record what was used and returned after the visit." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_56px_56px_56px] gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Part</span><span className="text-center">Issued</span><span className="text-center">Used</span><span className="text-center">Return</span>
          </div>
          {rows.map((r, i) => {
            const bad = overfilled(r);
            return (
              <div key={r.line_id}>
                <div className="grid grid-cols-[1fr_56px_56px_56px] items-center gap-2">
                  <span className="truncate text-sm text-slate-700">{r.name}</span>
                  <span className="text-center text-sm font-medium text-slate-500">{r.issued}</span>
                  <Input type="number" min="0" max={r.issued} value={r.used} onChange={setVal(i, "used")} className="px-2 py-1 text-center" placeholder="0" />
                  <Input type="number" min="0" max={r.issued} value={r.returned} onChange={setVal(i, "returned")} className="px-2 py-1 text-center" placeholder="0" />
                </div>
                {bad && <p className="mt-0.5 text-[11px] text-red-600">Used + returned exceeds issued ({r.issued}).</p>}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Reconcile"}</Button>
        </div>
      </form>
    </Modal>
  );
}
