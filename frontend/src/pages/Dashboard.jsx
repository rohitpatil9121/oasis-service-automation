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
  const [tech, setTech] = useState("");        // "" = everyone, "unassigned", or a technician id
  const [sort, setSort] = useState("");        // "" = newest first (the order the API returns)
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

  /* Installation is not a board bucket — see the note in lib/boardBucket.js.
     It is a mark a ticket carries in addition to its bucket, set when the
     technician picks "Installation" as the call type while writing the bill.
     Cancelled jobs are left out: a call that was called off installed nothing. */
  const inBucket = (t, key) =>
    key === "installation" ? t.installation && t.board_bucket !== "cancelled" : t.board_bucket === key;

  /* The technician filter sits ACROSS the board columns rather than replacing
     them: pick Assigned and a name to see what that technician has in hand right
     now, or All requests and a name to see everything ever put on him. The card
     counts follow the chosen technician too, so the numbers always describe the
     list underneath them.

     "unassigned" is an option in its own right — on a busy morning the question
     is usually which requests have nobody on them yet. */
  const onTech = (t) =>
    !tech || (tech === "unassigned" ? !t.technician : t.technician?.id === tech);

  const countFor = (key) => {
    const pool = tickets.filter(onTech);
    if (!key) return pool.filter((t) => t.board_bucket !== "cancelled").length;
    return pool.filter((t) => inBucket(t, key)).length;
  };

  /* Who to offer, built from the tickets already on screen rather than a second
     request: a technician with nothing on the board is nothing to look at. The
     count beside each name is for the column currently selected, so it answers
     "how many does he have HERE" rather than a total that matches nothing. */
  const technicianOptions = (() => {
    const inColumn = tickets.filter((t) => (filter ? inBucket(t, filter) : t.board_bucket !== "cancelled"));
    const byId = new Map();
    for (const t of tickets) {
      if (!t.technician?.id) continue;
      if (!byId.has(t.technician.id)) byId.set(t.technician.id, { id: t.technician.id, name: t.technician.full_name, count: 0 });
    }
    for (const t of inColumn) if (t.technician?.id && byId.has(t.technician.id)) byId.get(t.technician.id).count += 1;
    const list = [...byId.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const unassigned = inColumn.filter((t) => !t.technician).length;
    return { list, unassigned };
  })();

  const hintFor = (key) => {
    if (key) return BUCKET_HINT[key] || "";
    return `${tickets.length} total`;
  };

  const visible = tickets.filter((t) => {
    if (!onTech(t)) return false;
    if (filter && !inBucket(t, filter)) return false;
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

  /* Sorting the visible list.

     Request numbers read OG-DDMMYY-NNNN, so comparing them as text puts
     OG-140826 before OG-170626 — August ahead of June, because the day leads.
     Pull the parts out and compare them in the order that means something.
     Anything that does not match the pattern falls back to when it was raised,
     which is the same order the numbers were handed out in. */
  const idKey = (t) => {
    const m = /^OG-(\d{2})(\d{2})(\d{2})-(\d+)$/.exec(t.ticket_number || "");
    if (!m) return [0, 0, 0, 0, new Date(t.created_at || 0).getTime()];
    const [, dd, mm, yy, seq] = m;
    return [+yy, +mm, +dd, +seq, 0];
  };
  const cmpArr = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

  /* The bill lives on tech_work.total and is simply absent until the technician
     writes one — most open jobs have none. Those rows sink to the bottom either
     way rather than crowding the top of "lowest first" with a wall of blanks:
     someone sorting by amount is asking about money, and a job with no bill has
     no answer to give. */
  const billOf = (t) => {
    const v = t.tech_work?.total;
    return v === null || v === undefined || v === "" ? null : Number(v) || 0;
  };

  /* Direction is a multiplier, NOT swapped arguments. Swapping them reverses
     the "no bill goes last" rule along with everything else, which put a block
     of blank amounts at the top of "highest first" — the one place a person
     sorting by money is certainly looking. */
  function billCmp(a, b, dir) {
    const x = billOf(a), y = billOf(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * dir;
  }

  const SORTS = {
    "": { label: "Newest first", fn: null },
    bill_desc: { label: "Bill · highest first", fn: (a, b) => billCmp(a, b, -1) },
    bill_asc: { label: "Bill · lowest first", fn: (a, b) => billCmp(a, b, 1) },
    id_desc: { label: "Request no. · newest first", fn: (a, b) => cmpArr(idKey(b), idKey(a)) },
    id_asc: { label: "Request no. · oldest first", fn: (a, b) => cmpArr(idKey(a), idKey(b)) },
  };

  const sorted = SORTS[sort]?.fn ? [...visible].sort(SORTS[sort].fn) : visible;

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
      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
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

        <label className="ml-1 flex items-center gap-1.5">
          <span className="sr-only">Filter by technician</span>
          <Icon name="user" className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={tech}
            onChange={(e) => setTech(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white py-1 pl-2 pr-7 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            <option value="">All technicians</option>
            {technicianOptions.unassigned > 0 && (
              <option value="unassigned">Unassigned · {technicianOptions.unassigned}</option>
            )}
            {technicianOptions.list.map((t) => (
              <option key={t.id} value={t.id}>{t.name} · {t.count}</option>
            ))}
          </select>
        </label>

        {filter && (
          <FilterChip label={activeLabel} onClear={() => setFilter("")} />
        )}
        {tech && (
          <FilterChip
            label={tech === "unassigned" ? "Unassigned" : (technicianOptions.list.find((t) => t.id === tech)?.name || "Technician")}
            onClear={() => setTech("")}
          />
        )}
        {search && (
          <FilterChip label={`“${search}”`} onClear={() => navigate("/requests")} />
        )}

        <label className="ml-auto flex items-center gap-1.5">
          <span className="sr-only">Sort requests</span>
          <Icon name="chevron" className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white py-1 pl-2 pr-7 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            {Object.entries(SORTS).map(([key, s]) => (
              <option key={key || "default"} value={key}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {!loaded ? (
        <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-16"><Spinner className="h-7 w-7" /></div>
      ) : (
        <TicketTable tickets={sorted} emptyHint={search || filter ? "Try a different filter or search." : undefined} showBoard />
      )}

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
