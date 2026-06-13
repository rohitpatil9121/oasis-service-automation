import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.jsx";
import AssignModal from "../components/AssignModal.jsx";

const fmt = (d) => new Date(d).toLocaleString();
const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "CLOSED", "CANCELLED"];

export default function TicketView() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [history, setHistory] = useState({ events: [], assignments: [] });
  const [showAssign, setShowAssign] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [{ ticket }, h] = await Promise.all([api.getTicket(id), api.getHistory(id)]);
      setTicket(ticket); setHistory(h); setErr("");
    } catch (e) { setErr(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(s) {
    try { await api.setStatus(id, s); await load(); } catch (e) { setErr(e.message); }
  }

  if (err) return <p className="rounded bg-red-50 p-3 text-red-600">{err}</p>;
  if (!ticket) return <p className="text-slate-400">Loading…</p>;

  return (
    <div>
      <Link to="/" className="text-sm text-brand hover:underline">← Back to inbox</Link>

      <div className="mt-3 grid gap-5 md:grid-cols-3">
        {/* Main */}
        <div className="md:col-span-2 space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-xl font-bold text-brand">{ticket.ticket_number}</h2>
              <StatusBadge status={ticket.status} />
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Customer" value={ticket.customer?.full_name} />
              <Field label="Phone" value={ticket.customer?.phone} />
              <Field label="Address" value={ticket.customer?.address || "—"} full />
              <Field label="Issue" value={ticket.issue_description} full />
              <Field label="Source" value={ticket.source} />
              <Field label="Created" value={fmt(ticket.created_at)} />
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="mb-3 font-semibold">Assignment history</h3>
            {history.assignments.length === 0 ? (
              <p className="text-sm text-slate-400">Not assigned yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {history.assignments.map((a) => (
                  <li key={a.id} className="flex justify-between border-b border-slate-100 pb-2">
                    <span><b>{a.technician?.full_name}</b>{a.note ? ` — ${a.note}` : ""}</span>
                    <span className="text-slate-400">{fmt(a.assigned_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="mb-3 font-semibold">Activity log</h3>
            <ul className="space-y-2 text-sm">
              {history.events.map((e) => (
                <li key={e.id} className="flex justify-between border-b border-slate-100 pb-2">
                  <span>
                    <span className="font-medium">{e.event_type}</span>
                    {e.to_status ? ` → ${e.to_status}` : ""}
                    {e.actor?.full_name ? ` by ${e.actor.full_name}` : " (system/customer)"}
                  </span>
                  <span className="text-slate-400">{fmt(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Side actions */}
        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="mb-3 font-semibold">Technician</h3>
            <p className="mb-3 text-sm">
              {ticket.technician ? (
                <><b>{ticket.technician.full_name}</b><br />
                  <span className="text-slate-400">{ticket.technician.phone}</span></>
              ) : <span className="text-slate-400">Unassigned</span>}
            </p>
            <button onClick={() => setShowAssign(true)}
              className="w-full rounded bg-brand py-2 font-medium text-white hover:bg-brand-dark">
              {ticket.technician ? "Reassign" : "Assign technician"}
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="mb-3 font-semibold">Update status</h3>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <button key={s} onClick={() => changeStatus(s)} disabled={s === ticket.status}
                  className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-40">
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {showAssign && (
        <AssignModal ticket={ticket} onClose={() => setShowAssign(false)}
          onAssigned={() => { setShowAssign(false); load(); }} />
      )}
    </div>
  );
}

function Field({ label, value, full }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
