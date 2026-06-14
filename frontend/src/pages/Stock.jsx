import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { Button, Card, Icon, Input, Field, Alert, EmptyState, Modal } from "../components/ui.jsx";

export default function Stock() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    try {
      const { items } = await api.listStock();
      setItems(items);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory</h1>
          <p className="mt-0.5 text-sm text-slate-400">Parts in stock. Issue them to a technician from a service request.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Icon name="plus" /> Add item</Button>
      </div>

      {err && <Alert>{err}</Alert>}

      {!loaded ? (
        <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-slate-400">Loading…</div>
      ) : items.length === 0 ? (
        <EmptyState icon="box" title="No items yet" hint="Add your first inventory item to start issuing stock." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">SKU</th>
                  <th className="px-4 py-3 font-semibold">In stock</th>
                  <th className="px-4 py-3 font-semibold">Unit price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it) => {
                  const low = Number(it.qty_on_hand) <= Number(it.reorder_level);
                  return (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{it.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{it.sku || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 font-medium ${low ? "text-amber-600" : "text-slate-700"}`}>
                          {it.qty_on_hand} {it.unit}
                          {low && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600 ring-1 ring-inset ring-amber-600/20">Low</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">₹{it.unit_price}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && (
        <AddItem onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}

function AddItem({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: "", sku: "", unit: "pcs", qty_on_hand: "", reorder_level: "", unit_price: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      await api.createStockItem(form);
      onAdded();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Add inventory item" subtitle="It becomes available to issue right away." onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Item name"><Input value={form.name} onChange={set("name")} required autoFocus placeholder="RO Sediment Filter" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU (optional)"><Input value={form.sku} onChange={set("sku")} placeholder="RO-SED-10" /></Field>
          <Field label="Unit"><Input value={form.unit} onChange={set("unit")} placeholder="pcs" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Opening qty"><Input type="number" min="0" value={form.qty_on_hand} onChange={set("qty_on_hand")} placeholder="0" /></Field>
          <Field label="Reorder at"><Input type="number" min="0" value={form.reorder_level} onChange={set("reorder_level")} placeholder="0" /></Field>
          <Field label="Unit price ₹"><Input type="number" min="0" value={form.unit_price} onChange={set("unit_price")} placeholder="0" /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add item"}</Button>
        </div>
      </form>
    </Modal>
  );
}
