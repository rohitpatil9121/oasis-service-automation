import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { listStockItems, createStockItem } from "../services/stock.js";

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

export default router;
