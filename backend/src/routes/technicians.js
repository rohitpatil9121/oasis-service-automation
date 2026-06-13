import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { listTechnicians } from "../services/assignment.js";

const router = Router();
router.use(requireAuth);

router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json({ technicians: await listTechnicians() }); }
  catch (e) { next(e); }
});

export default router;
