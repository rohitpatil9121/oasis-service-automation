import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import TicketTable from "../components/TicketTable.jsx";
import NewTicketModal from "../components/NewTicketModal.jsx";
import { Button, Icon, Input } from "../components/ui.jsx";

const REFRESH_MS = 8000;

const STATS = [
  { key: "", label: "All", accent: "text-slate-700", ring: "ring-slate-300" },
  { key: "NEW", label: "New", accent: "text-blue-600", ring: "ring-blue-400" },
  { key: "ASSIGNED", label: "Assigned", accent: "text-amber-600", ring: "ring-amber-400" },
  { key: "IN_PROGRESS", label: "In progress", accent: "text-violet-600", ring: "ring-violet-400" },
  { key: "CLOSED", label: "Closed", accent: "text-emerald-600", ring: "ring-emerald-400" },
];

export default function Dashboard() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [showNew, setShowNew] = useState(false);

  // Always load ALL tickets so the stat counts stay accurate; filter client-side.
  const load = useCallback(async () => {
    try {
      const { tickets } = await api.listTickets();
      setTickets(tickets);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const counts = tickets.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});
  const countFor = (k) => (k ? counts[k] || 0 : tickets.length);

  const visible = tickets.filter((t) => {
    if (filter && t.status !== filter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.ticket_number?.toLowerCase().includes(q) ||
      t.customer?.full_name?.toLowerCase().includes(q) ||
      t.customer?.phone?.includes(q) ||
      t.issue_description?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Service Requests</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-400">
            Live inbox
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            auto-refreshing
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}><Icon name="refresh" /> Refresh</Button>
          <Button onClick={() => setShowNew(true)}><Icon name="plus" /> New request</Button>
        </div>
      </div>

      {/* Stat cards = clickable filters */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STATS.map((s) => (
          <button key={s.key} onClick={() => setFilter(s.key)}
            className={`rounded-xl border bg-white p-4 text-left shadow-card transition hover:shadow-pop ${
              filter === s.key ? `border-transparent ring-2 ${s.ring}` : "border-slate-200"
            }`}>
            <div className={`text-2xl font-bold ${s.accent}`}>{countFor(s.key)}</div>
            <div className="mt-0.5 text-xs font-medium text-slate-500">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4 relative max-w-sm">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon name="search" />
        </span>
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticket #, name, phone, issue…" className="pl-9" />
      </div>

      {err && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {!loaded
        ? <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-slate-400">Loading…</div>
        : <TicketTable tickets={visible} emptyHint={search || filter ? "Try a different filter or search." : undefined} />}

      {showNew && (
        <NewTicketModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}
