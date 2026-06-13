// Technician assignment. Phase 1 = simple manual assignment by the manager.
// (Rules-based auto-assignment is intentionally deferred to a later phase.)
import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { getTicket } from "./tickets.js";
import { log } from "../lib/logger.js";

export async function listTechnicians() {
  const { data, error } = await supabase
    .from("users").select("id, full_name, phone, is_active")
    .eq("role", "technician").eq("is_active", true)
    .order("full_name");
  if (error) throw new Error("listTechnicians: " + error.message);
  return data;
}

// Assign one technician to a ticket: updates ticket, records assignment
// history + event, and notifies the technician.
export async function assignTechnician({ ticketId, technicianId, assignedBy, note }) {
  const ticket = await getTicket(ticketId);

  const { data: tech, error: techErr } = await supabase
    .from("users").select("id, full_name, phone, role")
    .eq("id", technicianId).single();
  if (techErr || !tech) throw new Error("Technician not found");
  if (tech.role !== "technician") throw new Error("User is not a technician");

  // Update the ticket -> ASSIGNED.
  const { data: updated, error } = await supabase
    .from("tickets")
    .update({ assigned_technician_id: technicianId, status: "ASSIGNED" })
    .eq("id", ticketId).select().single();
  if (error) throw new Error("assign update: " + error.message);

  // History row.
  await supabase.from("assignments").insert({
    ticket_id: ticketId, technician_id: technicianId,
    assigned_by: assignedBy, note: note || null,
  });
  await supabase.from("ticket_events").insert({
    ticket_id: ticketId, event_type: "assigned",
    from_status: ticket.status, to_status: "ASSIGNED", actor_id: assignedBy,
    meta: { technician_id: technicianId, technician_name: tech.full_name },
  });

  // Notify the technician.
  await queueNotification({
    recipient: tech.phone, audience: "technician", ticketId,
    body: `🔧 New assignment ${ticket.ticket_number}\n` +
          `Customer: ${ticket.customer.full_name} (${ticket.customer.phone})\n` +
          `Address: ${ticket.customer.address || "N/A"}\n` +
          `Issue: ${ticket.issue_description}`,
  });

  // Tell the customer a technician is on the case.
  await queueNotification({
    recipient: ticket.customer.phone, audience: "customer", ticketId,
    body: `👨‍🔧 Hi ${ticket.customer.full_name}, technician *${tech.full_name}* ` +
          `has been assigned to your request ${ticket.ticket_number}. ` +
          `They will contact you shortly.`,
  });

  log.info(`Ticket ${ticket.ticket_number} assigned to ${tech.full_name}`);
  return { ...updated, technician: tech };
}
