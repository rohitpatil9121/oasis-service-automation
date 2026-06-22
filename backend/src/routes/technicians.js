import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import { listTechnicians, createTechnician, getTechnicianById, deactivateTechnician } from "../services/assignment.js";
import { issueStock, getStockIssuesForTechnician } from "../services/stock.js";
import { getTechnicianConversation, sendTechnicianMessage } from "../services/conversation.js";

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

router.get("/:id", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const technician = await getTechnicianById(req.params.id);
    if (!technician) return res.status(404).json({ error: "Technician not found" });
    res.json({ technician });
  } catch (e) { next(e); }
});

// WhatsApp conversation with this technician (92 number).
router.get("/:id/conversation", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json(await getTechnicianConversation(req.params.id)); }
  catch (e) { next(e); }
});

router.post("/:id/message", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json(await sendTechnicianMessage({ technicianId: req.params.id, body: req.body?.body, replyTo: req.body?.replyTo })); }
  catch (e) { next(e); }
});

// Remove (deactivate) a technician.
router.delete("/:id", requireRole("owner", "manager"), async (req, res, next) => {
  try { await deactivateTechnician(req.params.id); res.json({ ok: true }); }
  catch (e) { next(e); }
});

// Bulk stock issued to this technician (and reconciled later).
router.get("/:id/stock-issues", requireRole("owner", "manager"), async (req, res, next) => {
  try { res.json({ issues: await getStockIssuesForTechnician(req.params.id) }); }
  catch (e) { next(e); }
});

router.post("/:id/stock-issue", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const issues = await issueStock({ technicianId: req.params.id, issuedBy: req.user.id, lines: req.body?.lines });
    res.status(201).json({ issues });
  } catch (e) { next(e); }
});

export default router;
