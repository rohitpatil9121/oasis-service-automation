import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { Icon, timeAgo } from "./ui.jsx";
import { isUnread, markSeen, beep, popup, requestNotifyPermission } from "../lib/notify.js";

const POLL_MS = 8000;

/* Header notification bell: shows a red count of chats with new customer
   messages and a dropdown to jump straight into them. Lives in the global
   Layout, so the sound + popup fire on every page. "Seen" is tracked locally
   by notify.js.

   Driven by the CONVERSATION list, not the ticket list. It used to poll tickets,
   which meant a message only ever raised an alert if the sender already had a
   ticket — so the exact people who most need attention (someone writing in for
   the first time, or after their last job closed) arrived silently. Keyed on
   phone for the same reason: a conversation exists before a ticket does. */
export default function NotificationBell() {
  const [convos, setConvos] = useState([]);
  const [open, setOpen] = useState(false);
  const prevRef = useRef(null); // phone -> lastInboundAt from the previous poll
  const nav = useNavigate();

  const load = useCallback(async () => {
    try {
      const { conversations } = await api.listConversations();
      const list = conversations || [];
      // Fire a sound + browser popup when a customer messages since the last poll.
      const prev = prevRef.current;
      const curr = new Map();
      const fresh = [];
      for (const c of list) {
        if (!c.lastInboundAt || !c.phone) continue;
        curr.set(c.phone, c.lastInboundAt);
        if (prev && (!prev.has(c.phone) || new Date(c.lastInboundAt) > new Date(prev.get(c.phone)))) fresh.push(c);
      }
      prevRef.current = curr;
      if (prev && fresh.length) { // skip the very first load
        beep();
        const c = fresh[0];
        popup(
          fresh.length === 1
            ? `New message · ${c.customer?.full_name || c.phone}`
            : `${fresh.length} new customer messages`,
          fresh.length === 1 ? (c.lastMessage || "Open the chat to view") : "Open All chats to view",
        );
      }
      setConvos(list);
    } catch { /* ignore transient */ }
  }, []);

  useEffect(() => {
    requestNotifyPermission();
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Keyed on phone, matching the inbox, so opening a chat from either place
  // clears the badge in both.
  const unread = convos.filter((c) => isUnread({ id: c.phone, last_inbound_at: c.lastInboundAt }));

  const openChat = (c) => {
    markSeen(c.phone);
    setOpen(false);
    setConvos((list) => [...list]); // re-render so the badge updates immediately
    // The route is /chats. It was /inbox here, which matches no route at all, so
    // the catch-all sent every notification click back to the dashboard — the
    // badge cleared, the chat never opened, and it read as the click not working.
    nav(`/chats?c=${encodeURIComponent(c.phone)}`);
  };

  return (
    <div className="relative">
      <button aria-label={unread.length > 0 ? `Notifications, ${unread.length} new` : "Notifications"}
        aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="relative flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:h-9 sm:w-9">
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
                unread.map((c) => (
                  <button key={c.phone} onClick={() => openChat(c)}
                    className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-slate-800">{c.customer?.full_name || c.phone}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(c.lastInboundAt)}</span>
                      </span>
                      <span className="block truncate text-xs text-slate-500">{c.lastMessage || "New message"}</span>
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
