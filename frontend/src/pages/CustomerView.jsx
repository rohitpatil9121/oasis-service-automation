import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.jsx";
import { Card, Icon, Spinner, Alert } from "../components/ui.jsx";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS"];

export default function CustomerView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [err, setErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { customer, tickets } = await api.getCustomer(id);
      setCustomer(customer); setTickets(tickets || []); setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!loaded) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>;
  if (err && !customer) return <div><BackLink /><div className="mt-3"><Alert>{err}</Alert></div></div>;
  if (!customer) return <div><BackLink /><div className="mt-3"><Alert>Client not found.</Alert></div></div>;

  const initials = (customer.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const total = tickets.length;
  const solved = tickets.filter((t) => t.status === "CLOSED").length;
  const open = tickets.filter((t) => OPEN.includes(t.status)).length;
  const cancelled = tickets.filter((t) => t.status === "CANCELLED").length;

  return (
    <div>
      <BackLink />

      {/* Header */}
      <div className="mt-3 mb-5 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-base font-bold text-brand">{initials}</span>
        <div>
          <h1 className="text-xl font-bold leading-tight text-slate-900">{customer.full_name || "Client"}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-mono">{customer.phone}</span>
            {customer.address && <span className="text-slate-400">· {customer.address}</span>}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total requests" value={total} color="slate" />
        <Stat label="Solved" value={solved} color="emerald" />
        <Stat label="Open" value={open} color="amber" />
        <Stat label="Cancelled" value={cancelled} color="slate" />
      </div>

      {/* History */}
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Request history</h2>
      {tickets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-400">No requests yet.</p>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Ticket</th>
                  <th className="px-4 py-3 font-semibold">Issue</th>
                  <th className="px-4 py-3 font-semibold">Appliance</th>
                  <th className="px-4 py-3 font-semibold">Technician</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tickets.map((t) => (
                  <tr key={t.id} onClick={() => navigate(`/tickets/${t.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-brand">{t.ticket_number}</td>
                    <td className="max-w-[16rem] truncate px-4 py-3 text-slate-600">{t.issue_description || <span className="italic text-slate-300">—</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{t.appliance || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{t.technician?.full_name || <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-slate-400">{fmt(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

const STAT_COLOR = {
  slate: "text-slate-700", emerald: "text-emerald-600", amber: "text-amber-600",
};
function Stat({ label, value, color }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-bold ${STAT_COLOR[color]}`}>{value}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/clients" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
      <Icon name="back" /> Back to clients
    </Link>
  );
}
