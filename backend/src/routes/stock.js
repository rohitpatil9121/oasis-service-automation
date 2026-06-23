import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { listStockItems, createStockItem, updateStockItem, deactivateStockItem, reconcileStock } from "../services/stock.js";

const router = Router();
router.use(requireAuth);

// Inventory list.
router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json({ items: await listStockItems() }); }
  catch (e) { next(e); }
});

// Add an inventory item (minimal master-data entry).
router.post("/", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const item = await createStockItem(req.body || {}, req.user.id);
    res.status(201).json({ item });
  } catch (e) { next(e); }
});

// Edit an inventory item (name, sku, unit, qty, reorder level, price).
router.patch("/:id", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const item = await updateStockItem(req.params.id, req.body || {}, req.user.id);
    res.json({ item });
  } catch (e) { next(e); }
});

// Soft-remove an item (drops off inventory; movement history is kept).
router.delete("/:id", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    await deactivateStockItem(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Reconcile an issue: record used/returned per line; variance is flagged.
router.post("/issues/:id/reconcile", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const result = await reconcileStock({
      stockIssueId: req.params.id, lines: req.body?.lines, actorId: req.user.id,
    });
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
