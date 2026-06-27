import { useNavigate, Link } from "react-router-dom";
import StatusBadge from "./StatusBadge.jsx";
import RatingStars from "./RatingStars.jsx";
import { EmptyState, timeAgo } from "./ui.jsx";
import { isUnread } from "../lib/notify.js";

// Shared status pill — the live "Collecting…" state while WhatsApp intake runs,
// otherwise the normal badge.
function StatusCell({ t }) {
  if (t.intake_complete === false && t.status === "NEW") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />Collecting
      </span>
    );
  }
  return <StatusBadge status={t.status} />;
}

export default function TicketTable({ tickets, emptyHint }) {
  const nav = useNavigate();
  if (!tickets.length)
    return <EmptyState title="No requests here" hint={emptyHint || "New WhatsApp requests will show up automatically."} />;

  return (
    <>
      {/* ---------- Mobile: stacked cards (no horizontal scroll) ---------- */}
      <ul className="space-y-2.5 sm:hidden">
        {tickets.map((t) => {
          const unread = isUnread(t);
          return (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`}
                className={`block rounded-xl border bg-white p-3.5 shadow-card transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${unread ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-brand">
                    {unread && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
                    {t.ticket_number}
                  </span>
                  <StatusCell t={t} />
                </div>
                <div className={`mt-1.5 text-slate-800 ${unread ? "font-bold" : "font-medium"}`}>
                  {t.customer?.full_name || "—"}
                </div>
                <div className="truncate text-sm text-slate-600">
                  {t.issue_description || <span className="italic text-slate-300">Collecting info…</span>}
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                  <span>{t.technician?.full_name || "Unassigned"}</span>
                  <span className="flex items-center gap-2">
                    {t.rating != null && <RatingStars value={t.rating} />}
                    <span>{timeAgo(t.created_at)}</span>
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* ---------- Desktop: table ---------- */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-semibold">Ticket</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Issue</th>
                <th className="px-4 py-3 font-semibold">Technician</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Rating</th>
                <th className="px-4 py-3 text-right font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.map((t) => {
                const unread = isUnread(t);
                return (
                  <tr key={t.id} onClick={() => nav(`/tickets/${t.id}`)}
                    className={`cursor-pointer transition hover:bg-slate-50 ${unread ? "bg-emerald-50/60" : ""}`}>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-brand">
                      {/* Real link: keyboard-focusable, middle/⌘-click opens a new tab.
                          stopPropagation so the row's onClick doesn't double-fire. */}
                      <Link to={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                        {unread && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" title="New customer message" />}
                        {t.ticket_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className={`text-slate-800 ${unread ? "font-bold" : "font-medium"}`}>
                        {t.customer?.full_name || "—"}
                        {unread && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-emerald-700">New</span>}
                      </div>
                      <div className="font-mono text-xs text-slate-400">{t.customer?.phone}</div>
                    </td>
                    <td className="max-w-[18rem] truncate px-4 py-3 text-slate-600">
                      {t.issue_description || <span className="italic text-slate-300">Collecting info…</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {t.technician?.full_name || <span className="text-slate-300">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3"><StatusCell t={t} /></td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {t.rating != null ? <RatingStars value={t.rating} /> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-slate-400">{timeAgo(t.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
