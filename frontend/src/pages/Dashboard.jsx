import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import TicketTable from "../components/TicketTable.jsx";
import NewTicketModal from "../components/NewTicketModal.jsx";

const FILTERS = ["", "NEW", "ASSIGNED", "IN_PROGRESS", "CLOSED"];
const LABEL = { "": "All", NEW: "New", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", CLOSED: "Closed" };

export default function Dashboard() {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const { tickets } = await api.listTickets(filter || undefined);
      setTickets(tickets); setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [filter]);

  // Live inbox: poll every 8s.
  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const counts = tickets.reduce((a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a), {});

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Incoming requests</h2>
          <p className="text-sm text-slate-400">Live inbox · refreshes automatically</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">
            ↻ Refresh
          </button>
          <button onClick={() => setShowNew(true)}
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
            + New request
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${filter === f ? "bg-brand text-white" : "bg-white text-slate-600 border border-slate-200"}`}>
            {LABEL[f]}{f && counts[f] ? ` (${counts[f]})` : ""}
          </button>
        ))}
      </div>

      {err && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{err}</p>}
      {loading ? <p className="text-slate-400">Loading…</p> : <TicketTable tickets={tickets} />}

      {showNew && (
        <NewTicketModal onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }} />
      )}
    </div>
  );
}
