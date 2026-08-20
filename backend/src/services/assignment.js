// Technician assignment. Phase 1 = simple manual assignment by the manager.
import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { serviceLine, customerTechnicianAssigned } from "./waTemplates.js";
import { sendPush } from "./push.js";
import { getTicket } from "./tickets.js";
import { normalizePhone, isValidPhone } from "../lib/phone.js";
import { log } from "../lib/logger.js";
import { mergeTechWork } from "../lib/techWork.js";
import { CUSTOMER_NOTIFY } from "../config/notify.js";

export async function listTechnicians() {
  const { data, error } = await supabase
    .from("users").select("id, full_name, phone, email, is_active, is_online, last_lat, last_lng, location_at")
    .eq("role", "technician").eq("is_active", true)
    .order("full_name");
  if (error) throw new Error("listTechnicians: " + error.message);
  return data;
}

export async function getTechnicianById(id) {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, phone, email, is_active, role, is_online, last_lat, last_lng, location_at")
    .eq("id", id).eq("role", "technician").maybeSingle();
  if (error) throw new Error("getTechnicianById: " + error.message);
  return data;
}

// Soft-remove: deactivate so they drop off the list and can't be assigned, but
// their history (assignments, stock) stays intact.
export async function deactivateTechnician(id) {
  const { data, error } = await supabase
    .from("users").update({ is_active: false })
    .eq("id", id).eq("role", "technician").select("id").maybeSingle();
  if (error) throw new Error("deactivateTechnician: " + error.message);
  if (!data) { const e = new Error("Technician not found"); e.status = 404; throw e; }
  return data;
}

export async function createTechnician({ full_name, phone, email }) {
  const name = (full_name || "").trim();
  if (!name) { const e = new Error("Full name is required"); e.status = 400; throw e; }
  if (!isValidPhone(phone)) {
    const e = new Error("A valid WhatsApp phone number is required"); e.status = 400; throw e;
  }
  const normPhone = normalizePhone(phone);

  const { data: existing } = await supabase
    .from("users").select("id, role, is_active").eq("phone", normPhone).maybeSingle();
  if (existing) {
    // A previously removed technician (soft-deleted) is reactivated and updated
    // rather than blocked — e.g. re-adding with a corrected name.
    if (existing.role === "technician" && !existing.is_active) {
      const { data: revived, error: reviveErr } = await supabase
        .from("users")
        .update({ full_name: name, email: (email || "").trim() || null, is_active: true })
        .eq("id", existing.id)
        .select("id, full_name, phone, email, is_active")
        .single();
      if (reviveErr) throw new Error("createTechnician(reactivate): " + reviveErr.message);
      log.info(`Technician reactivated: ${name} (${normPhone})`);
      return revived;
    }
    const e = new Error("A user with this phone number already exists"); e.status = 409; throw e;
  }

  const { data, error } = await supabase
    .from("users")
    .insert({
      full_name: name,
      phone: normPhone,
      email: (email || "").trim() || null,
      role: "technician",
      is_active: true,
    })
    .select("id, full_name, phone, email, is_active")
    .single();
  if (error) throw new Error("createTechnician: " + error.message);

  log.info(`Technician added: ${name} (${normPhone})`);
  return data;
}

export async function assignTechnician({ ticketId, technicianId, assignedBy, note }) {
  const ticket = await getTicket(ticketId);

  const { data: tech, error: techErr } = await supabase
    .from("users").select("id, full_name, phone, role, push_token")
    .eq("id", technicianId).single();
  if (techErr || !tech) throw new Error("Technician not found");
  if (tech.role !== "technician") throw new Error("User is not a technician");

  // Guard against duplicate assignments: if the ticket is ALREADY assigned to this
  // exact technician, do nothing but keep the board correct. A repeat action
  // (double-click, or re-assigning the same person after the ticket was reopened /
  // its status changed) must not send the customer/technician a second identical
  // "assigned" message. We check the technician only — NOT status — because a
  // reopened ticket (status back to NEW) previously slipped past this guard and
  // fired duplicate messages.
  if (ticket.assigned_technician_id === technicianId) {
    if (ticket.status !== "ASSIGNED") {
      await supabase.from("tickets").update({ status: "ASSIGNED" }).eq("id", ticketId);
    }
    log.info(`Ticket ${ticket.ticket_number} already assigned to ${tech.full_name} — skipping duplicate notify`);
    return { ...ticket, status: "ASSIGNED", technician: tech };
  }

  const { data: updated, error } = await supabase
    .from("tickets")
    .update({ assigned_technician_id: technicianId, status: "ASSIGNED" })
    .eq("id", ticketId).select().single();
  if (error) throw new Error("assign update: " + error.message);

  await supabase.from("assignments").insert({
    ticket_id: ticketId, technician_id: technicianId,
    assigned_by: assignedBy, note: note || null,
  });
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId, event_type: "assigned",
    from_status: ticket.status, to_status: "ASSIGNED", actor_id: assignedBy,
    meta: { technician_id: technicianId, technician_name: tech.full_name },
  });

  // Job details go to the technician APP only (push below) — no WhatsApp. Job
  // details on WhatsApp let technicians work without ever opening the app, which
  // leaves the workflow (arrival OTP, estimate, payment) unrecorded.

  // Surface a silent gap: a request being assigned with no issue recorded means
  // intake didn't capture it (or it was created manually without one). The customer
  // message now omits the empty line, but the team should still fill it in.
  if (!String(ticket.issue_description ?? "").trim())
    log.warn(`Ticket ${ticket.ticket_number} assigned with NO issue recorded`);

  /* Tell the customer who is coming — but not yet.

     Reassigning is normal office work: someone is closer, someone is ill, the
     first choice is still on another job. The customer does not need to watch it
     happen. Rahul Wandile was told "Technician assigned: Chhagan Bhamre", then
     "Shubham Jadhav", then "Chhagan Bhamre" again for one installation, and 8
     jobs in the last week had the same churn.

     So the message waits, and each reassignment pushes the wait out again; when
     the office settles, ONE message goes with whoever is actually coming.
     Delivered by sendDueAssignmentMessages(), polled from index.js — the same
     shape as the rating ask and the pay message.

     A reassignment hours later, after the customer has already been told, is a
     real change and does send: the drain compares against the name they last
     heard, not against "have we ever written". */
  if (CUSTOMER_NOTIFY.technicianAssigned && ticket.customer?.phone) {
    const w = ticket.tech_work || {};
    const firstAt = w.assign_first_at || new Date().toISOString();
    const capped = Date.now() - new Date(firstAt).getTime() >= ASSIGN_MAX_WAIT_MS;
    await mergeTechWork(ticketId, {
      assign_first_at: firstAt,
      assign_due_at: new Date(Date.now() + (capped ? 0 : ASSIGN_DEBOUNCE_MS)).toISOString(),
    });
  }

  // Phone push to the technician's device (no-op if FCM/token not set up).
  await sendPush(tech.push_token, {
    title: "New job assigned",
    body: `${ticket.customer.full_name} — ${ticket.issue_description || "service request"} (${ticket.ticket_number})`,
    data: { ticketId, type: "assignment" },
  });

  log.info(`Ticket ${ticket.ticket_number} assigned to ${tech.full_name}`);
  return { ...updated, technician: tech };
}


/* How long the "technician assigned" message waits for the office to settle.
   Five minutes covers a change of mind; the cap stops a busy morning of
   shuffling from leaving the customer with no idea who is coming at all. */
const ASSIGN_DEBOUNCE_MS = 5 * 60 * 1000;
const ASSIGN_MAX_WAIT_MS = 20 * 60 * 1000;

/* Deliver the assignment messages whose window has closed.

   The technician is read HERE, not when the assignment happened — that is the
   point. Three reassignments produce one message, naming whoever the job
   actually ended up with. */
export async function sendDueAssignmentMessages() {
  const { data: due } = await supabase
    .from("tickets")
    .select("id, ticket_number, tech_work, assigned_technician_id, customer:customers(phone), technician:users!tickets_assigned_technician_id_fkey(full_name)")
    .not("tech_work->>assign_due_at", "is", null)
    .lte("tech_work->>assign_due_at", new Date().toISOString())
    .limit(50);

  let sent = 0;
  for (const t of due || []) {
    const w = t.tech_work || {};
    const name = t.technician?.full_name || null;
    // Claim first, so a second poller cannot send the same one.
    await mergeTechWork(t.id, { assign_due_at: null });

    const phone = t.customer?.phone;
    if (!phone || !name || !CUSTOMER_NOTIFY.technicianAssigned) continue;
    // Already told them this exact name — the shuffle ended where it started.
    if (w.assign_told === name) continue;

    try {
      const tpl = customerTechnicianAssigned({ techName: name });
      await queueNotification({
        recipient: phone, audience: "customer", ticketId: t.id,
        body: tpl.body, template: tpl.template,
      });
      await mergeTechWork(t.id, { assign_told: name });
      sent += 1;
    } catch (e) {
      log.error(`assignment message ${t.ticket_number}:`, e.message);
    }
  }
  return sent;
}
