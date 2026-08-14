/* The Home report — the whole desk on one screen.

   Everything here is derived from the ticket list the board already loads, so
   the page costs one request and can never disagree with the board: if a figure
   here looks wrong, the rows behind it are one click away.

   Deliberately read-only. It answers "how are we doing" — what is open, what
   came in and went out, who is carrying it, what we billed, how customers rated
   it. Acting on any of it happens on the pages it links to. */
import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { Icon, Spinner } from "../components/ui.jsx";
import { Figure, RankedBars, DailyBars, Stat, Legend } from "../components/charts.jsx";
import { SERIES, money, shortMoney, istDay, istToday, lastDays } from "../lib/chart.js";
import { BUCKET_LABEL } from "../lib/boardBucket.js";

const REFRESH_MS = 30000;

/* When a job was finished. The column is the truth when it is set; the rest are
   what older rows left behind, in the order they were introduced. */
const closedAt = (t) =>
  t.closed_at || t.tech_work?.closed_at || t.tech_work?.paid_at ||
  (t.status === "CLOSED" ? t.updated_at : null);

const CALL_TYPE_LABEL = {
  service: "Service", warranty: "Warranty / AMC", repeat: "Repeat call",
  installation: "Installation", visit: "Visit only",
};

export default function Home() {
  const [tickets, setTickets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const { tickets: rows } = await api.listTickets();
      setTickets(rows || []);
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

  const today = istToday();
  const monthPrefix = today.slice(0, 7);
  const days = lastDays(14);

  /* ---- the numbers ---- */
  const open = tickets.filter((t) => ["new", "pending", "assigned"].includes(t.board_bucket));
  const closedToday = tickets.filter((t) => istDay(closedAt(t)) === today);
  const closedThisMonth = tickets.filter((t) => (istDay(closedAt(t)) || "").startsWith(monthPrefix));

  const billedThisMonth = closedThisMonth.reduce((s, t) => s + (Number(t.tech_work?.total) || 0), 0);
  const billedToday = closedToday.reduce((s, t) => s + (Number(t.tech_work?.total) || 0), 0);

  const rated = tickets.filter((t) => t.rating != null);
  const ratedThisMonth = rated.filter((t) => (istDay(closedAt(t)) || "").startsWith(monthPrefix));
  const avgRating = rated.length
    ? (rated.reduce((s, t) => s + Number(t.rating), 0) / rated.length).toFixed(1)
    : "—";

  const raisedPerDay = days.map((d) => tickets.filter((t) => istDay(t.created_at) === d).length);
  const closedPerDay = days.map((d) => tickets.filter((t) => istDay(closedAt(t)) === d).length);

  /* One measure (a count) across categories, so ONE hue. Giving each bar its own
     colour would suggest the colours mean something; they would only be
     restating the label that is already printed beside them. */
  const bucketRows = ["new", "pending", "assigned", "service_done"].map((k) => ({
    label: BUCKET_LABEL[k],
    value: tickets.filter((t) => t.board_bucket === k).length,
    color: SERIES[0],
  }));

  /* Who is carrying the work: open jobs in hand right now. Closed-this-month
     sits beside it as the second figure rather than on a second axis — one axis
     per chart, always; two lengths that mean different things do not belong on
     the same scale. */
  const byTech = new Map();
  for (const t of tickets) {
    const id = t.technician?.id;
    if (!id) continue;
    if (!byTech.has(id)) byTech.set(id, { label: t.technician.full_name, open: 0, done: 0, billed: 0 });
    const row = byTech.get(id);
    if (["new", "pending", "assigned"].includes(t.board_bucket)) row.open += 1;
    if ((istDay(closedAt(t)) || "").startsWith(monthPrefix)) {
      row.done += 1;
      row.billed += Number(t.tech_work?.total) || 0;
    }
  }
  const techs = [...byTech.values()];
  const openByTech = techs.filter((r) => r.open).sort((a, b) => b.open - a.open)
    .map((r) => ({ label: r.label, value: r.open, color: SERIES[0] }));
  const doneByTech = techs.filter((r) => r.done).sort((a, b) => b.done - a.done).slice(0, 8)
    .map((r) => ({ label: r.label, value: r.done, display: `${r.done}`, color: SERIES[1] }));
  const billedByTech = techs.filter((r) => r.billed).sort((a, b) => b.billed - a.billed).slice(0, 8)
    .map((r) => ({ label: r.label, value: r.billed, display: shortMoney(r.billed), color: SERIES[2] }));

  const typeCounts = {};
  for (const t of closedThisMonth) {
    const k = t.tech_work?.call_type ?? t.tech_work?.charge;
    if (k) typeCounts[k] = (typeCounts[k] || 0) + 1;
  }
  const typeRows = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: CALL_TYPE_LABEL[k] || k, value: v, color: SERIES[0] }));

  const ratingRows = [5, 4, 3, 2, 1].map((n) => ({
    label: "★".repeat(n),
    value: rated.filter((t) => Number(t.rating) === n).length,
    color: n >= 4 ? SERIES[1] : n === 3 ? SERIES[2] : SERIES[4],
  }));

  const unassigned = tickets.filter((t) => !t.technician && ["new", "pending"].includes(t.board_bucket)).length;

  return (
    <div>
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Oasis Globe · Service Desk</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Today at a glance</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Everything below is live from the board and refreshes on its own.
        </p>
      </div>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* The four numbers worth knowing before anything else. */}
      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Stat label="Open right now" value={open.length} tone="blue"
          sub={unassigned ? `${unassigned} with nobody on them` : "all assigned"} />
        <Stat label="Finished today" value={closedToday.length} tone="emerald"
          sub={billedToday ? `${money(billedToday)} billed` : "nothing billed yet"} />
        <Stat label="Billed this month" value={shortMoney(billedThisMonth)} tone="slate"
          sub={`${closedThisMonth.length} jobs closed`} />
        <Stat label="Average rating" value={avgRating} tone="amber"
          sub={`${rated.length} customers rated · ${ratedThisMonth.length} this month`} />
      </div>

      <div className="grid gap-2.5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Figure
            title="Coming in and going out"
            sub="Last 14 days. If the bars stay level, the desk is keeping up."
            right={<Link to="/requests" className="text-xs font-medium text-brand hover:underline">Open the board →</Link>}>
            <DailyBars
              days={days}
              series={[
                { label: "Raised", color: SERIES[0], values: raisedPerDay },
                { label: "Finished", color: SERIES[1], values: closedPerDay },
              ]}
            />
          </Figure>
        </div>

        <Figure title="Where the work sits" sub="Requests by board column, right now">
          <RankedBars rows={bucketRows} />
          <div className="mt-3 border-t border-slate-100 pt-2">
            <Link to="/requests" className="text-xs font-medium text-brand hover:underline">See the requests →</Link>
          </div>
        </Figure>

        <Figure title="Work in hand" sub="Open jobs, by technician">
          <RankedBars rows={openByTech} />
        </Figure>

        <Figure title="Finished this month" sub="Jobs closed, by technician">
          <RankedBars rows={doneByTech} />
        </Figure>

        <Figure title="Billed this month" sub="By technician, from the bills they wrote">
          <RankedBars rows={billedByTech} />
        </Figure>

        <Figure title="What kind of work" sub="Call type on this month's bills">
          <RankedBars rows={typeRows} />
        </Figure>

        <Figure title="How customers rated us" sub="Every rating received">
          <RankedBars rows={ratingRows} />
          <div className="mt-3">
            <Legend items={[
              { label: "4–5 stars", color: SERIES[1] },
              { label: "3 stars", color: SERIES[2] },
              { label: "1–2 stars", color: SERIES[4] },
            ]} />
          </div>
        </Figure>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
        <Icon name="refresh" className="h-3.5 w-3.5" />
        Figures cover every request on the board, and update every 30 seconds.
      </p>
    </div>
  );
}
