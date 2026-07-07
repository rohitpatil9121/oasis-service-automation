import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import TicketTable from "../components/TicketTable.jsx";
import NewTicketModal from "../components/NewTicketModal.jsx";
import { Button, Icon, Spinner } from "../components/ui.jsx";
import { ICON_BG, RING, ACCENT } from "../lib/status.js";
import { DASHBOARD_BUCKETS, BUCKET_HINT } from "../lib/boardBucket.js";

const REFRESH_MS = 8000;

export default function Dashboard() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState("new");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const search = params.get("q") || "";

  const load = useCallback(async () => {
    try {
      const { tickets: rows } = await api.listTickets();
      setTickets(rows);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const countFor = (key) => {
    if (!key) return tickets.filter((t) => t.board_bucket !== "cancelled").length;
    return tickets.filter((t) => t.board_bucket === key).length;
  };

  const hintFor = (key) => {
    if (key) return BUCKET_HINT[key] || "";
    return `${tickets.length} total`;
  };

  const visible = tickets.filter((t) => {
    if (filter && t.board_bucket !== filter) return false;
    if (filter === "" && t.board_bucket === "cancelled") return false;
    if (!search) return true;
    const query = search.toLowerCase();
    return (
      t.ticket_number?.toLowerCase().includes(query) ||
      t.customer?.full_name?.toLowerCase().includes(query) ||
      t.customer?.phone?.includes(query) ||
      t.issue_description?.toLowerCase().includes(query)
    );
  });

  const activeLabel = DASHBOARD_BUCKETS.find((s) => s.key === filter)?.label || "All requests";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Oasis Globe · Service Desk</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Service Requests</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-400">
            New → Pending → Assigned → Service Done → Completed
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            live
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}><Icon name="refresh" /> Refresh</Button>
          <Button onClick={() => setShowNew(true)}><Icon name="plus" /> New request</Button>
        </div>
      </div>

      {/* Board bucket KPIs */}
      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {DASHBOARD_BUCKETS.map((s) => (
          <Kpi
            key={s.key || "all"}
            label={s.label}
            value={countFor(s.key)}
            icon={s.icon}
            color={s.color}
            hint={hintFor(s.key)}
            active={filter === s.key}
            ring={RING[s.color]}
            onClick={() => setFilter(s.key)}
          />
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-700">{activeLabel}</h2>
        <span className="text-sm text-slate-400">· {visible.length}</span>
        {filter && (
          <FilterChip label={activeLabel} onClear={() => setFilter("")} />
        )}
        {search && (
          <FilterChip label={`“${search}”`} onClear={() => navigate("/")} />
        )}
      </div>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {!loaded
        ? <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-16"><Spinner className="h-7 w-7" /></div>
        : <TicketTable tickets={visible} emptyHint={search || filter ? "Try a different filter or search." : undefined} showBoard />}

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

function Kpi({ label, value, icon, color, hint, active, ring, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={active === undefined ? undefined : active}
      className={`relative flex min-h-[88px] flex-col justify-between overflow-hidden rounded-xl border bg-white p-3.5 text-left shadow-card transition hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
        active ? `border-transparent ring-2 ${ring}` : "border-slate-200"
      }`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${ACCENT[color]}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-1 text-2xl font-bold leading-none text-slate-900">{value}</div>
        </div>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ICON_BG[color]}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 truncate pl-1 text-[10px] leading-snug text-slate-400">{hint || " "}</div>
    </button>
  );
}
