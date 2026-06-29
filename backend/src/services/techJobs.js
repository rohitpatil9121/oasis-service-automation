// Technician App backend. Everything here is scoped to ONE logged-in technician
// (their own assigned tickets). The rich per-step workflow data lives in the
// tickets.tech_work JSONB column; the dashboard keeps using the coarse status.
import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { updateStatus, getTicket } from "./tickets.js";
import { log } from "../lib/logger.js";

const SELECT =
  "*, customer:customers(*), technician:users!tickets_assigned_technician_id_fkey(id,full_name,phone)";

// action → the tech_status it lands on, the timestamp it stamps.
const ACTIONS = {
  accept:   { status: "ACCEPTED",      ts: "accepted_at" },
  enroute:  { status: "ON_THE_WAY",    ts: "enroute_at" },
  arrive:   { status: "ARRIVED",       ts: "arrived_at" },
  diagnose: { status: "DIAGNOSED",     ts: "diagnosed_at" },
  estimate: { status: "ESTIMATE_SENT", ts: "estimate_sent_at" },
  approve:  { status: "VERIFIED",      ts: "approved_at" },
  reject:   { status: "REJECTED",      ts: "approved_at" },
  workdone: { status: "WORK_DONE",     ts: "work_done_at" },
  payment:  { status: "PAID",          ts: "paid_at" },
  close:    { status: "CLOSED",        ts: "closed_at" },
};

const CHARGE_FREE = new Set(["warranty", "repeat"]);

function shortArea(address = "") {
  // Best-effort "area" for the job card: the second-to-last comma segment
  // (usually the locality), else the first.
  const parts = String(address).split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "";
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Map a ticket row to the shape the technician-app screens expect.
function toJob(t) {
  const work = t.tech_work || {};
  const techStatus = work.tech_status || (t.status === "CLOSED" ? "CLOSED" : "NEW");

  let bucket = "today";
  if (t.status === "CLOSED") bucket = "completed";
  else {
    const when = t.scheduled_start || t.created_at;
    bucket = new Date(when).getTime() < startOfToday() ? "pending" : "today";
  }

  let visitCharge = 250;
  if (work.charge && CHARGE_FREE.has(work.charge)) visitCharge = 0;

  return {
    id: t.id,
    code: t.ticket_number || t.id,
    name: t.customer?.full_name || "Customer",
    phone: t.customer?.phone || "",
    area: shortArea(t.customer?.address),
    address: t.customer?.address || "",
    when: t.scheduled_start
      ? new Date(t.scheduled_start).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true })
      : "Today",
    bucket,
    model: t.appliance || "—",
    issue: t.issue_description || "",
    lastService: null,
    visitCharge,
    tags: [],
    status: techStatus,
    work,
  };
}

export async function listMyJobs(techId) {
  const { data, error } = await supabase
    .from("tickets").select(SELECT)
    .eq("assigned_technician_id", techId)
    .neq("status", "CANCELLED")
    .order("created_at", { ascending: false });
  if (error) throw new Error("listMyJobs: " + error.message);
  return (data || []).map(toJob);
}

async function loadOwned(techId, ticketId) {
  const { data, error } = await supabase
    .from("tickets").select(SELECT).eq("id", ticketId).single();
  if (error) throw new Error("getMyJob: " + error.message);
  if (data.assigned_technician_id !== techId) {
    const e = new Error("This job is not assigned to you"); e.status = 403; throw e;
  }
  return data;
}

export async function getMyJob(techId, ticketId) {
  return toJob(await loadOwned(techId, ticketId));
}

// Advance one workflow step. `work` is the technician's per-step data (stored
// verbatim into tech_work); the server stamps tech_status + timestamp and fires
// any customer-facing WhatsApp message.
export async function runStep(techId, ticketId, action, work = {}) {
  const spec = ACTIONS[action];
  if (!spec) { const e = new Error("Unknown step: " + action); e.status = 400; throw e; }

  const ticket = await loadOwned(techId, ticketId);
  const techName = ticket.technician?.full_name || "our technician";

  const tech_work = {
    ...(ticket.tech_work || {}),
    ...work,
    tech_status: spec.status,
    [spec.ts]: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("tickets").update({ tech_work }).eq("id", ticketId);
  if (error) throw new Error("runStep update: " + error.message);

  // Coarse status + dashboard side effects.
  if (action === "accept" && ticket.status !== "IN_PROGRESS") {
    await updateStatus(ticketId, "IN_PROGRESS", techId);
  }

  // ---- Minimal customer WhatsApp messages (one per key milestone only) ----
  const cust = ticket.customer;
  if (action === "enroute" && cust?.phone) {
    await queueNotification({
      recipient: cust.phone, audience: "customer", ticketId,
      body: `Namaste ${cust.full_name || ""}, ${techName} is on the way for your ` +
            `${ticket.appliance || "purifier"} service (${ticket.ticket_number}). ` +
            `They will reach you shortly.`,
    });
  }
  if (action === "estimate" && cust?.phone) {
    const total = Number(tech_work.total || 0);
    await queueNotification({
      recipient: cust.phone, audience: "customer", ticketId,
      body: `Estimate for your ${ticket.appliance || "purifier"} (${ticket.ticket_number}): ` +
            `₹${total.toLocaleString("en-IN")}. ${techName} will explain the details — ` +
            `please approve to proceed. Work starts only after your approval.`,
    });
  }

  if (action === "close") {
    // Reuse the platform's close flow → sends the customer completion + rating
    // message exactly once, logs the status change, keeps the dashboard in sync.
    await updateStatus(ticketId, "CLOSED", techId);
    if (work.lead) {
      const { data: mgrs } = await supabase
        .from("users").select("phone").eq("role", "manager").eq("is_active", true);
      for (const m of mgrs || []) {
        await queueNotification({
          recipient: m.phone, audience: "manager", ticketId,
          body: `Lead from ${techName}: customer ${cust?.full_name || ""} ` +
                `(${ticket.ticket_number}) is interested in a new purifier / special part. ` +
                `Please follow up.`,
        });
      }
    }
    log.info(`Tech ${techName} closed ${ticket.ticket_number}`);
  }

  return toJob(await loadOwned(techId, ticketId));
}

export async function listParts() {
  const { data, error } = await supabase
    .from("stock_items").select("id, name, unit_price")
    .eq("is_active", true).order("name");
  if (error) throw new Error("listParts: " + error.message);
  return (data || []).map((p) => ({ id: p.id, name: p.name, price: Number(p.unit_price || 0) }));
}

export async function setOnline(techId, isOnline) {
  await supabase.from("users").update({ is_online: !!isOnline }).eq("id", techId);
  return { is_online: !!isOnline };
}

export async function getMyReviews(techId) {
  const { data, error } = await supabase
    .from("tickets")
    .select("rating, rated_at, customer:customers(full_name)")
    .eq("assigned_technician_id", techId)
    .not("rating", "is", null)
    .order("rated_at", { ascending: false });
  if (error) throw new Error("getMyReviews: " + error.message);

  const rows = data || [];
  const scores = rows.map((r) => Number(r.rating));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const round1 = (n) => Math.round(n * 10) / 10;

  return {
    average: round1(avg),
    thisWeek: round1(avg),
    jobsRated: rows.length,
    fiveStar: scores.filter((s) => s === 5).length,
    topStreak: scores.length ? Math.max(...scores) : 0,
    needsWork: scores.length ? Math.min(...scores) : 0,
    categories: [], // per-category ratings not captured yet
    recent: rows.slice(0, 8).map((r) => ({
      name: r.customer?.full_name || "Customer", stars: Number(r.rating), text: "",
    })),
  };
}
