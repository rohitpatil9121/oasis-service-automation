import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { listCustomers, getCustomerWithHistory } from "../services/tickets.js";

const router = Router();
router.use(requireAuth);

router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json({ customers: await listCustomers() }); }
  catch (e) { next(e); }
});

router.get("/:id", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const data = await getCustomerWithHistory(req.params.id);
    if (!data) return res.status(404).json({ error: "Client not found" });
    res.json(data);
  } catch (e) { next(e); }
});

export default router;
