import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { listTechnicians, createTechnician } from "../services/assignment.js";

const router = Router();
router.use(requireAuth);

router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json({ technicians: await listTechnicians() }); }
  catch (e) { next(e); }
});

// Add a technician from the manager panel.
router.post("/", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { full_name, phone, email } = req.body || {};
    const technician = await createTechnician({ full_name, phone, email });
    res.status(201).json({ technician });
  } catch (e) { next(e); }
});

export default router;
