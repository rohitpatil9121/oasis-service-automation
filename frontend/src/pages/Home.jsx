/* The Home report — the whole desk on one screen, for the owner.

   Everything is derived from the ticket list the board already loads, so the
   page costs one request and can never disagree with the board: if a figure
   looks wrong, the rows behind it are one click away.

   It is laid out as three questions, in the order an owner asks them:

     1. What is happening right now — is anything stuck, is anyone free?
     2. How is the month going — work done, money billed, who did it?
     3. Are customers happy?

   Read-only by design. Acting on any of it happens on the pages it links to.

   A number on its own is not a report, so the tiles carry a comparison: today
   against yesterday, this month against the same stretch of last month. The
   direction is an arrow and a word, never colour alone. */
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { Icon, Spinner } from "../components/ui.jsx";
import { Figure, RankedBars, DailyBars, Stat, Legend, Empty } from "../components/charts.jsx";
import { SERIES, money, shortMoney, istDay, istToday, lastDays } from "../lib/chart.js";
import { BUCKET_LABEL } from "../lib/boardBucket.js";

const REFRESH_MS = 30000;
const OPEN_BUCKETS = ["new", "pending", "assigned"];

/* When a job was finished. The column is the truth when it is set; the rest are
   what older rows left behind, in the order they were introduced. */
const closedAt = (t) =>
  t.closed_at || t.tech_work?.closed_at || t.tech_work?.paid_at ||
  (t.status === "CLOSED" ? t.updated_at : null);

const CALL_TYPE_LABEL = {
  service: "Service", warranty: "Warranty / AMC", repeat: "Repeat call",
  installation: "Installation", visit: "Visit only",
};

/** "12 more than yesterday" style comparison, or null when there is no basis. */
function delta(now, before, unit = "") {
  if (before == null) return null;
  const d = now - before;
  if (!before && !now) return null;
  if (d === 0) return { direction: "flat", text: "same" };
  const size = unit === "money" ? shortMoney(Math.abs(d)) : Math.abs(d);
  return { direction: d > 0 ? "up" : "down", text: String(size) };
}

function SectionHead({ children, hint, action }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-baseline justify-between gap-2 first:mt-0">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-slate-700">{children}</h2>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      {action}
    </div>
  );
}

const boardLink = (to, label) => (
  <Link to={to}
    className="inline-flex min-h-[44px] items-center rounded-md px-1 text-xs font-semibold text-brand transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:min-h-0 sm:py-0.5">
    {label} →
  </Link>
);

export default function Home() {
  const [tickets, setTickets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [at, setAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const { tickets: rows } = await api.listTickets();
      setTickets(rows || []);
      setAt(new Date());
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!loaded) {
    return <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-24"><Spinner className="h-7 w-7" /></div>;
  }

  /* ---------------------------------------------------------------- dates -- */
  const today = istToday();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const thisMonth = today.slice(0, 7);
  const dayOfMonth = +today.slice(8);
  const lastMonth = (() => {
    const [y, m] = thisMonth.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const days = lastDays(14);

  /* ------------------------------------------------------------- the work -- */
  const open = tickets.filter((t) => OPEN_BUCKETS.includes(t.board_bucket));
  const unassigned = open.filter((t) => !t.technician);
  const stuck = tickets.filter((t) => t.board_bucket === "pending");

  const closedOn = (d) => tickets.filter((t) => istDay(closedAt(t)) === d);
  const closedToday = closedOn(today);
  const closedYesterday = closedOn(yesterday);

  const inMonth = (month, upToDay) => tickets.filter((t) => {
    const d = istDay(closedAt(t));
    return d?.startsWith(month) && (upToDay == null || +d.slice(8) <= upToDay);
  });
  const monthJobs = inMonth(thisMonth);
  // Compare like with like: the same stretch of last month, not its whole run.
  const lastMonthSoFar = inMonth(lastMonth, dayOfMonth);

  const billed = (rows) => rows.reduce((s, t) => s + (Number(t.tech_work?.total) || 0), 0);
  const billedMonth = billed(monthJobs);
  const billedLastMonthSoFar = billed(lastMonthSoFar);
  const billedToday = billed(closedToday);

  const rated = tickets.filter((t) => t.rating != null);
  const avg = (rows) => rows.length ? rows.reduce((s, t) => s + Number(t.rating), 0) / rows.length : null;
  const avgAll = avg(rated);
  const avgMonth = avg(monthJobs.filter((t) => t.rating != null));

  const raisedPerDay = days.map((d) => tickets.filter((t) => istDay(t.created_at) === d).length);
  const closedPerDay = days.map((d) => closedOn(d).length);

  /* One measure across categories, so ONE hue — a colour per bar would only be
     restating the label printed beside it. */
  const bucketRows = OPEN_BUCKETS.concat("service_done").map((k) => ({
    label: BUCKET_LABEL[k],
    value: tickets.filter((t) => t.board_bucket === k).length,
    color: SERIES[0],
  }));

  const byTech = new Map();
  for (const t of tickets) {
    const id = t.technician?.id;
    if (!id) continue;
    if (!byTech.has(id)) byTech.set(id, { label: t.technician.full_name, open: 0, done: 0, billed: 0 });
    const row = byTech.get(id);
    if (OPEN_BUCKETS.includes(t.board_bucket)) row.open += 1;
    if ((istDay(closedAt(t)) || "").startsWith(thisMonth)) {
      row.done += 1;
      row.billed += Number(t.tech_work?.total) || 0;
    }
  }
  const techs = [...byTech.values()];
  const openByTech = techs.filter((r) => r.open).sort((a, b) => b.open - a.open)
    .map((r) => ({ label: r.label, value: r.open, color: SERIES[0] }));
  const doneByTech = techs.filter((r) => r.done).sort((a, b) => b.done - a.done).slice(0, 8)
    .map((r) => ({ label: r.label, value: r.done, color: SERIES[1] }));
  const billedByTech = techs.filter((r) => r.billed).sort((a, b) => b.billed - a.billed).slice(0, 8)
    .map((r) => ({ label: r.label, value: r.billed, display: shortMoney(r.billed), color: SERIES[2] }));

  const typeCounts = {};
  for (const t of monthJobs) {
    const k = t.tech_work?.call_type ?? t.tech_work?.charge;
    if (k) typeCounts[k] = (typeCounts[k] || 0) + 1;
  }
  const typeRows = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: CALL_TYPE_LABEL[k] || k, value: v, color: SERIES[0] }));

  const ratingRows = [5, 4, 3, 2, 1].map((n) => ({
    label: "★".repeat(n),
    value: rated.filter((t) => Number(t.rating) === n).length,
    color: n >= 4 ? SERIES[1] : n === 3 ? SERIES[2] : SERIES[4],
  }));
  const unhappy = rated.filter((t) => Number(t.rating) <= 2).length;

  const stamp = at?.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="pb-4">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Oasis Globe · Service Desk</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Today at a glance</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {stamp ? `Updated ${stamp} · refreshes on its own` : "Live from the board"}
          </p>
        </div>
        <button type="button" onClick={load}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
          <Icon name="refresh" className="h-4 w-4" /> Refresh
        </button>
      </header>

      {err && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {err} — showing the last figures loaded.
        </div>
      )}

      {/* ---------------------------------------------------- right now ---- */}
      <SectionHead hint="what the desk looks like this minute" action={boardLink("/requests", "Open the board")}>
        Right now
      </SectionHead>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Open jobs" value={open.length} accent={SERIES[0]}
          sub={`${tickets.filter((t) => t.board_bucket === "assigned").length} with a technician`} />
        <Stat label="Nobody assigned" value={unassigned.length} accent={SERIES[4]}
          sub={unassigned.length ? "needs someone today" : "everything is allocated"} />
        <Stat label="In Pending" value={stuck.length} accent={SERIES[2]}
          sub="carry-over, reopened & incomplete" />
        <Stat label="Finished today" value={closedToday.length} accent={SERIES[1]}
          delta={delta(closedToday.length, closedYesterday.length)}
          sub={billedToday ? `${money(billedToday)} billed today` : "nothing billed yet"} />
      </div>

      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-3">
        <Figure className="lg:col-span-2" title="Coming in and going out"
          sub="Last 14 days. While the two bars stay level, the desk is keeping up.">
          <DailyBars days={days} series={[
            { label: "Raised", color: SERIES[0], values: raisedPerDay },
            { label: "Finished", color: SERIES[1], values: closedPerDay },
          ]} />
        </Figure>

        <div className="grid gap-2.5">
          <Figure title="Where the work sits" sub="Requests by board column">
            <RankedBars rows={bucketRows} empty="No open requests on the board." />
          </Figure>
          <Figure title="Work in hand" sub="Open jobs, by technician">
            <RankedBars rows={openByTech} empty="Nobody is carrying an open job." />
          </Figure>
        </div>
      </div>

      {/* ------------------------------------------------- this month ------ */}
      <SectionHead hint={`1–${dayOfMonth} ${new Date().toLocaleDateString("en-IN", { month: "long", timeZone: "Asia/Kolkata" })}, against the same days last month`}>
        This month
      </SectionHead>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Jobs finished" value={monthJobs.length} accent={SERIES[1]}
          delta={delta(monthJobs.length, lastMonthSoFar.length)}
          sub={`${lastMonthSoFar.length} by this date last month`} />
        <Stat label="Billed" value={shortMoney(billedMonth)} accent={SERIES[2]}
          delta={delta(billedMonth, billedLastMonthSoFar, "money")}
          sub={money(billedMonth)} />
        <Stat label="Average bill" value={monthJobs.length ? shortMoney(billedMonth / monthJobs.length) : "—"}
          accent={SERIES[3]} sub="per finished job" />
        <Stat label="Installations" value={monthJobs.filter((t) => t.installation).length} accent={SERIES[3]}
          sub="new machines fitted this month" />
      </div>

      <div className="mt-2.5 grid gap-2.5 lg:grid-cols-3">
        <Figure title="Finished this month" sub="Jobs closed, by technician">
          <RankedBars rows={doneByTech} empty="No jobs closed yet this month." />
        </Figure>
        <Figure title="Billed this month" sub="From the bills each technician wrote">
          <RankedBars rows={billedByTech} empty="No bills written yet this month." />
        </Figure>
        <Figure title="What kind of work" sub="Call type on this month's bills">
          <RankedBars rows={typeRows} empty="No bills to read a call type from." />
        </Figure>
      </div>

      {/* ---------------------------------------------------- customers ---- */}
      <SectionHead hint="every rating a customer has sent back">Customers</SectionHead>

      <div className="grid gap-2.5 lg:grid-cols-3">
        <div className="grid gap-2.5">
          <Stat label="Average rating" value={avgAll ? avgAll.toFixed(1) : "—"} accent={SERIES[1]}
            delta={avgMonth && avgAll ? delta(Math.round(avgMonth * 10), Math.round(avgAll * 10)) : null}
            sub={`${rated.length} customers rated${avgMonth ? ` · ${avgMonth.toFixed(1)} this month` : ""}`} />
          <Stat label="Unhappy customers" value={unhappy} accent={SERIES[4]}
            sub={unhappy ? "rated 1 or 2 stars — worth a call" : "nobody rated below 3 stars"} />
        </div>
        <Figure className="lg:col-span-2" title="How customers rated us" sub="Every rating received">
          {rated.length ? (
            <>
              <RankedBars rows={ratingRows} />
              <div className="mt-3">
                <Legend items={[
                  { label: "4–5 stars", color: SERIES[1] },
                  { label: "3 stars", color: SERIES[2] },
                  { label: "1–2 stars", color: SERIES[4] },
                ]} />
              </div>
            </>
          ) : (
            <Empty>No ratings yet. They arrive by WhatsApp ten minutes after a job is closed.</Empty>
          )}
        </Figure>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
        <Icon name="refresh" className="h-3.5 w-3.5" />
        Every figure covers all {tickets.length} requests on the board.
      </p>
    </div>
  );
}
