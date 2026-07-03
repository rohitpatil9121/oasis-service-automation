import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { customerRequestReceived, managerNewRequest, visitScheduledTechnician, visitScheduledCustomer, requestCancelledCustomer, requestCompletedCustomer, serviceLine } from "./waTemplates.js";
import { normalizePhone, isValidPhone } from "../lib/phone.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

const TICKET_SELECT =
  "*, customer:customers(*), technician:users!tickets_assigned_technician_id_fkey(id,full_name,phone)";

// How long after a request is raised we treat further messages from the SAME
// customer as that same request — so we fold them onto the existing ticket
// instead of opening a duplicate. A recently CLOSED request the customer
// follows up on within this window is reused (and reopened) rather than
// duplicated. Both intake paths (deterministic + AI) share this window.
export const TICKET_REUSE_DAYS = 7;

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

// The brands/partners a manual request can be attributed to. Kept in sync with
// the dropdown in NewTicketModal / EditCustomerModal.
export const LEAD_SOURCES = ["our service team", "KENT"];

// How a request reached us. Set automatically at creation (WhatsApp intake vs.
// manual entry) but correctable from the edit modal.
export const TICKET_SOURCES = ["whatsapp", "manual"];

// Service Manager corrects how a request came in (WhatsApp / manual entry).
export async function updateSource({ ticketId, source }) {
  if (source == null) return; // not being changed
  const val = String(source).trim();
  if (!TICKET_SOURCES.includes(val)) { const e = new Error("Invalid source"); e.status = 400; throw e; }
  const { error } = await supabase
    .from("tickets").update({ source: val }).eq("id", ticketId);
  if (error) throw new Error("updateSource: " + error.message);
  log.info(`Source set to "${val}" for ticket ${ticketId}`);
}

// Service Manager corrects the lead source (which brand/partner the request came
// through) on an existing ticket — e.g. after creating it with the wrong one.
export async function updateLeadSource({ ticketId, lead_source }) {
  if (lead_source == null) return; // not being changed
  const val = String(lead_source).trim();
  if (!LEAD_SOURCES.includes(val)) { const e = new Error("Invalid lead source"); e.status = 400; throw e; }
  const { error } = await supabase
    .from("tickets").update({ lead_source: val }).eq("id", ticketId);
  if (error) throw new Error("updateLeadSource: " + error.message);
  log.info(`Lead source set to "${val}" for ticket ${ticketId}`);
}

// Service Manager sets/corrects the purifier brand/model on a ticket. Free text —
// manual requests don't capture it at creation, and AI intake only fills it when
// the customer happens to mention it. Blank clears it.
export async function updateAppliance({ ticketId, appliance }) {
  if (appliance === undefined) return; // key absent → not being changed
  const val = String(appliance || "").trim() || null;
  const { error } = await supabase
    .from("tickets").update({ appliance: val }).eq("id", ticketId);
  if (error) throw new Error("updateAppliance: " + error.message);
  log.info(`Appliance set to "${val || "—"}" for ticket ${ticketId}`);
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

// Has the customer messaged us within `ms`? WhatsApp only delivers free-form
// text and interactive (button) messages inside the 24-hour service window;
// outside it we must fall back to an approved template.
async function customerMessagedWithin(phone, ms) {
  if (!phone) return false;
  const { data } = await supabase
    .from("wa_inbound").select("created_at").eq("from_phone", phone)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return !!data && Date.now() - new Date(data.created_at).getTime() < ms;
}

async function getManagerRecipients() {
  const { data } = await supabase
    .from("users").select("phone")
    .eq("role", "manager").eq("is_active", true);
  const phones = new Set((data || []).map((u) => u.phone));
  if (env.managerWhatsapp) phones.add(env.managerWhatsapp);
  return [...phones];
}

export async function createTicket({ customer, issue_description, source = "whatsapp", lead_source = null, created_by = null }) {
  const cust = customer.id ? customer : await upsertCustomer(customer);
  const { data: ticket, error } = await supabase
    .from("tickets")
    .insert({ customer_id: cust.id, issue_description, source, lead_source, created_by, status: "NEW" })
    .select("*").single();
  if (error) throw new Error("createTicket: " + error.message);

  await logEvent(ticket.id, "created", { to_status: "NEW", actor_id: created_by,
    meta: { source, lead_source } });

  // 1) Confirmation to the customer. Sent as an approved TEMPLATE: a manually-
  // created request means the customer hasn't messaged us, so we're outside the
  // 24-hour window and free-form text would silently fail. The template opens
  // the chat; {{2}} carries the lead source (KENT / our service team).
  const custTpl = customerRequestReceived({
    customerName: cust.full_name, source: lead_source || "our service team",
    ticketNumber: ticket.ticket_number, issue: issue_description, address: cust.address,
  });
  await queueNotification({
    recipient: cust.phone, audience: "customer", ticketId: ticket.id,
    body: custTpl.body, template: custTpl.template,
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

// Patch the issue / appliance / notes as the agent collects them. `notes` is the
// customer's extra info (timings, access instructions, etc.); the agent passes the
// full combined notes, so we overwrite — same as issue.
export async function updateTicketIntake(ticketId, { issue, appliance, notes } = {}) {
  const patch = {};
  if (issue) patch.issue_description = issue;
  if (appliance) patch.appliance = appliance;
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("tickets").update(patch).eq("id", ticketId);
    if (error) log.error("updateTicketIntake:", error.message);
  }
  // `notes` sits behind an optional migration (phase6_notes.sql). Update it in a
  // SEPARATE statement and swallow the error, so a not-yet-added notes column can
  // NEVER block the core issue/appliance save (which would break intake).
  if (notes) {
    const { error } = await supabase.from("tickets").update({ notes }).eq("id", ticketId);
    if (error) log.error("updateTicketIntake notes (run phase6_notes.sql?):", error.message);
  }
}

// Required fields all in → mark complete and alert managers.
// Customer confirmation is NOT sent here — the caller (aiIntake.js) sends a
// single consolidated reply so the customer doesn't get duplicate messages.
export async function completeIntake(ticketId) {
  const ticket = await getTicket(ticketId);
  // A CLOSED ticket completing intake again means the customer re-engaged within
  // the reuse window (getReusableTicketForCustomer folded the new request back
  // onto it). Reopen it so it returns to the active board, and alert managers.
  const reopened = ticket.status === "CLOSED";
  // Already finished AND still open → nothing to do (avoids duplicate alerts).
  // Flag it so callers don't re-send the customer confirmation either (that's
  // what produced repeated "your request is logged" messages across days).
  if (ticket.intake_complete && !reopened) return { ...ticket, alreadyComplete: true };

  const patch = { intake_complete: true };
  if (reopened) patch.status = "NEW";
  await supabase.from("tickets").update(patch).eq("id", ticketId);
  if (reopened) {
    await logEvent(ticketId, "status_changed", {
      from_status: "CLOSED", to_status: "NEW", meta: { reopened: "reuse_window" },
    });
    log.info(`Ticket ${ticket.ticket_number} reopened — customer re-engaged within ${TICKET_REUSE_DAYS}d`);
  }

  const managers = await getManagerRecipients();
  const mgrTpl = managerNewRequest({
    ticketNumber: ticket.ticket_number, customerName: ticket.customer.full_name,
    customerPhone: ticket.customer.phone, address: ticket.customer.address, issue: ticket.issue_description,
  });
  for (const phone of managers) {
    await queueNotification({ recipient: phone, audience: "manager", ticketId, body: mgrTpl.body, template: mgrTpl.template });
  }
  log.info(`Intake complete for ${ticket.ticket_number}`);
  return { ...ticket, intake_complete: true, status: reopened ? "NEW" : ticket.status, alreadyComplete: false };
}

// All customers for the Clients page.
export async function listCustomers() {
  const { data, error } = await supabase
    .from("customers").select("id, full_name, phone, address, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error("listCustomers: " + error.message);
  return data;
}

// One client + their full request history (powers the client detail page).
export async function getCustomerWithHistory(id) {
  const { data: customer, error } = await supabase
    .from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("getCustomer: " + error.message);
  if (!customer) return null;

  const { data: tickets } = await supabase
    .from("tickets")
    .select("id, ticket_number, issue_description, status, appliance, rating, created_at, " +
            "technician:users!tickets_assigned_technician_id_fkey(id,full_name)")
    .eq("customer_id", id)
    .order("created_at", { ascending: false });

  return { customer, tickets: tickets || [] };
}

export async function listTickets({ status } = {}) {
  let q = supabase
    .from("tickets")
    .select("*, customer:customers(*), technician:users!tickets_assigned_technician_id_fkey(id,full_name,phone)")
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error("listTickets: " + error.message);

  // Attach the latest inbound (customer) message time per ticket so the dashboard
  // can show an "unread" badge + sound alert when a customer sends a new message.
  const { data: inbound } = await supabase
    .from("wa_inbound").select("from_phone, created_at")
    .order("created_at", { ascending: false }).limit(3000);
  const latestByPhone = new Map();
  for (const m of inbound || []) {
    if (!latestByPhone.has(m.from_phone)) latestByPhone.set(m.from_phone, m.created_at);
  }
  for (const t of data) {
    t.last_inbound_at = t.customer?.phone ? latestByPhone.get(t.customer.phone) || null : null;
  }
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

// The existing ticket a new inbound should fold into, or null to start fresh.
// Live intake reuses this so a customer doesn't spawn duplicate tickets:
//   • still-open request (not closed/cancelled)        → always reuse
//   • CLOSED request raised within TICKET_REUSE_DAYS    → reuse (will reopen)
//   • CANCELLED, or CLOSED & older than the window      → null (genuinely new)
// We look at only the single latest ticket: cancelling is a deliberate end, so
// a later message is a real new request; a closed one is reused only while the
// reuse window is still open.
export async function getReusableTicketForCustomer(customerId) {
  const { data } = await supabase
    .from("tickets").select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (!data) return null;
  if (data.status === "CANCELLED") return null; // deliberate end → new request
  if (data.status !== "CLOSED") return data;    // still open → always reuse
  const withinWindow =
    Date.now() - new Date(data.created_at).getTime() < TICKET_REUSE_DAYS * 86400000;
  return withinWindow ? data : null;            // recent close → reuse, else new
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

// The customer's current OPEN ticket (anything not closed/cancelled), most
// recent first — used by intake to fold new messages into an existing request
// instead of creating a duplicate. Returns null if they have none open.
export async function getOpenTicketForCustomer(customerId) {
  if (!customerId) return null;
  const { data } = await supabase
    .from("tickets")
    .select("*")
    .eq("customer_id", customerId)
    .not("status", "in", "(CLOSED,CANCELLED)")
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  return data || null;
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

// A customer reported a fresh problem on an existing request (e.g. the machine
// stopped again after the visit). Keep the bot's "we'll forward this" promise:
// reopen a closed request onto the active board, log it, and alert the
// manager(s) — deduped so a burst of follow-up lines doesn't spam them.
export async function escalateFollowUp({ ticketId, customerMessage }) {
  const ticket = await getTicket(ticketId);
  const reopened = ticket.status === "CLOSED";

  // Reopen a closed request so it returns to the active board.
  if (reopened) {
    await supabase.from("tickets").update({ status: "NEW" }).eq("id", ticketId);
    await logEvent(ticketId, "status_changed", {
      from_status: "CLOSED", to_status: "NEW", meta: { reopened: "customer_follow_up" },
    });
  }

  // Don't re-alert managers for every line of a back-and-forth: skip if we
  // already escalated this ticket in the last 6 hours (a reopen always alerts).
  let alreadyAlerted = false;
  if (!reopened) {
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const { data } = await supabase.from("ticket_events")
      .select("id").eq("ticket_id", ticketId).eq("event_type", "follow_up")
      .gte("created_at", since).limit(1);
    alreadyAlerted = !!(data && data.length);
  }

  // Audit (best-effort — event_type may be constrained in some schemas).
  try {
    await logEvent(ticketId, "follow_up", { meta: { message: String(customerMessage || "").slice(0, 500) } });
  } catch (e) { log.error("follow_up event:", e.message); }

  // Reuse the approved manager template so the alert delivers even when the
  // manager is outside WhatsApp's 24-hour window; the follow-up note rides in
  // the "issue" slot.
  if (reopened || !alreadyAlerted) {
    const managers = await getManagerRecipients();
    const tpl = managerNewRequest({
      ticketNumber: ticket.ticket_number,
      customerName: ticket.customer.full_name,
      customerPhone: ticket.customer.phone,
      address: ticket.customer.address,
      issue: `Follow-up: ${String(customerMessage || "").trim()}`,
    });
    for (const phone of managers) {
      await queueNotification({
        recipient: phone, audience: "manager", ticketId,
        body: tpl.body, template: tpl.template,
      });
    }
  }
  log.info(`Follow-up escalated for ${ticket.ticket_number}${reopened ? " (reopened)" : ""}`);
  return { reopened };
}

export async function updateStatus(id, toStatus, actorId, reason) {
  const current = await getTicket(id);

  // Cancelling requires a reason, which we relay to the customer.
  if (toStatus === "CANCELLED") {
    reason = String(reason || "").trim();
    if (!reason) { const e = new Error("A cancellation reason is required"); e.status = 400; throw e; }
  }

  const { data, error } = await supabase
    .from("tickets").update({ status: toStatus }).eq("id", id).select().single();
  if (error) throw new Error("updateStatus: " + error.message);
  await logEvent(id, "status_changed", {
    from_status: current.status, to_status: toStatus, actor_id: actorId,
    ...(toStatus === "CANCELLED" ? { meta: { reason } } : {}),
  });

  // Let the customer know their request was cancelled and why.
  if (toStatus === "CANCELLED" && current.customer?.phone) {
    const tpl = requestCancelledCustomer({
      ticketNumber: current.ticket_number, customerName: current.customer.full_name, reason,
    });
    await queueNotification({
      recipient: current.customer.phone, audience: "customer", ticketId: id,
      body: tpl.body, template: tpl.template,
    });
  }

  // Tell the customer their request is completed when the manager closes it.
  // Inside WhatsApp's 24-hour window we send a list message: a "Rate our service"
  // button opens a menu of 5 star options (★ to ★★★★★). Each row id encodes
  // ticket + score, attributed back on the webhook. Outside the window
  // interactive/free-form silently fails, so we fall back to an approved
  // template — the customer still reliably learns the job is done.
  if (toStatus === "CLOSED" && current.customer?.phone) {
    const within24h = await customerMessagedWithin(current.customer.phone, 24 * 3600 * 1000);
    if (within24h) {
      const body =
        `Your service request ${current.ticket_number} has been marked completed.\n\n` +
        serviceLine(current.issue_description) +
        `How was our service? Tap below to rate us.`;
      const row = (n) => ({ id: `rate_${id}_${n}`, title: "★".repeat(n), description: RATING_LABELS[n] });
      await queueNotification({
        recipient: current.customer.phone, audience: "customer", ticketId: id, body,
        interactive: {
          type: "list",
          body: { text: body },
          action: {
            button: "Rate our service",
            sections: [{ title: "Tap your rating", rows: [row(5), row(4), row(3), row(2), row(1)] }],
          },
        },
      });
    } else {
      const tpl = requestCompletedCustomer({
        ticketNumber: current.ticket_number,
        customerName: current.customer.full_name,
        issue: current.issue_description,
      });
      await queueNotification({
        recipient: current.customer.phone, audience: "customer", ticketId: id,
        body: tpl.body, template: tpl.template,
      });
    }
  }

  return data;
}

// Score → label, used both ways: when 3 buttons map to 1/3/5, and to read back
// any stored 1–5 rating (e.g. a typed reply) in messages and on the dashboard.
export const RATING_LABELS = { 1: "Poor", 2: "Fair", 3: "Okay", 4: "Good", 5: "Excellent" };

// The customer tapped a rating button after their request was closed. Store the
// 1–5 score on the ticket and log it. Re-tapping just overwrites the score.
export async function recordRating(ticketId, rating) {
  const n = Number(rating);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    const e = new Error("Rating must be a whole number from 1 to 5"); e.status = 400; throw e;
  }
  const { data: ticket, error } = await supabase
    .from("tickets").update({ rating: n, rated_at: new Date().toISOString() })
    .eq("id", ticketId).select("id, ticket_number").single();
  if (error) throw new Error("recordRating: " + error.message);
  // Audit is best-effort — never lose a rating because the event insert failed.
  try { await logEvent(ticketId, "rated", { meta: { rating: n } }); } catch (e) { log.error("rated event:", e.message); }
  log.info(`Ticket ${ticket.ticket_number} rated ${n}/5`);
  return ticket;
}
