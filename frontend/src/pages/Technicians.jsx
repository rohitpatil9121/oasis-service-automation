import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { Button, Card, Icon, Input, Field, Alert, EmptyState, Modal } from "../components/ui.jsx";

export default function Technicians() {
  const navigate = useNavigate();
  const [techs, setTechs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      const { technicians } = await api.listTechnicians();
      setTechs(technicians);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(t, e) {
    e.stopPropagation();
    if (!window.confirm(`Remove ${t.full_name}? They'll no longer appear or receive new jobs.`)) return;
    try { await api.removeTechnician(t.id); load(); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Technicians</h1>
          <p className="mt-0.5 text-sm text-slate-400">Click a technician to issue & reconcile their bulk stock.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Icon name="plus" /> Add technician</Button>
      </div>

      {err && <Alert>{err}</Alert>}

      {!loaded ? (
        <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-slate-400">Loading…</div>
      ) : techs.length === 0 ? (
        <EmptyState icon="users" title="No technicians yet" hint="Add your first technician to start assigning jobs." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {techs.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/technicians/${t.id}`)}
                    className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                          {(t.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                        <span className="font-medium text-slate-800">{t.full_name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{t.phone}</td>
                    <td className="px-4 py-3 text-slate-600">{t.email || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {t.is_active
                        ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">Active</span>
                        : <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-500/20">Inactive</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={(e) => remove(t, e)} title="Remove technician"
                        className="text-slate-300 transition hover:text-red-500">
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && (
        <AddTechnician onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}

function AddTechnician({ onClose, onAdded }) {
  const [form, setForm] = useState({ full_name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.createTechnician(form);
      onAdded();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Add technician" subtitle="They'll appear in the assign list right away." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Full name"><Input value={form.full_name} onChange={set("full_name")} required autoFocus /></Field>
        <Field label="Phone (WhatsApp)" hint="They receive job alerts here.">
          <Input value={form.phone} onChange={set("phone")} required placeholder="98765 43210" />
        </Field>
        <Field label="Email (optional)"><Input type="email" value={form.email} onChange={set("email")} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add technician"}</Button>
        </div>
      </form>
    </Modal>
  );
}
