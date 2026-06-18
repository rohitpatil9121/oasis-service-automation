// Technician assignment. Phase 1 = simple manual assignment by the manager.
import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { technicianNewJob } from "./waTemplates.js";
import { getTicket } from "./tickets.js";
import { normalizePhone, isValidPhone } from "../lib/phone.js";
import { log } from "../lib/logger.js";

export async function listTechnicians() {
  const { data, error } = await supabase
    .from("users").select("id, full_name, phone, email, is_active")
    .eq("role", "technician").eq("is_active", true)
    .order("full_name");
  if (error) throw new Error("listTechnicians: " + error.message);
  return data;
}

export async function getTechnicianById(id) {
  const { data, error } = await supabase
    .from("users").select("id, full_name, phone, email, is_active, role")
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
    .from("users").select("id, role").eq("phone", normPhone).maybeSingle();
  if (existing) {
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
    .from("users").select("id, full_name, phone, role")
    .eq("id", technicianId).single();
  if (techErr || !tech) throw new Error("Technician not found");
  if (tech.role !== "technician") throw new Error("User is not a technician");

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

  const techTpl = technicianNewJob({
    ticketNumber: ticket.ticket_number, customerName: ticket.customer.full_name,
    customerPhone: ticket.customer.phone, address: ticket.customer.address,
    appliance: ticket.appliance, issue: ticket.issue_description,
  });
  await queueNotification({
    recipient: tech.phone, audience: "technician", ticketId,
    body: techTpl.body, template: techTpl.template,
  });

  await queueNotification({
    recipient: ticket.customer.phone, audience: "customer", ticketId,
    body: `👨‍🔧 Hi ${ticket.customer.full_name}, technician *${tech.full_name}* ` +
          `has been assigned to your request ${ticket.ticket_number}. ` +
          `They will contact you shortly.`,
  });

  log.info(`Ticket ${ticket.ticket_number} assigned to ${tech.full_name}`);
  return { ...updated, technician: tech };
}
