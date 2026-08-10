// Manager dashboard buckets — single source of truth for where a ticket appears
// on the Service Requests board (New / Pending / Assigned / Service Done / Completed).

export const TICKET_REUSE_DAYS = 7;

export const BOARD_BUCKETS = ["new", "pending", "assigned", "service_done", "completed"];

export const istToday = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function isCreatedTodayIST(iso) {
  if (!iso) return false;
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === istToday();
}

/** When the job was marked closed (column preferred, tech_work / legacy fallbacks). */
export function closedAtOf(ticket) {
  if (!ticket) return null;
  const w = ticket.tech_work || {};
  if (ticket.closed_at) return ticket.closed_at;
  if (w.closed_at) return w.closed_at;
  if (w.paid_at) return w.paid_at;
  if (w.work_done_at) return w.work_done_at;
  // Legacy CLOSED rows — no stamped close time; updated_at is the best proxy.
  if (ticket.status === "CLOSED" && ticket.updated_at) return ticket.updated_at;
  return null;
}

export function daysSinceClose(ticket) {
  const at = closedAtOf(ticket);
  if (!at) return null;
  return (Date.now() - new Date(at).getTime()) / 86400000;
}

/**
 * Which board column a ticket belongs in.
 * Cancelled tickets only appear under "all".
 */
export function boardBucket(ticket) {
  if (!ticket) return null;
  if (ticket.status === "CANCELLED") return "cancelled";

  if (ticket.status === "CLOSED") {
    const days = daysSinceClose(ticket);
    if (days == null) {
      // No close timestamp at all — archive by ticket age so legacy rows don't stick in Service Done.
      const age = ticket.created_at
        ? (Date.now() - new Date(ticket.created_at).getTime()) / 86400000
        : null;
      return age != null && age > TICKET_REUSE_DAYS ? "completed" : "service_done";
    }
    if (days <= TICKET_REUSE_DAYS) return "service_done";
    return "completed";
  }

  if (ticket.assigned_technician_id) return "assigned";

  // Unassigned, still open.
  if (ticket.reopened_at || ticket.tech_work?.reopened_at) return "pending";

  /* An unfinished intake is Pending, however new it is.

     The bot opens the request the moment someone asks for service, before it
     knows the fault or the address — so New filled up with half-collected
     requests that read like fresh work but cannot be assigned to anybody. They
     need chasing, not dispatching, and Pending is the column the office works
     through. A request only counts as New once its details are complete. */
  if (ticket.intake_complete === false) return "pending";

  /* A customer we have served before is Pending, not New.

     New is where the office looks for people it does not know yet — someone
     whose address has to be taken down and whose purifier nobody has seen.
     A returning customer needs none of that; they need a technician sent, which
     is the Pending queue's job. Their repeat requests were landing in New and
     being read as fresh enquiries.

     Set by the caller, which knows whether this is the customer's first ticket. */
  if (ticket.repeat_customer) return "pending";

  if (isCreatedTodayIST(ticket.created_at)) return "new";
  return "pending";
}

export function attachBoardBucket(ticket, { repeatCustomer = false } = {}) {
  const t = repeatCustomer ? { ...ticket, repeat_customer: true } : ticket;
  return { ...t, board_bucket: boardBucket(t) };
}
