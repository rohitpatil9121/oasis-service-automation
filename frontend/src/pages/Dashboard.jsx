import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import TicketTable from "../components/TicketTable.jsx";
import NewTicketModal from "../components/NewTicketModal.jsx";
import { Button, Icon, Spinner } from "../components/ui.jsx";
import { ICON_BG, RING } from "../lib/status.js";

const REFRESH_MS = 8000;

// Status KPI cards double as filters. Each has an icon + colour accent.
const STATS = [
  { key: "", label: "All requests", icon: "inbox", color: "slate" },
  { key: "NEW", label: "New", icon: "alert", color: "blue" },
  { key: "ASSIGNED", label: "Assigned", icon: "wrench", color: "amber" },
  { key: "IN_PROGRESS", label: "In progress", icon: "refresh", color: "violet" },
  { key: "CLOSED", label: "Closed", icon: "check", color: "emerald" },
];

export default function Dashboard() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState("");
  const [lowStock, setLowStock] = useState(null);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const search = params.get("q") || "";

  const load = useCallback(async () => {
    try {
      const { tickets } = await api.listTickets();
      setTickets(tickets);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  // Low-stock count for the KPI card (best-effort; ignore if stock not set up).
  const loadStock = useCallback(async () => {
    try {
      const { items } = await api.listStock();
      setLowStock(items.filter((i) => Number(i.qty_on_hand) <= Number(i.reorder_level)).length);
    } catch { setLowStock(null); }
  }, []);

  useEffect(() => {
    load(); loadStock();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load, loadStock]);

  const counts = tickets.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});
  const countFor = (k) => (k ? counts[k] || 0 : tickets.length);

  const visible = tickets.filter((t) => {
    if (filter && t.status !== filter) return false;
    if (!search) return true;
    const query = search.toLowerCase();
    return (
      t.ticket_number?.toLowerCase().includes(query) ||
      t.customer?.full_name?.toLowerCase().includes(query) ||
      t.customer?.phone?.includes(query) ||
      t.issue_description?.toLowerCase().includes(query)
    );
  });

  return (
    <div>
      {/* Page header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Oasis Globe · Service Desk</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Today's Operations</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-400">
            Live inbox of customer requests
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            auto-refreshing
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { load(); loadStock(); }}><Icon name="refresh" /> Refresh</Button>
          <Button onClick={() => setShowNew(true)}><Icon name="plus" /> New request</Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATS.map((s) => (
          <Kpi key={s.key} label={s.label} value={countFor(s.key)} icon={s.icon} color={s.color}
            active={filter === s.key} ring={RING[s.color]} onClick={() => setFilter(s.key)} />
        ))}
        <Kpi label="Low stock parts" value={lowStock ?? "—"} icon="box" color="orange"
          onClick={() => navigate("/stock")} />
      </div>

      {/* Requests table */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-700">
          {filter ? STATS.find((s) => s.key === filter)?.label : "All"} requests
        </h2>
        <span className="text-sm text-slate-400">· {visible.length}</span>
        {/* Active filters surface as removable chips so it's always clear what's
            being shown — and one click clears them. */}
        {filter && (
          <FilterChip label={STATS.find((s) => s.key === filter)?.label} onClear={() => setFilter("")} />
        )}
        {search && (
          <FilterChip label={`“${search}”`} onClear={() => navigate("/")} />
        )}
      </div>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {!loaded
        ? <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-16"><Spinner className="h-7 w-7" /></div>
        : <TicketTable tickets={visible} emptyHint={search || filter ? "Try a different filter or search." : undefined} />}

      {showNew && (
        <NewTicketModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}

function FilterChip({ label, onClear }) {
  return (
    <button onClick={onClear}
      className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand transition hover:bg-brand/20"
      aria-label={`Clear filter ${label}`}>
      {label}
      <Icon name="x" className="h-3 w-3" />
    </button>
  );
}

function Kpi({ label, value, icon, color, active, ring, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={active === undefined ? undefined : active}
      className={`flex items-start justify-between rounded-xl border bg-white p-4 text-left shadow-card transition hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
        active ? `border-transparent ring-2 ${ring}` : "border-slate-200"
      }`}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
      </div>
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${ICON_BG[color]}`}>
        <Icon name={icon} className="h-4 w-4" />
      </span>
    </button>
  );
}
