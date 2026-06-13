import { useNavigate } from "react-router-dom";
import StatusBadge from "./StatusBadge.jsx";

const fmt = (d) => new Date(d).toLocaleString();

export default function TicketTable({ tickets }) {
  const nav = useNavigate();
  if (!tickets.length)
    return <p className="rounded border border-dashed border-slate-300 p-8 text-center text-slate-400">No requests yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-4 py-3">Ticket</th>
            <th className="px-4 py-3">Customer</th>
            <th className="px-4 py-3">Issue</th>
            <th className="px-4 py-3">Technician</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} onClick={() => nav(`/tickets/${t.id}`)}
              className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-3 font-mono font-semibold text-brand">{t.ticket_number}</td>
              <td className="px-4 py-3">
                <div className="font-medium">{t.customer?.full_name}</div>
                <div className="text-xs text-slate-400">{t.customer?.phone}</div>
              </td>
              <td className="px-4 py-3 max-w-xs truncate">{t.issue_description}</td>
              <td className="px-4 py-3">{t.technician?.full_name || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
              <td className="px-4 py-3 text-xs text-slate-400">{fmt(t.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
