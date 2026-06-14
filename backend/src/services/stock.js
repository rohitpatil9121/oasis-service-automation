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

  // Reuse the ticket's OPEN (un-reconciled) issue if there is one, so issuing
  // stock again just adds to the SAME batch — one batch + one reconcile per job.
  // Only create a new header when no open batch exists.
  let { data: issue } = await supabase
    .from("stock_issues")
    .select("*, lines:stock_issue_lines(*)")
    .eq("ticket_id", ticketId).eq("status", "ISSUED")
    .order("issued_at", { ascending: true }).limit(1).maybeSingle();

  if (!issue) {
    const { data: created, error: issueErr } = await supabase
      .from("stock_issues")
      .insert({ ticket_id: ticketId, technician_id: technicianId || null, issued_by: issuedBy || null })
      .select("*").single();
    if (issueErr) throw new Error("issueStock header: " + issueErr.message);
    issue = { ...created, lines: [] };
  }

  // Existing lines keyed by item — re-issuing the same part bumps its quantity
  // instead of adding a duplicate line.
  const lineByItem = new Map((issue.lines || []).map((l) => [l.stock_item_id, l]));

  for (const l of clean) {
    const item = byId.get(l.stock_item_id);
    const newQty = Number(item.qty_on_hand) - l.qty;
    const existing = lineByItem.get(l.stock_item_id);

    if (existing) {
      const merged = Number(existing.qty_issued) + l.qty;
      await supabase.from("stock_issue_lines").update({ qty_issued: merged }).eq("id", existing.id);
      existing.qty_issued = merged;
    } else {
      const { data: newLine } = await supabase.from("stock_issue_lines")
        .insert({ stock_issue_id: issue.id, stock_item_id: l.stock_item_id, qty_issued: l.qty })
        .select().single();
      if (newLine) lineByItem.set(l.stock_item_id, newLine);
    }

    await supabase.from("stock_items").update({ qty_on_hand: newQty }).eq("id", l.stock_item_id);
    await logMovement({
      stockItemId: l.stock_item_id, type: "ISSUE", qty: -l.qty, balanceAfter: newQty,
      ticketId, stockIssueId: issue.id, actorId: issuedBy, note: "Issued for ticket",
    });
    item.qty_on_hand = newQty; // keep local copy correct if same item appears twice
  }

  log.info(`Stock issued for ticket ${ticketId}: ${clean.length} line(s)`);
  return getStockIssuesForTicket(ticketId);
}

// ---------- reconciliation (return) ----------

// After the visit, the manager reconciles an issue: for each line they record
// how much was USED on the job and how much is being RETURNED. Anything left
// over (issued − used − returned) is VARIANCE — unaccounted stock, flagged.
//
// Inventory effect: returned parts go back into qty_on_hand (RETURN movement).
// Used + variance stay deducted (they already left the store at ISSUE time);
// CONSUME and VARIANCE are logged as custody-clearing ledger entries so the
// full story of every issued part is traceable.
//   lines = [{ line_id, qty_used, qty_returned }]
export async function reconcileStock({ stockIssueId, lines, actorId }) {
  // Load the issue + its lines.
  const { data: issue, error: issErr } = await supabase
    .from("stock_issues")
    .select("*, lines:stock_issue_lines(*, item:stock_items(id,name,qty_on_hand))")
    .eq("id", stockIssueId).single();
  if (issErr || !issue) { const e = new Error("Stock issue not found"); e.status = 404; throw e; }
  if (issue.status === "RECONCILED") { const e = new Error("This issue is already reconciled"); e.status = 409; throw e; }

  const byId = new Map((lines || []).map((l) => [l.line_id, l]));

  // Validate everything before writing.
  for (const line of issue.lines) {
    const input = byId.get(line.id) || {};
    const used = Number(input.qty_used) || 0;
    const returned = Number(input.qty_returned) || 0;
    if (used < 0 || returned < 0) { const e = new Error("Quantities can't be negative"); e.status = 400; throw e; }
    if (used + returned > Number(line.qty_issued)) {
      const e = new Error(`"${line.item?.name}": used + returned (${used + returned}) exceeds issued (${line.qty_issued})`);
      e.status = 400; throw e;
    }
  }

  let totalVariance = 0;
  const variances = [];

  for (const line of issue.lines) {
    const input = byId.get(line.id) || {};
    const used = Number(input.qty_used) || 0;
    const returned = Number(input.qty_returned) || 0;
    const variance = Number(line.qty_issued) - used - returned;

    await supabase.from("stock_issue_lines")
      .update({ qty_used: used, qty_returned: returned }).eq("id", line.id);

    // Returned parts physically come back into the store.
    let balance = Number(line.item.qty_on_hand);
    if (returned > 0) {
      balance += returned;
      await supabase.from("stock_items").update({ qty_on_hand: balance }).eq("id", line.stock_item_id);
      await logMovement({
        stockItemId: line.stock_item_id, type: "RETURN", qty: returned, balanceAfter: balance,
        ticketId: issue.ticket_id, stockIssueId: issue.id, actorId, note: "Returned after visit",
      });
    }
    // Used on the job — consumed (warehouse already reflects it; ledger note).
    if (used > 0) {
      await logMovement({
        stockItemId: line.stock_item_id, type: "CONSUME", qty: -used, balanceAfter: balance,
        ticketId: issue.ticket_id, stockIssueId: issue.id, actorId, note: "Used on job",
      });
    }
    // Variance — neither used nor returned = unaccounted. Flag it.
    if (variance > 0) {
      totalVariance += variance;
      variances.push({ item: line.item?.name, qty: variance });
      await logMovement({
        stockItemId: line.stock_item_id, type: "VARIANCE", qty: -variance, balanceAfter: balance,
        ticketId: issue.ticket_id, stockIssueId: issue.id, actorId, note: "Unaccounted — flagged",
      });
    }
  }

  await supabase.from("stock_issues")
    .update({ status: "RECONCILED", reconciled_at: new Date().toISOString() })
    .eq("id", issue.id);

  if (totalVariance > 0) {
    log.warn(`⚠️ Stock variance on issue ${issue.id}: ${variances.map((v) => v.item + " x" + v.qty).join(", ")}`);
  }
  log.info(`Stock reconciled for issue ${issue.id} (variance ${totalVariance})`);
  return { issues: await getStockIssuesForTicket(issue.ticket_id), variance: totalVariance, variances };
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
