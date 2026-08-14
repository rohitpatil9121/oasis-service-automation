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

/* Was this job a new machine going in, rather than a repair?

   The technician picks the call type while writing the bill, and "Installation"
   means the customer now owns a purifier they did not have this morning. That is
   worth a column of its own on the board: those are the people who need an AMC
   offer, a first service reminder, and the machine on record — none of which the
   office can chase if the job is filed among the ordinary repairs.

   Deliberately NOT a board bucket. A bucket is exclusive, so making this one
   would pull every installation out of Service Done and Completed and leave
   those counts short. It reads across them instead: a ticket keeps its bucket
   AND is marked as an installation.

   `charge` is the older field name that builds before the bill redesign wrote;
   finished jobs from those builds still carry it.

   Two sources, in this order:

   1. The bill, when there is one. The technician picked the call type standing
      in front of the machine, so it settles the question either way — a job
      billed as "service" is NOT an installation however its request was worded.

   2. Failing that, the words of the request. Of 502 tickets only 186 carry a
      bill at all; the rest were closed from the dashboard or predate billing in
      the app, and among them sit plainly-labelled jobs like "AQUA JADE WHITE NEW
      INSTALLATION" that would otherwise be invisible for ever. This recovers 33
      of them.

   Re-installations and shifts are excluded: moving a machine that a customer
   already owns is not a new machine going in, and it is the new ones the office
   is looking for. "REE INSTALLATION" is in that list because the live data
   contains that typo for RE-INSTALLATION. */
const SAYS_INSTALL = /\b(install|installation)\b/i;
const SAYS_AGAIN = /\bree?[-\s]?install|\bshift|\brelocat/i;

export function isInstallation(ticket) {
  const w = ticket?.tech_work || {};
  const billed = w.call_type ?? w.charge;
  if (billed) return billed === "installation";

  const issue = ticket?.issue_description || "";
  return SAYS_INSTALL.test(issue) && !SAYS_AGAIN.test(issue);
}

export function attachBoardBucket(ticket, { repeatCustomer = false } = {}) {
  const t = repeatCustomer ? { ...ticket, repeat_customer: true } : ticket;
  return { ...t, board_bucket: boardBucket(t), installation: isInstallation(t) };
}
