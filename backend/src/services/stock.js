// Stock domain logic. Phase 2, step 1 = "Digital stock issue": the Service
// Manager records which parts a technician takes for a job (replaces the paper
// register). EVERY inventory movement is written to the `stock_movements` ledger
// so the full in/out history is always reconstructable.
//
// Inventory accounting: a part physically leaves the store when it's ISSUED, so
// `qty_on_hand` is decremented at issue time. Unused parts come back at the
// reconciliation step (next in the sequence), which is RETURN/CONSUME/VARIANCE.
import { supabase } from "../config/supabase.js";
import { log } from "../lib/logger.js";

// ---------- master inventory ----------

export async function listStockItems({ activeOnly = true } = {}) {
  let q = supabase.from("stock_items").select("*").order("name");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw new Error("listStockItems: " + error.message);
  return data;
}

export async function createStockItem({ name, sku, unit, qty_on_hand, reorder_level, unit_price }, actorId) {
  const cleanName = (name || "").trim();
  if (!cleanName) { const e = new Error("Item name is required"); e.status = 400; throw e; }

  const qty = Number(qty_on_hand) || 0;
  const { data, error } = await supabase
    .from("stock_items")
    .insert({
      name: cleanName,
      sku: (sku || "").trim() || null,
      unit: (unit || "pcs").trim(),
      qty_on_hand: qty,
      reorder_level: Number(reorder_level) || 0,
      unit_price: Number(unit_price) || 0,
    })
    .select("*").single();
  if (error) {
    if (error.code === "23505") { const e = new Error("An item with this SKU already exists"); e.status = 409; throw e; }
    throw new Error("createStockItem: " + error.message);
  }

  // Opening stock is itself a movement — log it so the ledger is complete.
  if (qty > 0) {
    await logMovement({
      stockItemId: data.id, type: "RESTOCK", qty, balanceAfter: qty,
      actorId, note: "Opening stock",
    });
  }
  log.info(`Stock item created: ${cleanName} (qty ${qty})`);
  return data;
}

// ---------- the ledger ----------

// Append one movement row. `qty` is signed (+ into store, − out of store).
async function logMovement({ stockItemId, type, qty, balanceAfter, ticketId, stockIssueId, actorId, note }) {
  const { error } = await supabase.from("stock_movements").insert({
    stock_item_id: stockItemId,
    movement_type: type,
    qty,
    balance_after: balanceAfter,
    ticket_id: ticketId || null,
    stock_issue_id: stockIssueId || null,
    actor_id: actorId || null,
    note: note || null,
  });
  if (error) log.error("logMovement failed:", error.message);
}

// ---------- digital stock issue ----------

// Issue parts to the assigned technician for a ticket. `lines` = [{ stock_item_id, qty }].
// Creates the issue header + lines, decrements each item's qty_on_hand, and logs
// an ISSUE movement per line. Validates availability before touching anything.
export async function issueStock({ ticketId, technicianId, issuedBy, lines }) {
  const clean = (lines || [])
    .map((l) => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty) }))
    .filter((l) => l.stock_item_id && l.qty > 0);
  if (!clean.length) { const e = new Error("Add at least one part with a quantity"); e.status = 400; throw e; }

  // Load the items and check availability up front (fail before any write).
  const ids = [...new Set(clean.map((l) => l.stock_item_id))];
  const { data: items, error: itemErr } = await supabase
    .from("stock_items").select("id, name, qty_on_hand").in("id", ids);
  if (itemErr) throw new Error("issueStock load: " + itemErr.message);
  const byId = new Map(items.map((i) => [i.id, i]));

  for (const l of clean) {
    const item = byId.get(l.stock_item_id);
    if (!item) { const e = new Error("Unknown stock item"); e.status = 400; throw e; }
    if (Number(item.qty_on_hand) < l.qty) {
      const e = new Error(`Not enough "${item.name}" in stock (have ${item.qty_on_hand}, need ${l.qty})`);
      e.status = 409; throw e;
    }
  }

  // Create the issue header.
  const { data: issue, error: issueErr } = await supabase
    .from("stock_issues")
    .insert({ ticket_id: ticketId, technician_id: technicianId || null, issued_by: issuedBy || null })
    .select("*").single();
  if (issueErr) throw new Error("issueStock header: " + issueErr.message);

  // Per line: insert line, decrement stock, log the ISSUE movement.
  for (const l of clean) {
    const item = byId.get(l.stock_item_id);
    const newQty = Number(item.qty_on_hand) - l.qty;

    await supabase.from("stock_issue_lines").insert({
      stock_issue_id: issue.id, stock_item_id: l.stock_item_id, qty_issued: l.qty,
    });
    await supabase.from("stock_items").update({ qty_on_hand: newQty }).eq("id", l.stock_item_id);
    await logMovement({
      stockItemId: l.stock_item_id, type: "ISSUE", qty: -l.qty, balanceAfter: newQty,
      ticketId, stockIssueId: issue.id, actorId: issuedBy,
      note: `Issued for ticket`,
    });
    item.qty_on_hand = newQty; // keep local copy correct if same item appears twice
  }

  log.info(`Stock issued for ticket ${ticketId}: ${clean.length} line(s)`);
  return getStockIssuesForTicket(ticketId);
}

// All issues (with their lines + item names) for a ticket — powers the ticket view.
export async function getStockIssuesForTicket(ticketId) {
  const { data, error } = await supabase
    .from("stock_issues")
    .select("*, technician:users!stock_issues_technician_id_fkey(id,full_name), " +
            "lines:stock_issue_lines(*, item:stock_items(id,name,unit))")
    .eq("ticket_id", ticketId)
    .order("issued_at", { ascending: false });
  if (error) throw new Error("getStockIssuesForTicket: " + error.message);
  return data;
}
