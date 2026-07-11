import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { Button, Card, Icon, Input, Select, Field, Alert, EmptyState, Modal } from "../components/ui.jsx";

export default function Stock() {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const load = useCallback(async () => {
    try {
      const { items } = await api.listStock();
      setItems(items);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(it) {
    if (!window.confirm(`Remove "${it.name}" from inventory?`)) return;
    try { await api.removeStockItem(it.id); load(); } catch (e) { setErr(e.message); }
  }

  const visible = items.filter((it) => {
    if (brandFilter && it.brand !== brandFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return it.name?.toLowerCase().includes(q) || it.sku?.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory</h1>
          <p className="mt-0.5 text-sm text-slate-400">Parts in stock. Issue them to a technician from their page.</p>
        </div>
        <Button onClick={() => setShowAdd(true)}><Icon name="plus" /> Add item</Button>
      </div>

      <div className="mb-4 relative max-w-sm">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon name="search" />
        </span>
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search item name…" className="pl-9" />
      </div>

      <div className="mb-4 flex gap-2">
        {["oasis", "kent", "aquaguard"].map((b) => (
          <button key={b} type="button"
            onClick={() => setBrandFilter(brandFilter === b ? "" : b)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium capitalize transition ${
              brandFilter === b
                ? "border-brand bg-brand text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-brand/40 hover:text-brand"
            }`}>
            {b}
          </button>
        ))}
      </div>

      {err && <Alert>{err}</Alert>}

      {!loaded ? (
        <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-slate-400">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState icon="box" title={search ? "No matching items" : "No items yet"}
          hint={search ? "Try a different search." : "Add your first inventory item to start issuing stock."} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Item</th>
                  <th className="px-4 py-3 font-semibold">Brand</th>
                  <th className="px-4 py-3 font-semibold">In stock</th>
                  <th className="px-4 py-3 font-semibold">MRP</th>
                  <th className="px-4 py-3 font-semibold">Min price</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((it) => {
                  const low = Number(it.qty_on_hand) <= Number(it.reorder_level);
                  return (
                    <tr key={it.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{it.name}</td>
                      <td className="px-4 py-3">
                        {it.brand ? (
                          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium capitalize text-brand">
                            {it.brand}{it.brand === "oasis" && it.base_cost > 0 ? ` · ₹${it.base_cost}` : ""}
                          </span>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 font-medium ${low ? "text-amber-600" : "text-slate-700"}`}>
                          {it.qty_on_hand} {it.unit}
                          {low && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600 ring-1 ring-inset ring-amber-600/20">Low</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">₹{it.unit_price}</td>
                      <td className="px-4 py-3 text-slate-600">₹{it.base_cost || 0}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => setEditItem(it)} title="Edit item"
                            className="text-slate-300 transition hover:text-brand">
                            <Icon name="edit" className="h-4 w-4" />
                          </button>
                          <button onClick={() => remove(it)} title="Remove item"
                            className="text-slate-300 transition hover:text-red-500">
                            <Icon name="trash" className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {showAdd && (
        <ItemModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
      {editItem && (
        <ItemModal item={editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); load(); }} />
      )}
    </div>
  );
}

// Shared add / edit modal. `item` present = edit mode.
function ItemModal({ item, onClose, onSaved }) {
  const editing = !!item;
  const [form, setForm] = useState({
    name: item?.name || "",
    unit: item?.unit || "pcs",
    qty_on_hand: editing ? String(item.qty_on_hand) : "",
    reorder_level: editing ? String(item.reorder_level) : "",
    unit_price: editing ? String(item.unit_price) : "",
    brand: item?.brand || "",
    base_cost: editing && item.base_cost ? String(item.base_cost) : "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      if (editing) await api.updateStockItem(item.id, form);
      else await api.createStockItem(form);
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title={editing ? "Edit item" : "Add inventory item"}
      subtitle={editing ? item.name : "It becomes available to issue right away."} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>
        <Field label="Item name"><Input value={form.name} onChange={set("name")} required autoFocus placeholder="RO Sediment Filter" /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={editing ? "In stock" : "Opening qty"}><Input type="number" min="0" value={form.qty_on_hand} onChange={set("qty_on_hand")} placeholder="0" /></Field>
          <Field label="Reorder at"><Input type="number" min="0" value={form.reorder_level} onChange={set("reorder_level")} placeholder="0" /></Field>
          <Field label="Unit"><Input value={form.unit} onChange={set("unit")} placeholder="pcs" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="MRP ₹"><Input type="number" min="0" value={form.unit_price} onChange={set("unit_price")} placeholder="0" /></Field>
          <Field label="Minimum price ₹" hint="Lowest price a technician can charge">
            <Input type="number" min="0" value={form.base_cost} onChange={set("base_cost")} placeholder="0" />
          </Field>
        </div>
        {/* Brand drives the technician incentive: Kent/Aquaguard earn 6–10% of the
            sale; Oasis earns the margin over the minimum (buy) price. */}
        <Field label="Brand (for incentive)" hint="Leave blank if no incentive applies">
          <Select value={form.brand} onChange={set("brand")}>
            <option value="">— None —</option>
            <option value="kent">Kent</option>
            <option value="aquaguard">Aquaguard</option>
            <option value="oasis">Oasis</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add item"}</Button>
        </div>
      </form>
    </Modal>
  );
}
