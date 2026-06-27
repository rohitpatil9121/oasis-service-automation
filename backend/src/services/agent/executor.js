// Executes the tools the model calls. Each tool is a thin wrapper over an
// EXISTING service function so the agent reuses the same DB writes, dashboard
// behaviour and notifications as the rest of the app. `ctx` is per-conversation
// state ({ phone, ticketId, customerId, submitted, ... }) — mutated as tools run
// so later tools in the same turn (and the next turn) target the same request.

import { supabase } from "../../config/supabase.js";
import { queueNotification } from "../notifications.js";
import {
  upsertCustomerByPhone, createDraftTicket, updateTicketIntake, completeIntake,
  getReusableTicketForCustomer, getLatestTicketByCustomerPhone, getTicket,
} from "../tickets.js";
import { requestCancelledCustomer } from "../waTemplates.js";
import { COMPANY_INFO } from "./knowledge.js";
import { env } from "../../config/env.js";
import { log } from "../../lib/logger.js";

const HANDOFF_WINDOW_MS = 12 * 60 * 60 * 1000; // pause the bot 12h on handoff
const isOpen = (status) => status && status !== "CLOSED" && status !== "CANCELLED";

// Ensure there's a draft/open ticket to attach details to. Reuses an existing
// open (or recently closed) request so the customer never spawns duplicates.
async function ensureTicket(ctx) {
  if (ctx.ticketId) return ctx.ticketId;
  const cust = await upsertCustomerByPhone(ctx.phone);
  ctx.customerId = cust.id;
  const reuse = await getReusableTicketForCustomer(cust.id);
  const ticket = reuse || (await createDraftTicket({ customerId: cust.id }));
  ctx.ticketId = ticket.id;
  ctx.existingRequest = !!reuse;
  return ticket.id;
}

async function identifyCustomer(ctx) {
  const { data: cust } = await supabase
    .from("customers").select("id, full_name, address").eq("phone", ctx.phone).maybeSingle();
  if (cust) ctx.customerId = cust.id;
  const latest = await getLatestTicketByCustomerPhone(ctx.phone);
  // Only a FINALISED request (intake_complete) counts as "already logged". A draft
  // is the in-progress request we're still collecting — don't surface it here, or
  // the model thinks intake is done and stops mid-conversation.
  const open = latest && isOpen(latest.status) && latest.intake_complete ? latest : null;
  return {
    known: !!(cust && cust.full_name),
    name: cust?.full_name || null,
    address: cust?.address || null,
    open_request: open
      ? { ticket_number: open.ticket_number, status: open.status, issue: open.issue_description || null }
      : null,
  };
}

async function saveCustomerDetails(ctx, { name, address } = {}) {
  const cust = await upsertCustomerByPhone(ctx.phone, { full_name: name, address });
  ctx.customerId = cust.id;
  return { ok: true, name: cust.full_name || null, address: cust.address || null };
}

async function createOrGetRequest(ctx) {
  await ensureTicket(ctx);
  const t = await getTicket(ctx.ticketId);
  return {
    ticket_number: t.ticket_number,
    status: t.status,
    already_existed: !!ctx.existingRequest,
    issue: t.issue_description || null,
  };
}

async function updateRequest(ctx, { issue, appliance, address } = {}) {
  if (address) await upsertCustomerByPhone(ctx.phone, { address });
  if (issue || appliance) {
    await ensureTicket(ctx);
    await updateTicketIntake(ctx.ticketId, { issue, appliance });
  }
  return { ok: true, saved: { issue: issue || null, appliance: appliance || null, address: address || null } };
}

async function submitRequest(ctx) {
  const { data: cust } = await supabase
    .from("customers").select("id, full_name, address").eq("phone", ctx.phone).maybeSingle();
  await ensureTicket(ctx);
  const t = await getTicket(ctx.ticketId);

  const missing = [];
  if (!cust?.full_name) missing.push("name");
  if (!cust?.address) missing.push("address");
  if (!t.issue_description) missing.push("issue");
  if (missing.length) return { ok: false, missing };

  const done = await completeIntake(ctx.ticketId); // marks complete + alerts managers
  ctx.submitted = true;
  // Canonical confirmation in the exact approved format — returned so the agent
  // sends it verbatim instead of composing its own wording.
  // Stash on ctx so run.js sends it VERBATIM as the final reply — the model is
  // unreliable at echoing multi-line text exactly, so we don't let it compose this.
  ctx.confirmation =
    `${cust.full_name}, your service request has been logged.\n\n` +
    `Ticket ID: ${done.ticket_number}\n` +
    `Service Issue: ${t.issue_description}\n` +
    `Address: ${cust.address}\n\n` +
    `We will assign a technician and update you here.`;
  return { ok: true, ticket_number: done.ticket_number };
}

// ---- Flow 2: status ----
const STATUS_SELECT =
  "ticket_number, status, issue_description, scheduled_start, intake_complete, " +
  "technician:users!tickets_assigned_technician_id_fkey(full_name)";

const shape = (t) => ({
  ticket_number: t.ticket_number,
  status: t.status,
  issue: t.issue_description || null,
  technician: t.technician?.full_name || null,
  scheduled: t.scheduled_start || null, // null = no visit time set; agent must not invent one
});

// ---- Flow 3: general knowledge / FAQ ----
// Returns the company KB. `pricing: null` (or any empty field) signals the agent
// to say "our team will confirm" rather than invent a value.
function getCompanyInfo(_ctx, { topic } = {}) {
  // FAQ turned off for now (FAQ_ENABLED=false): don't quote unverified company
  // facts — tell the model to deflect to the team. Re-enable by setting the flag.
  if (!env.faqEnabled) {
    return {
      disabled: true,
      instruction:
        "Company info is unavailable right now. Tell the customer our team will " +
        "confirm these details and get back to them shortly. Do NOT list any " +
        "services, brands, areas, timings, AMC, or prices.",
    };
  }
  return { topic: topic || null, info: COMPANY_INFO };
}

async function getMyRequests(ctx) {
  const { data: cust } = await supabase
    .from("customers").select("id").eq("phone", ctx.phone).maybeSingle();
  if (!cust) return { requests: [] };
  const { data } = await supabase
    .from("tickets").select(STATUS_SELECT)
    .eq("customer_id", cust.id)
    .order("created_at", { ascending: false })
    .limit(5);
  // Only finalised requests — a draft is an in-progress intake, not a "request".
  return { requests: (data || []).filter((t) => t.intake_complete).map(shape) };
}

async function getRequestStatus(ctx, { ticket_number } = {}) {
  const num = (ticket_number || "").trim();
  if (!num) return { found: false };
  const { data: t } = await supabase
    .from("tickets").select(STATUS_SELECT + ", customer:customers(phone)")
    .eq("ticket_number", num).maybeSingle();
  // Privacy: ticket numbers are guessable, so only reveal the customer's OWN ticket.
  if (!t || t.customer?.phone !== ctx.phone) return { found: false };
  return { found: true, ...shape(t) };
}

async function managerPhones() {
  const { data } = await supabase
    .from("users").select("phone").eq("role", "manager").eq("is_active", true);
  const set = new Set((data || []).map((u) => u.phone));
  if (env.managerWhatsapp) set.add(env.managerWhatsapp);
  return [...set];
}

// ---- Flow 4: complaint / follow-up ----
// Reliably gets a human involved: records a best-effort audit row, pauses the bot,
// and alerts managers with the ticket + details. (The customer's own message is
// already in wa_inbound, so it shows in the dashboard chat too.)
async function logComplaint(ctx, { ticket_number, details } = {}) {
  let ticket = null;
  const num = (ticket_number || "").trim();
  if (num) {
    const { data } = await supabase
      .from("tickets").select("id, ticket_number, status, customer:customers(phone)")
      .eq("ticket_number", num).maybeSingle();
    if (data && data.customer?.phone === ctx.phone) ticket = data; // own ticket only
  }
  if (!ticket) {
    const latest = await getLatestTicketByCustomerPhone(ctx.phone);
    if (latest) ticket = { id: latest.id, ticket_number: latest.ticket_number, status: latest.status };
  }

  // Reopen a CLOSED request so the recurring problem returns to the active board.
  let reopened = false;
  if (ticket && ticket.status === "CLOSED") {
    await supabase.from("tickets").update({ status: "NEW" }).eq("id", ticket.id);
    const { error } = await supabase.from("ticket_events").insert({
      ticket_id: ticket.id, event_type: "status_changed",
      from_status: "CLOSED", to_status: "NEW", meta: { reopened: "customer_follow_up" },
    });
    if (error) log.error("reopen audit row skipped:", error.message);
    reopened = true;
  }

  // Best-effort audit row — event_type is a constrained enum, so this may be
  // rejected. Don't fail the complaint over it; the manager alert below is the
  // reliable record.
  if (ticket) {
    const { error } = await supabase.from("ticket_events").insert({
      ticket_id: ticket.id, event_type: "complaint",
      meta: { details: details || null, via: "whatsapp_agent" },
    });
    if (error) log.error("complaint audit row skipped:", error.message);
  }

  await pauseBot(ctx.phone);
  const ref = ticket?.ticket_number ? ` (${ticket.ticket_number})` : "";
  for (const phone of await managerPhones()) {
    await queueNotification({
      recipient: phone, audience: "manager", ticketId: ticket?.id || null,
      body: `COMPLAINT from ${ctx.phone}${ref}${reopened ? " [reopened]" : ""}: ${details || "customer is unhappy with the service"}`,
    });
  }
  ctx.handedOff = true;
  return { ok: true, ticket_number: ticket?.ticket_number || null, reopened };
}

async function pauseBot(phone) {
  const { data: cust } = await supabase.from("customers").select("id").eq("phone", phone).maybeSingle();
  if (cust) {
    await supabase.from("customers")
      .update({ ai_paused_until: new Date(Date.now() + HANDOFF_WINDOW_MS).toISOString() })
      .eq("id", cust.id);
  }
}

// ---- Flow 5: reschedule / cancel ----
// Resolve the customer's OWN ticket — by number if given (ownership-checked), else
// their latest. Returns { id, ticket_number, status, customer:{full_name,phone} }.
async function findOwnTicket(ctx, ticket_number) {
  const sel = "id, ticket_number, status, customer:customers(full_name, phone)";
  const num = (ticket_number || "").trim();
  if (num) {
    const { data } = await supabase.from("tickets").select(sel).eq("ticket_number", num).maybeSingle();
    return data && data.customer?.phone === ctx.phone ? data : null;
  }
  const { data: cust } = await supabase.from("customers").select("id").eq("phone", ctx.phone).maybeSingle();
  if (!cust) return null;
  const { data } = await supabase.from("tickets").select(sel)
    .eq("customer_id", cust.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function requestCancellation(ctx, { ticket_number, reason } = {}) {
  const ticket = await findOwnTicket(ctx, ticket_number);
  if (!ticket) return { ok: false, not_found: true };
  if (!isOpen(ticket.status)) return { ok: false, already: ticket.status }; // CLOSED/CANCELLED
  const why = (reason || "").trim() || "Customer requested cancellation on WhatsApp";

  await supabase.from("tickets").update({ status: "CANCELLED" }).eq("id", ticket.id);
  // best-effort audit (event_type is a constrained enum — non-fatal)
  const { error } = await supabase.from("ticket_events").insert({
    ticket_id: ticket.id, event_type: "status_changed",
    from_status: ticket.status, to_status: "CANCELLED", meta: { reason: why },
  });
  if (error) log.error("cancel audit row skipped:", error.message);

  // Send the cancellation message verbatim (same wording as the approved template).
  ctx.confirmation = requestCancelledCustomer({
    ticketNumber: ticket.ticket_number, customerName: ticket.customer?.full_name || "", reason: why,
  }).body;
  return { ok: true, ticket_number: ticket.ticket_number };
}

async function requestReschedule(ctx, { ticket_number, preferred_time } = {}) {
  const ticket = await findOwnTicket(ctx, ticket_number);
  if (!ticket) return { ok: false, not_found: true };
  if (!isOpen(ticket.status)) return { ok: false, already: ticket.status };
  const when = (preferred_time || "").trim() || "as soon as possible";

  // Don't touch scheduled_start — that's the CONFIRMED slot the manager sets. We
  // only flag the customer's preference and alert the team to confirm it.
  const { error } = await supabase.from("ticket_events").insert({
    ticket_id: ticket.id, event_type: "note", meta: { reschedule_preferred: when, via: "whatsapp_agent" },
  });
  if (error) log.error("reschedule note skipped:", error.message);

  for (const phone of await managerPhones()) {
    await queueNotification({
      recipient: phone, audience: "manager", ticketId: ticket.id,
      body: `RESCHEDULE request for ${ticket.ticket_number} from ${ctx.phone}. Preferred: ${when}`,
    });
  }
  return { ok: true, ticket_number: ticket.ticket_number, preferred: when };
}

async function escalateToHuman(ctx, reason) {
  // Pause the bot for this customer so a manager can take over (same mechanism
  // the dashboard uses — see conversation.js ai_paused_until).
  await pauseBot(ctx.phone);
  for (const phone of await managerPhones()) {
    await queueNotification({
      recipient: phone, audience: "manager", ticketId: ctx.ticketId || null,
      body: `Handoff requested for ${ctx.phone}. Reason: ${reason || "customer asked for a person"}`,
    });
  }
  ctx.handedOff = true;
  return { ok: true };
}

export async function executeTool(name, args, ctx) {
  try {
    switch (name) {
      case "identify_customer":     return await identifyCustomer(ctx);
      case "save_customer_details": return await saveCustomerDetails(ctx, args);
      case "create_or_get_request": return await createOrGetRequest(ctx);
      case "update_request":        return await updateRequest(ctx, args);
      case "submit_request":        return await submitRequest(ctx);
      case "get_company_info":      return getCompanyInfo(ctx, args);
      case "get_my_requests":       return await getMyRequests(ctx);
      case "get_request_status":    return await getRequestStatus(ctx, args);
      case "log_complaint":         return await logComplaint(ctx, args);
      case "request_cancellation":  return await requestCancellation(ctx, args);
      case "request_reschedule":    return await requestReschedule(ctx, args);
      case "escalate_to_human":     return await escalateToHuman(ctx, args?.reason);
      default:                      return { error: `unknown tool: ${name}` };
    }
  } catch (e) {
    log.error(`tool ${name} failed:`, e.message);
    return { error: e.message };
  }
}
