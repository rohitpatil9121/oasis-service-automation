import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireRole } from "../middleware/rbac.js";
import * as tickets from "../services/tickets.js";
import { assignTechnician } from "../services/assignment.js";
import { getConversation, sendCustomerMessage, setCustomerBot } from "../services/conversation.js";

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

// Edit the issue description.
router.patch("/:id/issue", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const ticket = await tickets.updateIssue({
      ticketId: req.params.id, issue_description: req.body?.issue_description, actorId: req.user.id,
    });
    res.json({ ticket });
  } catch (e) { next(e); }
});

// Update the customer's details (name / phone / address) for this ticket.
router.patch("/:id/customer", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const ticket = await tickets.getTicket(req.params.id);
    const { full_name, phone, address } = req.body || {};
    await tickets.updateCustomer({ customerId: ticket.customer.id, full_name, phone, address });
    res.json({ ticket: await tickets.getTicket(req.params.id) });
  } catch (e) { next(e); }
});

// Customer WhatsApp conversation for this ticket.
router.get("/:id/conversation", requireRole("owner", "manager", "technician"), async (req, res, next) => {
  try { res.json(await getConversation(req.params.id)); }
  catch (e) { next(e); }
});

router.post("/:id/message", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const result = await sendCustomerMessage({ ticketId: req.params.id, body: req.body?.body, actorId: req.user.id });
    res.json(result);
  } catch (e) { next(e); }
});

// Toggle the AI bot on/off for this ticket's customer.
router.post("/:id/bot", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const ticket = await tickets.getTicket(req.params.id);
    res.json(await setCustomerBot(ticket.customer.id, !!req.body?.on));
  } catch (e) { next(e); }
});

// Schedule (or reschedule) the visit slot.
router.post("/:id/schedule", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { start, end } = req.body || {};
    const ticket = await tickets.scheduleVisit({
      ticketId: req.params.id, start, end, actorId: req.user.id,
    });
    res.json({ ticket });
  } catch (e) { next(e); }
});

// Change status.
router.patch("/:id/status", requireRole("owner", "manager"), async (req, res, next) => {
  try {
    const { status, reason } = req.body || {};
    if (!STATUSES.includes(status))
      return res.status(400).json({ error: "invalid status", allowed: STATUSES });
    res.json({ ticket: await tickets.updateStatus(req.params.id, status, req.user.id, reason) });
  } catch (e) { next(e); }
});

export default router;
