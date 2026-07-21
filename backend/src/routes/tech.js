// Technician App API — all routes scoped to the logged-in technician.
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import * as tech from "../services/techJobs.js";
import { technicianEarnings, todayProgress } from "../services/incentives.js";

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
    const { action, work, client_id } = req.body || {};
    if (!action) return res.status(400).json({ error: "action required" });
    res.json({ job: await tech.runStep(req.user.id, req.params.id, action, work || {}, client_id) });
  } catch (e) { next(e); }
});

// Technician captures a job photo (base64 data URL in body.image).
router.post("/jobs/:id/photo", async (req, res, next) => {
  try { res.json(await tech.saveJobPhoto(req.user.id, req.params.id, req.body?.image, req.body?.client_id)); }
  catch (e) { next(e); }
});

// "Reached" → send the arrival OTP to the customer on WhatsApp.
router.post("/jobs/:id/arrival-otp", async (req, res, next) => {
  try { res.json(await tech.sendArrivalOtp(req.user.id, req.params.id)); }
  catch (e) { next(e); }
});

// Verify the arrival OTP the customer shared → status ARRIVED.
router.post("/jobs/:id/verify-arrival", async (req, res, next) => {
  try { res.json(await tech.verifyArrivalOtp(req.user.id, req.params.id, req.body?.code, req.body?.client_id)); }
  catch (e) { next(e); }
});

router.get("/parts", async (req, res, next) => {
  try { res.json({ parts: await tech.listParts() }); }
  catch (e) { next(e); }
});

router.get("/reviews", async (req, res, next) => {
  try { res.json({ reviews: await tech.getMyReviews(req.user.id) }); }
  catch (e) { next(e); }
});

// My incentive earnings (optional ?from=YYYY-MM-DD&to=YYYY-MM-DD, IST dates).
router.get("/earnings", async (req, res, next) => {
  try { res.json(await technicianEarnings(req.user.id, { from: req.query.from, to: req.query.to })); }
  catch (e) { next(e); }
});

// Today's live progress toward the 10k bonus target (for the progress bar).
router.get("/earnings/today", async (req, res, next) => {
  try { res.json(await todayProgress(req.user.id)); }
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

// Stream the technician's live GPS location.
router.post("/location", async (req, res, next) => {
  try { res.json(await tech.saveLocation(req.user.id, req.body?.lat, req.body?.lng)); }
  catch (e) { next(e); }
});

export default router;
