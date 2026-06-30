// Technician App API — all routes scoped to the logged-in technician.
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import * as tech from "../services/techJobs.js";

const router = Router();
router.use(requireAuth, requireRole("technician"));

// All my jobs (bucketed client-side by the `bucket` field).
router.get("/jobs", async (req, res, next) => {
  try { res.json({ jobs: await tech.listMyJobs(req.user.id) }); }
  catch (e) { next(e); }
});

router.get("/jobs/:id", async (req, res, next) => {
  try { res.json({ job: await tech.getMyJob(req.user.id, req.params.id) }); }
  catch (e) { next(e); }
});

// Advance one workflow step: { action, work }.
router.post("/jobs/:id/step", async (req, res, next) => {
  try {
    const { action, work } = req.body || {};
    if (!action) return res.status(400).json({ error: "action required" });
    res.json({ job: await tech.runStep(req.user.id, req.params.id, action, work || {}) });
  } catch (e) { next(e); }
});

router.get("/parts", async (req, res, next) => {
  try { res.json({ parts: await tech.listParts() }); }
  catch (e) { next(e); }
});

router.get("/reviews", async (req, res, next) => {
  try { res.json({ reviews: await tech.getMyReviews(req.user.id) }); }
  catch (e) { next(e); }
});

router.patch("/availability", async (req, res, next) => {
  try { res.json(await tech.setOnline(req.user.id, req.body?.is_online)); }
  catch (e) { next(e); }
});

// Register this device's FCM token for push notifications.
router.post("/push-token", async (req, res, next) => {
  try { res.json(await tech.savePushToken(req.user.id, req.body?.token)); }
  catch (e) { next(e); }
});

export default router;
