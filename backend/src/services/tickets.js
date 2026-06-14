import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { managerNewRequest, visitScheduledTechnician, visitScheduledCustomer } from "./waTemplates.js";
import { normalizePhone, isValidPhone } from "../lib/phone.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

const TICKET_SELECT =
  "*, customer:customers(*), technician:users!tickets_assigned_technician_id_fkey(id,full_name,phone)";

// Human-readable slot for notifications, e.g. "14 Jun 2026, 9:00 am – 11:00 am" (IST).
function formatSlot(startISO, endISO) {
  const tz = "Asia/Kolkata";
  const start = new Date(startISO).toLocaleString("en-IN", {
    timeZone: tz, day: "2-digit", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  });
  if (!endISO) return start;
  const end = new Date(endISO).toLocaleTimeString("en-IN", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  });
  return `${start} – ${end}`;
}

export async function upsertCustomer({ full_name, phone, address }) {
  const { data: existing } = await supabase
    .from("customers").select("*").eq("phone", phone).maybeSingle();
  if (existing) {
    const { data } = await supabase.from("customers")
      .update({ full_name, address }).eq("id", existing.id).select().single();
    return data;
  }
  const { data, error } = await supabase
    .from("customers").insert({ full_name, phone, address }).select().single();
  if (error) throw new Error("customer upsert: " + error.message);
  return data;
}

// Service Manager edits the customer's details (e.g. after confirming on chat).
export async function updateCustomer({ customerId, full_name, phone, address }) {
  const name = (full_name || "").trim();
  if (!name) { const e = new Error("Customer name is required"); e.status = 400; throw e; }

  const patch = { full_name: name, address: (address || "").trim() || null };

  // Phone is the WhatsApp identity — only change it when given, validate, and
  // make sure it doesn't collide with another customer.
  if (phone != null && String(phone).trim()) {
    if (!isValidPhone(phone)) { const e = new Error("Enter a valid phone number"); e.status = 400; throw e; }
    const norm = normalizePhone(phone);
    const { data: clash } = await supabase
      .from("customers").select("id").eq("phone", norm).neq("id", customerId).maybeSingle();
    if (clash) { const e = new Error("Another customer already uses this phone number"); e.status = 409; throw e; }
    patch.phone = norm;
  }

  const { data, error } = await supabase
    .from("customers").update(patch).eq("id", customerId).select().single();
  if (error) throw new Error("updateCustomer: " + error.message);
  log.info(`Customer ${customerId} updated`);
  return data;
}

// Edit the ticket's issue description (e.g. after clarifying with the customer).
export async function updateIssue({ ticketId, issue_description, actorId }) {
  const desc = (issue_description || "").trim();
  if (!desc) { const e = new Error("Issue description can't be empty"); e.status = 400; throw e; }
  const { data, error } = await supabase
    .from("tickets").update({ issue_description: desc }).eq("id", ticketId).select(TICKET_SELECT).single();
  if (error) throw new Error("updateIssue: " + error.message);
  await logEvent(ticketId, "issue_updated", { actor_id: actorId });
  log.info(`Issue updated for ticket ${ticketId}`);
  return data;
}

async function logEvent(ticketId, type, extra = {}) {
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId, event_type: type, ...extra,
  });
}

async function getManagerRecipients() {
  const { data } = await supabase
    .from("users").select("phone")
    .eq("role", "manager").eq("is_active", true);
  const phones = new Set((data || []).map((u) => u.phone));
  if (env.managerWhatsapp) phones.add(env.managerWhatsapp);
  return [...phones];
}

export async function createTicket({ customer, issue_description, source = "whatsapp", created_by = null }) {
  const cust = customer.id ? customer : await upsertCustomer(customer);
  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({ customer_id: cust.id, issue_description, source, created_by, status: "NEW" })
    .select("*").single();
  if (error) throw new Error("createTicket: " + error.message);

  await logEvent(ticket.id, "created", { to_status: "NEW", actor_id: created_by,
    meta: { source } });

  // 1) Confirmation to the customer.
  await queueNotification({
    recipient: cust.phone, audience: "customer", ticketId: ticket.id,
    body: `✅ Thanks ${cust.full_name}! Your request is logged.\n` +
          `Ticket: *${ticket.ticket_number}*\n` +
          `Issue: ${issue_description}\n` +
          `Our team will assign a technician shortly.`,
  });
  // 2) Alert the Service Manager(s). Managers rarely have an open 24-hour
  const managers = await getManagerRecipients();
  const mgrTpl = managerNewRequest({
    ticketNumber: ticket.ticket_number, customerName: cust.full_name,
    customerPhone: cust.phone, address: cust.address, issue: issue_description,
  });
  for (const phone of managers) {
    await queueNotification({
      recipient: phone, audience: "manager", ticketId: ticket.id,
      body: mgrTpl.body, template: mgrTpl.template,
    });
  }
  log.info(`Ticket ${ticket.ticket_number} created for ${cust.phone}`);
  return { ...ticket, customer: cust };
}

// ---------- live WhatsApp intake ----------
// A request shows on the dashboard from the customer's first message and fills
// in as details arrive. createDraftTicket starts it; updateTicketIntake/
// upsertCustomerByPhone patch it each turn; completeIntake finishes it.

// Create/patch a customer by phone with only the fields we have so far.
export async function upsertCustomerByPhone(phone, { full_name, address } = {}) {
  const { data: existing } = await supabase
    .from("customers").select("*").eq("phone", phone).maybeSingle();
  if (existing) {
    const patch = {};
    if (full_name && full_name !== existing.full_name) patch.full_name = full_name;
    if (address && address !== existing.address) patch.address = address;
    if (!Object.keys(patch).length) return existing;
    const { data } = await supabase.from("customers").update(patch).eq("id", existing.id).select().single();
    return data;
  }
  const { data, error } = await supabase
    .from("customers").insert({ phone, full_name: full_name || "", address: address || null }).select().single();
  if (error) throw new Error("upsertCustomerByPhone: " + error.message);
  return data;
}

// Early "draft" ticket — appears on the dashboard immediately, no alerts yet.
export async function createDraftTicket({ customerId, source = "whatsapp" }) {
  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({ customer_id: customerId, issue_description: "", status: "NEW", intake_complete: false, source })
    .select("*").single();
  if (error) throw new Error("createDraftTicket: " + error.message);
  await logEvent(ticket.id, "created", { to_status: "NEW", meta: { source, draft: true } });
  return ticket;
}

// Patch the issue / appliance as the agent collects them.
export async function updateTicketIntake(ticketId, { issue, appliance } = {}) {
  const patch = {};
  if (issue) patch.issue_description = issue;
  if (appliance) patch.appliance = appliance;
  if (!Object.keys(patch).length) return;
  await supabase.from("tickets").update(patch).eq("id", ticketId);
}

// Required fields all in → mark complete and fire the one-time alerts.
export async function completeIntake(ticketId) {
  const ticket = await getTicket(ticketId);
  if (ticket.intake_complete) return ticket;
  await supabase.from("tickets").update({ intake_complete: true }).eq("id", ticketId);

  await queueNotification({
    recipient: ticket.customer.phone, audience: "customer", ticketId,
    body: `✅ Thanks ${ticket.customer.full_name}! Your request is logged.\n` +
          `Ticket: *${ticket.ticket_number}*\nIssue: ${ticket.issue_description}\n` +
          `Our team will assign a technician shortly.`,
  });

  const managers = await getManagerRecipients();
  const mgrTpl = managerNewRequest({
    ticketNumber: ticket.ticket_number, customerName: ticket.customer.full_name,
    customerPhone: ticket.customer.phone, address: ticket.customer.address, issue: ticket.issue_description,
  });
  for (const phone of managers) {
    await queueNotification({ recipient: phone, audience: "manager", ticketId, body: mgrTpl.body, template: mgrTpl.template });
  }
  log.info(`Intake complete for ${ticket.ticket_number}`);
  return { ...ticket, intake_complete: true };
}

export async function listTickets({ status } = {}) {
  let q = supabase
    .from("tickets")
    .select("*, customer:customers(*), technician:users!tickets_assigned_technician_id_fkey(id,full_name,phone)")
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error("listTickets: " + error.message);
  return data;
}

export async function getTicket(id) {
  const { data, error } = await supabase
    .from("tickets")
    .select("*, customer:customers(*), technician:users!tickets_assigned_technician_id_fkey(id,full_name,phone)")
    .eq("id", id).single();
  if (error) throw new Error("getTicket: " + error.message);
  return data;
}

export async function getTicketHistory(id) {
  const { data: events } = await supabase
    .from("ticket_events").select("*, actor:users(id,full_name,role)")
    .eq("ticket_id", id).order("created_at", { ascending: true });
  const { data: assignments } = await supabase
    .from("assignments")
    .select("*, technician:users!assignments_technician_id_fkey(id,full_name,phone), assigner:users!assignments_assigned_by_fkey(id,full_name)")
    .eq("ticket_id", id).order("assigned_at", { ascending: true });
  return { events: events || [], assignments: assignments || [] };
}

// Latest ticket for a WhatsApp number - powers the customer "status" command.
export async function getLatestTicketByCustomerPhone(phone) {
  const { data: cust } = await supabase
    .from("customers").select("id").eq("phone", phone).maybeSingle();
  if (!cust) return null;
  const { data } = await supabase
    .from("tickets")
    .select("*, technician:users!tickets_assigned_technician_id_fkey(id,full_name)")
    .eq("customer_id", cust.id)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  return data;
}

// Service Manager sets (or changes) the visit slot. Notifies the assigned
// technician (where + when to go) and the customer. Used for both schedule and
// reschedule — the only difference is the audit event type + message wording.
export async function scheduleVisit({ ticketId, start, end, actorId }) {
  if (!start) { const e = new Error("Pick a date and start time"); e.status = 400; throw e; }
  const startISO = new Date(start).toISOString();
  const endISO = end ? new Date(end).toISOString() : null;
  if (Number.isNaN(Date.parse(startISO))) { const e = new Error("Invalid start time"); e.status = 400; throw e; }
  if (endISO && endISO <= startISO) { const e = new Error("End time must be after the start time"); e.status = 400; throw e; }

  const current = await getTicket(ticketId);
  const rescheduling = !!current.scheduled_start;

  const { data: ticket, error } = await supabase
    .from("tickets").update({ scheduled_start: startISO, scheduled_end: endISO })
    .eq("id", ticketId).select(TICKET_SELECT).single();
  if (error) throw new Error("scheduleVisit: " + error.message);

  // Audit (non-fatal — logEvent swallows errors if the event_type isn't allowed).
  await logEvent(ticketId, rescheduling ? "rescheduled" : "scheduled", {
    actor_id: actorId, meta: { scheduled_start: startISO, scheduled_end: endISO },
  });

  const when = formatSlot(startISO, endISO);

  // Technician: where + when to go (template so it delivers outside the 24h window).
  if (ticket.technician?.phone) {
    const tpl = visitScheduledTechnician({
      ticketNumber: ticket.ticket_number, customerName: ticket.customer.full_name,
      customerPhone: ticket.customer.phone, address: ticket.customer.address, when,
    });
    await queueNotification({
      recipient: ticket.technician.phone, audience: "technician", ticketId,
      body: tpl.body, template: tpl.template,
    });
  }

  // Customer: their confirmed slot.
  const ctpl = visitScheduledCustomer({
    ticketNumber: ticket.ticket_number, customerName: ticket.customer.full_name, when,
  });
  await queueNotification({
    recipient: ticket.customer.phone, audience: "customer", ticketId,
    body: ctpl.body, template: ctpl.template,
  });

  log.info(`Visit ${rescheduling ? "rescheduled" : "scheduled"} for ${ticket.ticket_number}: ${when}`);
  return ticket;
}

export async function updateStatus(id, toStatus, actorId) {
  const current = await getTicket(id);
  const { data, error } = await supabase
    .from("tickets").update({ status: toStatus }).eq("id", id).select().single();
  if (error) throw new Error("updateStatus: " + error.message);
  await logEvent(id, "status_changed", {
    from_status: current.status, to_status: toStatus, actor_id: actorId,
  });
  return data;
}
