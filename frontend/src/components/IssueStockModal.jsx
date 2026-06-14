import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { Modal, Button, Field, Select, Input, Icon, Alert } from "./ui.jsx";

// Manager records the parts a technician is taking for this ticket (replaces the
// paper register). Each row = one part + quantity. On submit the backend issues
// the stock, decrements inventory, and logs an ISSUE movement per line.
export default function IssueStockModal({ ticket, onClose, onIssued }) {
  const [items, setItems] = useState([]);
  const [rows, setRows] = useState([{ stock_item_id: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listStock().then((r) => setItems(r.items)).catch((e) => setErr(e.message));
  }, []);

  const setRow = (i, key) => (e) => {
    const next = rows.slice();
    next[i] = { ...next[i], [key]: e.target.value };
    setRows(next);
  };
  const addRow = () => setRows([...rows, { stock_item_id: "", qty: "" }]);
  const removeRow = (i) => setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : rows);

  const stockFor = (id) => items.find((it) => it.id === id);

  async function submit(e) {
    e.preventDefault();
    const lines = rows
      .filter((r) => r.stock_item_id && Number(r.qty) > 0)
      .map((r) => ({ stock_item_id: r.stock_item_id, qty: Number(r.qty) }));
    if (!lines.length) return setErr("Add at least one part with a quantity.");
    setBusy(true); setErr("");
    try {
      await api.issueStock(ticket.id, ticket.technician?.id, lines);
      onIssued();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="Issue stock" subtitle={`Ticket ${ticket.ticket_number} · ${ticket.technician?.full_name || "no technician assigned"}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert>{err}</Alert>

        {!ticket.technician && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-600/20">
            No technician assigned yet — assign one so the parts are tracked against them.
          </p>
        )}

        <div className="space-y-2">
          {rows.map((r, i) => {
            const it = stockFor(r.stock_item_id);
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <Select value={r.stock_item_id} onChange={setRow(i, "stock_item_id")}>
                    <option value="">— Select part —</option>
                    {items.map((o) => (
                      <option key={o.id} value={o.id} disabled={Number(o.qty_on_hand) <= 0}>
                        {o.name} ({o.qty_on_hand} {o.unit})
                      </option>
                    ))}
                  </Select>
                  {it && <span className="mt-1 block text-xs text-slate-400">In stock: {it.qty_on_hand} {it.unit}</span>}
                </div>
                <div className="w-24">
                  <Input type="number" min="1" max={it ? it.qty_on_hand : undefined}
                    value={r.qty} onChange={setRow(i, "qty")} placeholder="Qty" />
                </div>
                <button type="button" onClick={() => removeRow(i)}
                  className="mt-2 text-slate-300 hover:text-red-500" title="Remove" aria-label="Remove row">
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>

        <button type="button" onClick={addRow}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          <Icon name="plus" className="h-3.5 w-3.5" /> Add another part
        </button>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Issuing…" : "Issue stock"}</Button>
        </div>
      </form>
    </Modal>
  );
}
