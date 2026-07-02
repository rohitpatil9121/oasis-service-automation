// Technician performance incentives. Everything here is COMPUTED from closed
// tickets — nothing is written. Each closed ticket carries the technician's
// billing in tickets.tech_work ({ parts:[{id,name,price}], payments:[{method,
// amount}], total }); we look each part's brand/base_cost up in the parts
// catalog (stock_items) and apply the owner's incentive rules.
import { supabase } from "../config/supabase.js";

// ---- The incentive rules (single source of truth) ----
export const RULES = {
  BRAND_RATE: 0.06,        // Kent / Aquaguard: base rate on the part price
  BRAND_RATE_BONUS: 0.10,  // …bumped to this once the daily target is hit
  DAILY_TARGET: 10000,     // total billing in a day that unlocks the bonus rate
  GST_RATE: 0.18,          // cut from the Oasis margin on online payments
};
const ONLINE_METHODS = new Set(["upi", "credit card", "card", "online"]);
const round2 = (n) => Math.round(n * 100) / 100;

// Which payment mode to bill an Oasis margin against. A ticket is "online" when
// more was collected online than in cash; no payment recorded ⇒ treat as cash
// (no GST cut) so an un-collected job never under-pays the technician.
export function paymentMode(payments = []) {
  let online = 0, cash = 0;
  for (const p of payments) {
    const amt = Number(p.amount || 0);
    if (ONLINE_METHODS.has(String(p.method || "").toLowerCase())) online += amt;
    else cash += amt;
  }
  return online > cash ? "online" : "cash";
}

// Load every part's brand + base_cost into a lookup keyed by stock_items.id.
async function loadCatalog() {
  const { data, error } = await supabase
    .from("stock_items").select("id, name, brand, base_cost");
  if (error) throw new Error("loadCatalog: " + error.message);
  const map = new Map();
  for (const it of data || []) {
    map.set(it.id, { name: it.name, brand: it.brand || null, base_cost: Number(it.base_cost || 0) });
  }
  return map;
}

// Incentive for ONE part. brandRate is the day's rate for branded parts
// (0.06 or 0.10); mode is the ticket's payment mode for the Oasis GST cut.
export function partIncentive(part, catalog, brandRate, mode) {
  const meta = catalog.get(part.id) || {};
  const price = Number(part.price || 0);
  const brand = meta.brand;

  if (brand === "kent" || brand === "aquaguard") {
    return { brand, price, payout: round2(price * brandRate) };
  }
  if (brand === "oasis") {
    const margin = Math.max(0, price - Number(meta.base_cost || 0));
    const payout = mode === "online" ? margin * (1 - RULES.GST_RATE) : margin;
    return { brand, price, margin: round2(margin), payout: round2(payout) };
  }
  return { brand: brand || "other", price, payout: 0 }; // unbranded ⇒ no incentive
}

// Roll a single day's closed tickets into one technician payout. The daily
// target is checked first (sum of every ticket's grand total), which decides
// whether branded parts earn 6% or 10% for the WHOLE day (applied retroactively
// to every job, exactly as promised to the technician).
export function summariseDay(tickets, catalog) {
  const billing = tickets.reduce((s, t) => s + Number(t.tech_work?.total || 0), 0);
  const targetHit = billing >= RULES.DAILY_TARGET;
  const brandRate = targetHit ? RULES.BRAND_RATE_BONUS : RULES.BRAND_RATE;

  const jobs = [];
  let payout = 0;
  for (const t of tickets) {
    const work = t.tech_work || {};
    const mode = paymentMode(work.payments);
    const lines = (work.parts || []).map((p) => partIncentive(p, catalog, brandRate, mode));
    const jobPayout = lines.reduce((s, l) => s + l.payout, 0);
    payout += jobPayout;
    jobs.push({
      ticket_id: t.id,
      ticket_number: t.ticket_number,
      bill: Number(work.total || 0),
      payment_mode: mode,
      parts: lines,
      payout: round2(jobPayout),
    });
  }

  return {
    billing: round2(billing),
    target_hit: targetHit,
    brand_rate: brandRate,
    payout: round2(payout),
    jobs,
  };
}

// IST calendar day (YYYY-MM-DD) for an instant — the business runs on IST and
// the "daily 10k" window must match the owner's day, not UTC.
function istDate(iso) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// When a job actually billed: paid time, else work-done, else the technician's
// close time (stored inside tech_work — there is no tickets.closed_at column),
// else the ticket's created_at.
function billedAt(t) {
  const w = t.tech_work || {};
  return w.paid_at || w.work_done_at || w.closed_at || t.created_at;
}

// Fetch the closed/billed tickets for the window, optionally for one technician.
async function fetchBilledTickets({ techId, from, to } = {}) {
  let q = supabase
    .from("tickets")
    .select("id, ticket_number, assigned_technician_id, status, created_at, tech_work")
    .eq("status", "CLOSED");
  if (techId) q = q.eq("assigned_technician_id", techId);
  const { data, error } = await q;
  if (error) throw new Error("fetchBilledTickets: " + error.message);

  return (data || []).filter((t) => {
    if (!from && !to) return true;
    const d = istDate(billedAt(t));
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

// Group tickets by IST day → { date, ...daySummary }, newest day first.
function byDay(tickets, catalog) {
  const groups = new Map();
  for (const t of tickets) {
    const d = istDate(billedAt(t));
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(t);
  }
  return [...groups.entries()]
    .map(([date, ts]) => ({ date, ...summariseDay(ts, catalog) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---- Public API ----

// One technician's earnings over a window (defaults: all time). Returns the
// per-day breakdown plus a total, ready for the technician-app earnings screen.
export async function technicianEarnings(techId, { from, to } = {}) {
  const [catalog, tickets] = await Promise.all([
    loadCatalog(),
    fetchBilledTickets({ techId, from, to }),
  ]);
  const days = byDay(tickets, catalog);
  return {
    technician_id: techId,
    from: from || null,
    to: to || null,
    total_payout: round2(days.reduce((s, d) => s + d.payout, 0)),
    total_billing: round2(days.reduce((s, d) => s + d.billing, 0)),
    days,
  };
}

// Live progress toward today's 10k target — for the technician-app progress bar.
export async function todayProgress(techId) {
  const today = istDate(new Date().toISOString());
  const { days } = await technicianEarnings(techId, { from: today, to: today });
  const day = days[0] || { billing: 0, payout: 0, target_hit: false };
  return {
    date: today,
    billing: day.billing,
    target: RULES.DAILY_TARGET,
    remaining: Math.max(0, RULES.DAILY_TARGET - day.billing),
    target_hit: day.target_hit,
    rate: day.target_hit ? RULES.BRAND_RATE_BONUS : RULES.BRAND_RATE,
    payout_so_far: day.payout,
  };
}

// Owner/manager report: one row per technician for the window, with the day
// breakdown kept for drill-down on the dashboard.
export async function incentiveReport({ from, to } = {}) {
  const [catalog, tickets] = await Promise.all([
    loadCatalog(),
    fetchBilledTickets({ from, to }),
  ]);

  const { data: techs, error } = await supabase
    .from("users").select("id, full_name").eq("role", "technician");
  if (error) throw new Error("incentiveReport: " + error.message);
  const name = new Map((techs || []).map((u) => [u.id, u.full_name]));

  const perTech = new Map();
  for (const t of tickets) {
    const id = t.assigned_technician_id;
    if (!id) continue;
    if (!perTech.has(id)) perTech.set(id, []);
    perTech.get(id).push(t);
  }

  const rows = [...perTech.entries()].map(([id, ts]) => {
    const days = byDay(ts, catalog);
    return {
      technician_id: id,
      technician_name: name.get(id) || "Technician",
      total_billing: round2(days.reduce((s, d) => s + d.billing, 0)),
      total_payout: round2(days.reduce((s, d) => s + d.payout, 0)),
      days,
    };
  }).sort((a, b) => b.total_payout - a.total_payout);

  return {
    from: from || null,
    to: to || null,
    total_payout: round2(rows.reduce((s, r) => s + r.total_payout, 0)),
    technicians: rows,
  };
}
