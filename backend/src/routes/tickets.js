import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import * as tickets from "../services/tickets.js";
import { assignTechnician } from "../services/assignment.js";

const router = Router();
router.use(requireAuth);

const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "CLOSED", "CANCELLED"];

// List / inbox (manager + owner). Optional ?status= filter.
router.get("/", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    res.json({ tickets: await tickets.listTickets({ status: req.query.status }) });
  } catch (e) { next(e); }
});

router.get("/:id", requireRole("owner", "manager", "technician"), async (req, res, next) => {
  try { res.json({ ticket: await tickets.getTicket(req.params.id) }); }
  catch (e) { next(e); }
});

router.get("/:id/history", requireRole("owner", "manager", "technician"), async (req, res, next) => {
  try { res.json(await tickets.getTicketHistory(req.params.id)); }
  catch (e) { next(e); }
});

// Manual ticket creation from the panel.
router.post("/", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { full_name, phone, address, issue_description } = req.body || {};
    if (!full_name || !phone || !issue_description)
      return res.status(400).json({ error: "full_name, phone, issue_description required" });
    const ticket = await tickets.createTicket({
      customer: { full_name, phone, address },
      issue_description, source: "manual", created_by: req.user.id,
    });
    res.status(201).json({ ticket });
  } catch (e) { next(e); }
});

// Assign a technician.
router.post("/:id/assign", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { technician_id, note } = req.body || {};
    if (!technician_id) return res.status(400).json({ error: "technician_id required" });
    const ticket = await assignTechnician({
      ticketId: req.params.id, technicianId: technician_id,
      assignedBy: req.user.id, note,
    });
    res.json({ ticket });
  } catch (e) { next(e); }
});

// Change status.
router.patch("/:id/status", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!STATUSES.includes(status))
      return res.status(400).json({ error: "invalid status", allowed: STATUSES });
    res.json({ ticket: await tickets.updateStatus(req.params.id, status, req.user.id) });
  } catch (e) { next(e); }
});

export default router;
