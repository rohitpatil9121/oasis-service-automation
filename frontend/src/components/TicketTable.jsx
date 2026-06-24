import { useNavigate } from "react-router-dom";
import StatusBadge from "./StatusBadge.jsx";
import { EmptyState, timeAgo } from "./ui.jsx";
import { isUnread } from "../lib/notify.js";

export default function TicketTable({ tickets, emptyHint }) {
  const nav = useNavigate();
  if (!tickets.length)
    return <EmptyState title="No requests here" hint={emptyHint || "New WhatsApp requests will show up automatically."} />;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-semibold">Ticket</th>
              <th className="px-4 py-3 font-semibold">Customer</th>
              <th className="px-4 py-3 font-semibold">Issue</th>
              <th className="px-4 py-3 font-semibold">Technician</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tickets.map((t) => {
              const unread = isUnread(t);
              return (
              <tr key={t.id} onClick={() => nav(`/tickets/${t.id}`)}
                className={`cursor-pointer transition hover:bg-slate-50 ${unread ? "bg-emerald-50/60" : ""}`}>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-brand">
                  <span className="inline-flex items-center gap-1.5">
                    {unread && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" title="New customer message" />}
                    {t.ticket_number}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className={`text-slate-800 ${unread ? "font-bold" : "font-medium"}`}>
                    {t.customer?.full_name || "—"}
                    {unread && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 align-middle">New</span>}
                  </div>
                  <div className="font-mono text-xs text-slate-400">{t.customer?.phone}</div>
                </td>
                <td className="max-w-[18rem] truncate px-4 py-3 text-slate-600">
                  {t.issue_description || <span className="italic text-slate-300">Collecting info…</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {t.technician?.full_name || <span className="text-slate-300">Unassigned</span>}
                </td>
                <td className="px-4 py-3">
                  {t.intake_complete === false && t.status === "NEW"
                    ? <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />Collecting</span>
                    : <StatusBadge status={t.status} />}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-slate-400">{timeAgo(t.created_at)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
