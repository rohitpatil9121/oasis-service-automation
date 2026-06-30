// Incentive report API — owner/manager only. Numbers are computed on demand
// from closed tickets by services/incentives.js (nothing is stored).
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { incentiveReport } from "../services/incentives.js";

const router = Router();
router.use(requireAuth, requireRole("owner", "manager"));

// Payout report across all technicians (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD).
router.get("/", async (req, res, next) => {
  try { res.json(await incentiveReport({ from: req.query.from, to: req.query.to })); }
  catch (e) { next(e); }
});

export default router;
