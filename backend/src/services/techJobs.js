// Technician App backend. Everything here is scoped to ONE logged-in technician
// (their own assigned tickets). The rich per-step workflow data lives in the
// tickets.tech_work JSONB column; the dashboard keeps using the coarse status.
import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";
import { queueNotification } from "./notifications.js";
import { sendPush } from "./push.js";
import { updateStatus, getTicket, RATING_LABELS } from "./tickets.js";
import {
  customerArrivalOtp, customerEstimate,
  customerEstimateApproved, customerWorkCompleted, customerVisitCharge,
  customerPaymentReceived,
} from "./waTemplates.js";
import { log } from "../lib/logger.js";

const SELECT =
  "*, customer:customers(*), technician:users!tickets_assigned_technician_id_fkey(id,full_name,phone)";

// action → the tech_status it lands on, the timestamp it stamps.
const ACTIONS = {
  accept:   { status: "ACCEPTED",      ts: "accepted_at" },
  enroute:  { status: "ON_THE_WAY",    ts: "enroute_at" },
  arrive:   { status: "ARRIVED",       ts: "arrived_at" },
  diagnose: { status: "DIAGNOSED",     ts: "diagnosed_at" },
  // The technician shows the estimate to the customer in person and starts work
  // right away — no WhatsApp approve/reject round trip. The estimate still goes
  // out, as a record of what was agreed.
  estimate: { status: "VERIFIED", ts: "estimate_sent_at" },
  approve:  { status: "VERIFIED",      ts: "approved_at" },
  reject:   { status: "REJECTED",      ts: "approved_at" },
  workdone: { status: "WORK_DONE",     ts: "work_done_at" },
  payment:  { status: "PAID",          ts: "paid_at" },
  close:    { status: "CLOSED",        ts: "closed_at" },
};

const CHARGE_FREE = new Set(["warranty", "repeat"]);

// Writes made offline are replayed from the phone's outbox and can arrive twice
// (the first attempt may have reached us before the connection dropped). Each
// carries a client_id; we keep the recent ones so a repeat is ignored rather
// than, say, recording the same payment again. Capped so tech_work stays small.
const MAX_CLIENT_IDS = 40;
const rememberClientId = (tech_work, clientId) =>
  [...(tech_work?.applied_client_ids || []), clientId].slice(-MAX_CLIENT_IDS);
const alreadyApplied = (tech_work, clientId) =>
  !!clientId && (tech_work?.applied_client_ids || []).includes(clientId);

// Charge id → customer-facing label for the estimate bill. Matches the technician
// app's charge options (Service/Visit ₹250, Warranty/Repeat ₹0).
const CHARGE_LABELS = {
  service: "Service Charge",
  visit: "Visit Charge",
  warranty: "No Charge (Under Warranty)",
  repeat: "Repeat Call",
};

const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// Build the itemised estimate the customer receives on WhatsApp: charge line +
// each part with its price + grand total. `work` is the technician's step data
// ({ charge, parts:[{name,price}], total }).
function formatEstimateBill(ticket, work = {}) {
  const parts = Array.isArray(work.parts) ? work.parts : [];
  const partsTotal = parts.reduce((s, p) => s + Number(p.price || 0), 0);
  const chargeAmt = CHARGE_FREE.has(work.charge) ? 0 : 250;
  const total = Number(work.total ?? chargeAmt + partsTotal);
  const chargeLabel = CHARGE_LABELS[work.charge] || "Service Charge";
  const problem = (Array.isArray(work.problems) && work.problems.join(", "))
    || ticket.issue_description || "—";

  const lines = ["Problem found", "", `Issue: ${problem}`, "", "Estimate:",
    `${chargeLabel}: ${rupees(chargeAmt)}`];
  for (const p of parts) lines.push(`${p.name}: ${rupees(p.price)}`);
  lines.push("------------------------------", `Total: ${rupees(total)}`, "",
    "The technician has started the work.");
  return lines.join("\n");
}

function shortArea(address = "") {
  // Best-effort "area" for the job card: the second-to-last comma segment
  // (usually the locality), else the first.
  const parts = String(address).split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "";
}

// All day/time labelling is IST — the server runs in UTC, so plain local-time
// maths would put jobs on the wrong day (and show times 5.5h behind).
const IST = "Asia/Kolkata";
const istDay = (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });
const istTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true });

// "Today, 4:00 pm" / "Yesterday, 4:00 pm" / "18 Jul, 4:00 pm".
function formatWhen(iso) {
  if (!iso) return "—";
  const day = istDay(iso);
  const time = istTime(iso);
  if (day === istDay(Date.now())) return `Today, ${time}`;
  if (day === istDay(Date.now() - 86400000)) return `Yesterday, ${time}`;
  const date = new Date(iso).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
  return `${date}, ${time}`;
}

// Map a ticket row to the shape the technician-app screens expect.
function toJob(t) {
  const work = t.tech_work || {};
  const techStatus = work.tech_status || (t.status === "CLOSED" ? "CLOSED" : "NEW");

  let bucket = "today";
  if (t.status === "CLOSED") bucket = "completed";
  else {
    const when = t.scheduled_start || t.created_at;
    bucket = istDay(when) < istDay(Date.now()) ? "pending" : "today";
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
    // Tickets raised over WhatsApp have no scheduled_start — fall back to when
    // the request came in rather than labelling everything "Today".
    when: formatWhen(t.scheduled_start || t.created_at),
    bucket,
    model: t.appliance || "—",
    issue: t.issue_description || "",
    notes: t.notes || "",
    lastService: null,
    visitCharge,
    tags: [],
    status: techStatus,
    work,
    rating: t.rating != null ? Number(t.rating) : null,
  };
}

// Attach the customer-sent WhatsApp images (purifier photos) to each job so the
// technician can see them. Images live on wa_inbound (keyed by the customer's
// phone), so we fetch the recent image rows for the jobs' customer phones in one
// query and map them back. Returns the jobs (mutated in place).
async function attachCustomerPhotos(jobs) {
  const phones = [...new Set(jobs.map((j) => j.phone).filter(Boolean))];
  if (!phones.length) return jobs;
  const { data, error } = await supabase
    .from("wa_inbound")
    .select("from_phone, media_id, media_type, created_at")
    .in("from_phone", phones)
    .like("media_type", "image/%")
    .order("created_at", { ascending: false });
  if (error) { log.error("attachCustomerPhotos:", error.message); return jobs; }
  const byPhone = new Map();
  for (const r of data || []) {
    if (!r.media_id) continue;
    const arr = byPhone.get(r.from_phone) || [];
    if (arr.length < 6) arr.push(r.media_id); // cap per customer
    byPhone.set(r.from_phone, arr);
  }
  for (const j of jobs) j.customerPhotos = byPhone.get(j.phone) || [];
  return jobs;
}

export async function listMyJobs(techId) {
  const { data, error } = await supabase
    .from("tickets").select(SELECT)
    .eq("assigned_technician_id", techId)
    .neq("status", "CANCELLED")
    .order("created_at", { ascending: false });
  if (error) throw new Error("listMyJobs: " + error.message);
  return attachCustomerPhotos((data || []).map(toJob));
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
  const [job] = await attachCustomerPhotos([toJob(await loadOwned(techId, ticketId))]);
  return job;
}

// Estimate approval from the customer's WhatsApp reply. When the customer has a
// ticket awaiting approval (tech_status ESTIMATE_SENT) and replies APPROVE/REJECT
// (or yes/no, haan/nahi), mark it VERIFIED/REJECTED and confirm. Returns true if
// it handled the message (so the intake agent is skipped for that reply).
const APPROVE_RE = /\b(approve|approved|yes|ok|okay|confirm|confirmed|haan|ha|theek|thik|done|accept|accepted)\b/i;
const REJECT_RE = /\b(reject|rejected|no|nahi|cancel|decline|declined)\b/i;

export async function handleEstimateReply(phone, text) {
  const s = String(text || "").trim();
  if (!s) return false;
  const { data: cust } = await supabase
    .from("customers").select("id").eq("phone", phone).maybeSingle();
  if (!cust) return false;
  const { data: tickets } = await supabase
    .from("tickets").select("id, ticket_number, assigned_technician_id, tech_work, customer:customers(full_name)")
    .eq("customer_id", cust.id).neq("status", "CLOSED").neq("status", "CANCELLED")
    .order("created_at", { ascending: false }).limit(5);
  const t = (tickets || []).find((x) => x.tech_work?.tech_status === "ESTIMATE_SENT");
  if (!t) return false;

  // Customer replies "1" = Approve, "2" = Reject (also word variants).
  const approve = s === "1" || APPROVE_RE.test(s);
  const reject = s === "2" || REJECT_RE.test(s);
  if (!approve && !reject) return false;
  const verified = approve && !reject;

  const tech_work = {
    ...(t.tech_work || {}),
    tech_status: verified ? "VERIFIED" : "REJECTED",
    [verified ? "approved_at" : "rejected_at"]: new Date().toISOString(),
  };
  await supabase.from("tickets").update({ tech_work }).eq("id", t.id);
  // Approve → confirm + work starts. Reject → no message (the technician will
  // send a revised estimate or collect the visit charge only, each with its own).
  if (verified) {
    const tpl = customerEstimateApproved({ ticketNumber: t.ticket_number });
    await queueNotification({
      recipient: phone, audience: "customer", ticketId: t.id,
      body: tpl.body, template: tpl.template,
    });
  }
  if (t.assigned_technician_id) {
    const { data: tech } = await supabase
      .from("users").select("push_token").eq("id", t.assigned_technician_id).maybeSingle();
    if (tech?.push_token) {
      await sendPush(tech.push_token, {
        title: verified ? "Estimate approved" : "Estimate rejected",
        body: `${t.ticket_number} — customer ${verified ? "approved" : "rejected"}`,
        data: { ticketId: t.id },
      });
    }
  }
  return true;
}

// "Reached": send the customer a 4-digit OTP on WhatsApp. The customer reads it
// out to the on-site technician, who enters it to prove arrival. No GPS check.
// The code is sent when the technician STARTS TRAVEL, not on arrival: customers
// often have no signal at home, and a WhatsApp message already delivered can be
// read offline. Valid long enough to cover the trip.
const ARRIVAL_OTP_TTL_MS = 6 * 60 * 60 * 1000;

const hasLiveArrivalOtp = (tw) =>
  !!tw?.arrival_otp && !!tw?.arrival_otp_expires &&
  new Date(tw.arrival_otp_expires).getTime() > Date.now();

async function issueArrivalOtp(ticket, ticketId) {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const tech_work = {
    ...(ticket.tech_work || {}),
    arrival_otp: await bcrypt.hash(code, 10),
    arrival_otp_expires: new Date(Date.now() + ARRIVAL_OTP_TTL_MS).toISOString(),
  };
  const { error } = await supabase.from("tickets").update({ tech_work }).eq("id", ticketId);
  if (error) throw new Error("issueArrivalOtp: " + error.message);
  if (ticket.customer?.phone) {
    const tpl = customerArrivalOtp({ code });
    await queueNotification({
      recipient: ticket.customer.phone, audience: "customer", ticketId,
      body: tpl.body, template: tpl.template,
    });
  }
}

export async function sendArrivalOtp(techId, ticketId) {
  const ticket = await loadOwned(techId, ticketId);
  // Already sent at Start Travel and still valid — don't resend. The customer may
  // be offline by now but still has the earlier message to read from.
  if (hasLiveArrivalOtp(ticket.tech_work)) return { ok: true, reused: true };
  await issueArrivalOtp(ticket, ticketId);
  return { ok: true };
}

// Verify the arrival OTP the customer shared. On success → status ARRIVED.
// `clientId` means this arrived from the phone's offline outbox: the technician
// already moved on, so a bad code can't be rejected in their face. Record the
// failure on the job instead so the office can see the arrival wasn't proven.
export async function verifyArrivalOtp(techId, ticketId, code, clientId) {
  const ticket = await loadOwned(techId, ticketId);
  const tw = ticket.tech_work || {};
  if (alreadyApplied(tw, clientId)) return { ok: true, job: toJob(ticket) };

  const flagUnverified = async (reason) => {
    if (!clientId) return;   // live attempt — the technician sees the error and retries
    await supabase.from("tickets").update({
      tech_work: {
        ...tw, tech_status: "ARRIVED", arrived_at: tw.arrived_at || new Date().toISOString(),
        arrival_unverified: reason, arrival_unverified_at: new Date().toISOString(),
        applied_client_ids: rememberClientId(tw, clientId),
      },
    }).eq("id", ticketId);
    log.warn(`Ticket ${ticket.ticket_number}: offline arrival code ${reason}`);
  };

  if (!tw.arrival_otp || !tw.arrival_otp_expires) {
    await flagUnverified("no code was issued");
    return { ok: false, error: "Tap Reached to send the code first." };
  }
  if (new Date(tw.arrival_otp_expires).getTime() < Date.now()) {
    await flagUnverified("code had expired");
    return { ok: false, error: "Code expired — tap Reached to resend." };
  }
  if (!(await bcrypt.compare(String(code || ""), tw.arrival_otp))) {
    await flagUnverified("wrong code");
    return { ok: false, error: "Invalid code" };
  }
  const tech_work = {
    ...tw, tech_status: "ARRIVED", arrived_at: new Date().toISOString(),
    arrival_otp: null, arrival_otp_expires: null,
    ...(clientId ? { applied_client_ids: rememberClientId(tw, clientId) } : {}),
  };
  const { error } = await supabase.from("tickets").update({ tech_work }).eq("id", ticketId);
  if (error) throw new Error("verifyArrivalOtp: " + error.message);
  return { ok: true, job: toJob(await loadOwned(techId, ticketId)) };
}

// Advance one workflow step. `work` is the technician's per-step data (stored
// verbatim into tech_work); the server stamps tech_status + timestamp and fires
// any customer-facing WhatsApp message.
export async function runStep(techId, ticketId, action, work = {}, clientId) {
  const spec = ACTIONS[action];
  if (!spec) { const e = new Error("Unknown step: " + action); e.status = 400; throw e; }

  const ticket = await loadOwned(techId, ticketId);
  // Replayed from the offline outbox and already applied — return the job as-is
  // so we don't re-run the step or re-send its customer WhatsApp.
  if (alreadyApplied(ticket.tech_work, clientId)) return toJob(ticket);
  const techName = ticket.technician?.full_name || "our technician";

  // Estimate guard: a part's price must stay between its minimum price
  // (base_cost, if set) and MRP (unit_price, if set).
  if (action === "estimate" && Array.isArray(work.parts) && work.parts.length) {
    const ids = work.parts.map((p) => p.id).filter(Boolean);
    if (ids.length) {
      const { data: rows, error: pErr } = await supabase
        .from("stock_items").select("id, name, unit_price, base_cost").in("id", ids);
      if (pErr) throw new Error("runStep parts check: " + pErr.message);
      const byId = new Map((rows || []).map((r) => [r.id, r]));
      for (const p of work.parts) {
        const row = p.id && byId.get(p.id);
        if (!row) continue;
        const price = Number(p.price || 0);
        const min = Number(row.base_cost || 0);
        const mrp = Number(row.unit_price || 0);
        if (min > 0 && price < min) {
          const e = new Error(`${row.name}: price ₹${price} is below minimum ₹${min}`);
          e.status = 400; throw e;
        }
        if (mrp > 0 && price > mrp) {
          const e = new Error(`${row.name}: price ₹${price} is above MRP ₹${mrp}`);
          e.status = 400; throw e;
        }
      }
    }
  }

  const tech_work = {
    ...(ticket.tech_work || {}),
    ...work,
    tech_status: spec.status,
    [spec.ts]: new Date().toISOString(),
    ...(clientId ? { applied_client_ids: rememberClientId(ticket.tech_work, clientId) } : {}),
  };

  const { error } = await supabase
    .from("tickets").update({ tech_work }).eq("id", ticketId);
  if (error) throw new Error("runStep update: " + error.message);

  // Coarse status + dashboard side effects. The flow starts at "Start Travel"
  // (enroute) — no separate accept step — so that marks the job in progress.
  if ((action === "accept" || action === "enroute") && ticket.status !== "IN_PROGRESS") {
    await updateStatus(ticketId, "IN_PROGRESS", techId);
  }

  // ---- Minimal customer WhatsApp messages (one per key milestone only) ----
  // "On the way" is deliberately NOT sent: the technician app has no separate
  // Start Travel step any more, so enroute is just the internal move that marks
  // the job in progress on the dashboard. The arrival code goes out when the
  // technician taps Reached (sendArrivalOtp).
  const cust = ticket.customer;

  // Estimate → send the customer the itemised bill as a RECORD of what the
  // technician showed them on site. No reply is expected: work starts immediately.
  if (action === "estimate" && cust?.phone) {
    // Collapse the itemised bill into fixed template variables (charges as one
    // comma-joined line, since a Meta template can't have a variable count of
    // parts). The full readable bill stays as the fallback body.
    const eParts = Array.isArray(work.parts) ? work.parts : [];
    const eChargeAmt = CHARGE_FREE.has(work.charge) ? 0 : 250;
    const eTotal = Number(work.total ?? eChargeAmt + eParts.reduce((s, p) => s + Number(p.price || 0), 0));
    const eProblem = (Array.isArray(work.problems) && work.problems.join(", "))
      || ticket.issue_description || "—";
    const charges = [`${CHARGE_LABELS[work.charge] || "Service Charge"}: ${rupees(eChargeAmt)}`,
      ...eParts.map((p) => `${p.name}: ${rupees(p.price)}`)].join(", ");
    const tpl = customerEstimate({
      ticketNumber: ticket.ticket_number, problem: eProblem, charges,
      total: rupees(eTotal), body: formatEstimateBill(ticket, work),
    });
    await queueNotification({
      recipient: cust.phone, audience: "customer", ticketId,
      body: tpl.body, template: tpl.template,
    });
  }

  // Work done → tell the customer the amount due and to pay in the tech's presence.
  if (action === "workdone" && cust?.phone) {
    const due = Number(work.total ?? tech_work.total ?? 0);
    const tpl = work.visitOnly
      ? customerVisitCharge({ ticketNumber: ticket.ticket_number, amount: rupees(due) })
      : customerWorkCompleted({ amount: rupees(due) });
    await queueNotification({
      recipient: cust.phone, audience: "customer", ticketId,
      body: tpl.body, template: tpl.template,
    });
  }

  // Payment collected → confirm to the customer with amount + mode (not if pending).
  if (action === "payment" && cust?.phone && !work.pending) {
    // A split payment must read "Cash + UPI", not just the first method — the app
    // already sends the combined label, so prefer it and only derive as a fallback.
    let mode = work.mode
      || (Array.isArray(work.payments) && work.payments.map((p) => p.method).filter(Boolean).join(" + "))
      || "—";
    if (work.visitOnly || tech_work.visitOnly) mode = `${mode} (Visit charge)`;
    const tpl = customerPaymentReceived({
      ticketNumber: ticket.ticket_number,
      amount: rupees(work.total ?? tech_work.total ?? 0), mode,
    });
    await queueNotification({
      recipient: cust.phone, audience: "customer", ticketId,
      body: tpl.body, template: tpl.template,
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
    .from("stock_items").select("id, name, unit_price, brand, base_cost")
    .eq("is_active", true).order("name");
  if (error) throw new Error("listParts: " + error.message);
  return (data || []).map((p) => ({
    id: p.id, name: p.name, price: Number(p.unit_price || 0), brand: p.brand || "other",
    minPrice: Number(p.base_cost || 0),
  }));
}

// Save a technician-captured job photo (base64 data URL) to Supabase Storage and
// attach its public URL to the ticket's tech_work.tech_photos.
const PHOTO_BUCKET = "tech-photos";
export async function saveJobPhoto(techId, ticketId, dataUrl, clientId) {
  const owned = await loadOwned(techId, ticketId); // ownership + existence check
  // Replayed from the offline outbox and already stored — don't add it twice.
  if (clientId && (owned.tech_work?.applied_client_ids || []).includes(clientId)) {
    return { ok: true, job: toJob(owned), duplicate: true };
  }
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) { const e = new Error("Invalid image"); e.status = 400; throw e; }
  const contentType = m[1];
  const buffer = Buffer.from(m[2], "base64");
  const path = `${ticketId}/${Date.now()}.${contentType.split("/")[1] || "jpg"}`;

  let up = await supabase.storage.from(PHOTO_BUCKET).upload(path, buffer, { contentType });
  if (up.error && /bucket|not found/i.test(up.error.message)) {
    await supabase.storage.createBucket(PHOTO_BUCKET, { public: true });
    up = await supabase.storage.from(PHOTO_BUCKET).upload(path, buffer, { contentType });
  }
  if (up.error) throw new Error("saveJobPhoto: " + up.error.message);

  const url = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  const ticket = await loadOwned(techId, ticketId);
  const tech_work = {
    ...(ticket.tech_work || {}),
    tech_photos: [...(ticket.tech_work?.tech_photos || []), url],
    ...(clientId ? { applied_client_ids: rememberClientId(ticket.tech_work, clientId) } : {}),
  };
  await supabase.from("tickets").update({ tech_work }).eq("id", ticketId);
  return { ok: true, job: toJob(await loadOwned(techId, ticketId)) };
}

// Store the technician's latest GPS fix (live location for the dashboard).
export async function saveLocation(techId, lat, lng) {
  if (lat == null || lng == null) { const e = new Error("lat/lng required"); e.status = 400; throw e; }
  const { error } = await supabase.from("users")
    .update({ last_lat: Number(lat), last_lng: Number(lng), location_at: new Date().toISOString() })
    .eq("id", techId);
  if (error) throw new Error("saveLocation: " + error.message);
  return { ok: true };
}

// Save the technician's FCM device token (for push notifications).
export async function savePushToken(techId, token) {
  if (!token) { const e = new Error("token required"); e.status = 400; throw e; }
  const { error } = await supabase.from("users").update({ push_token: token }).eq("id", techId);
  if (error) throw new Error("savePushToken: " + error.message);
  return { ok: true };
}

export async function setOnline(techId, isOnline) {
  await supabase.from("users").update({ is_online: !!isOnline }).eq("id", techId);
  return { is_online: !!isOnline };
}

export async function getMyReviews(techId) {
  const { data, error } = await supabase
    .from("tickets")
    .select("rating, rated_at, ticket_number, customer:customers(full_name)")
    .eq("assigned_technician_id", techId)
    .not("rating", "is", null)
    .order("rated_at", { ascending: false });
  if (error) throw new Error("getMyReviews: " + error.message);

  const rows = data || [];
  const scores = rows.map((r) => Number(r.rating));
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const round1 = (n) => Math.round(n * 10) / 10;

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const weekScores = rows
    .filter((r) => new Date(r.rated_at).getTime() >= weekAgo)
    .map((r) => Number(r.rating));
  const weekAvg = weekScores.length
    ? weekScores.reduce((a, b) => a + b, 0) / weekScores.length
    : 0;

  return {
    average: round1(avg),
    thisWeek: round1(weekAvg),
    jobsRated: rows.length,
    fiveStar: scores.filter((s) => s === 5).length,
    topStreak: scores.length ? Math.max(...scores) : 0,
    needsWork: scores.length ? Math.min(...scores) : 0,
    distribution: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: scores.filter((s) => s === stars).length,
    })),
    categories: [], // per-category ratings not captured yet
    recent: rows.slice(0, 10).map((r) => {
      const stars = Number(r.rating);
      return {
        name: (r.customer?.full_name || "Customer").trim(),
        stars,
        label: RATING_LABELS[stars] || "",
        text: "",
        at: r.rated_at,
        ticket: r.ticket_number,
      };
    }),
  };
}
