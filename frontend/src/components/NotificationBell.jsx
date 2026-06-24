import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { Icon, timeAgo } from "./ui.jsx";
import { isUnread, markSeen, beep, popup, requestNotifyPermission } from "../lib/notify.js";

const POLL_MS = 8000;

// Header notification bell: polls the ticket list, shows a red count of chats with
// new customer messages, and a dropdown to jump straight into them. Lives in the
// global Layout, so the sound + popup alert fire on EVERY page — not just the
// dashboard. The unread state itself comes from notify.js (seen tracked locally).
export default function NotificationBell() {
  const [tickets, setTickets] = useState([]);
  const [open, setOpen] = useState(false);
  const prevRef = useRef(null); // ticketId -> last_inbound_at from the previous poll
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      const { tickets } = await api.listTickets();
      // Fire a sound + browser popup when a customer messages since the last poll.
      const prev = prevRef.current;
      const curr = new Map();
      const fresh = [];
      for (const t of tickets) {
        if (!t.last_inbound_at) continue;
        curr.set(t.id, t.last_inbound_at);
        if (prev && (!prev.has(t.id) || new Date(t.last_inbound_at) > new Date(prev.get(t.id)))) fresh.push(t);
      }
      prevRef.current = curr;
      if (prev && fresh.length) { // skip the very first load
        beep();
        const t = fresh[0];
        popup(
          fresh.length === 1 ? `New message · ${t.customer?.full_name || t.customer?.phone || "Customer"}` : `${fresh.length} new customer messages`,
          fresh.length === 1 ? (t.issue_description || "Open the chat to view") : "Open the dashboard to view",
        );
      }
      setTickets(tickets);
    } catch { /* ignore transient */ }
  }, []);

  useEffect(() => {
    requestNotifyPermission();
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const unread = tickets.filter(isUnread);

  const openTicket = (t) => {
    markSeen(t.id);
    setOpen(false);
    setTickets((list) => [...list]); // re-render so the badge updates immediately
    nav(`/tickets/${t.id}`);
  };

  return (
    <div className="relative">
      <button title="Notifications" onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
        <Icon name="bell" />
        {unread.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-80 rounded-xl border border-slate-200 bg-white shadow-pop">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">Notifications</span>
              {unread.length > 0 && <span className="text-xs text-slate-400">{unread.length} new</span>}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {unread.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-400">No new messages 🎉</p>
              ) : (
                unread.map((t) => (
                  <button key={t.id} onClick={() => openTicket(t)}
                    className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{t.customer?.full_name || t.customer?.phone || "Customer"}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(t.last_inbound_at)}</span>
                      </span>
                      <span className="block truncate text-xs text-slate-500">{t.issue_description || t.ticket_number}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
