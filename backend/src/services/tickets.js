import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { managerNewRequest } from "./waTemplates.js";
import { env } from "../config/env.js";
import { log } from "../lib/logger.js";

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
