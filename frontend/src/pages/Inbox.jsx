import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import ChatPanel from "../components/ChatPanel.jsx";
import { Icon, Spinner, Alert } from "../components/ui.jsx";
import { isUnread } from "../lib/notify.js";

const POLL_MS = 10000;

// Short "last active" label, WhatsApp-style: time today, "Yesterday", else date.
function when(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

const initials = (name) =>
  (name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// WhatsApp-Web style "all chats" screen: a scrollable list of every customer
// conversation on the left, the selected thread (ChatPanel) on the right. The
// thread itself is phone-keyed, so we open it via the customer's latest ticket.
export default function Inbox() {
  const [convos, setConvos] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c"); // selected customer id

  const load = useCallback(async () => {
    try {
      const { conversations } = await api.listConversations();
      setConvos(conversations || []); setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return convos;
    return convos.filter((c) =>
      (c.customer.full_name || "").toLowerCase().includes(s) ||
      (c.customer.phone || "").includes(s) ||
      (c.lastMessage || "").toLowerCase().includes(s));
  }, [convos, q]);

  const active = convos.find((c) => c.customer.id === activeId) || null;
  const select = (id) => setParams(id ? { c: id } : {}, { replace: true });

  return (
    <div className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      {/* ---------- Conversation list ---------- */}
      <div className={`flex w-full flex-col border-r border-slate-200 sm:w-80 lg:w-96 ${active ? "hidden sm:flex" : "flex"}`}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Icon name="chat" className="h-5 w-5 text-emerald-600" />
          <h1 className="text-sm font-semibold text-slate-800">All chats</h1>
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{convos.length}</span>
        </div>
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, message…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!loaded ? (
            <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
          ) : err ? (
            <div className="p-3"><Alert>{err}</Alert></div>
          ) : filtered.length === 0 ? (
            <p className="pt-12 text-center text-sm text-slate-400">
              {q ? "No chats match your search." : "No conversations yet."}
            </p>
          ) : (
            filtered.map((c) => {
              const unread = isUnread({ id: c.ticketId, last_inbound_at: c.lastInboundAt });
              const on = c.customer.id === activeId;
              return (
                <button key={c.customer.id} onClick={() => select(c.customer.id)}
                  className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left transition ${
                    on ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
                    {initials(c.customer.full_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {c.customer.full_name || c.customer.phone}
                      </span>
                      <span className={`ml-auto shrink-0 text-[11px] ${unread ? "font-semibold text-emerald-600" : "text-slate-400"}`}>
                        {when(c.lastAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span className={`truncate text-xs ${unread ? "font-medium text-slate-700" : "text-slate-500"}`}>
                        {c.lastDir === "out" ? "You: " : c.lastDir === "bot" ? "🤖 " : ""}{c.lastMessage}
                      </span>
                      {unread && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-500" />}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ---------- Thread ---------- */}
      <div className={`flex-1 flex-col bg-slate-50 ${active ? "flex" : "hidden sm:flex"}`}>
        {active ? (
          <>
            {/* mobile back to list */}
            <button onClick={() => select(null)}
              className="flex items-center gap-1 border-b border-slate-100 bg-white px-3 py-2 text-sm text-slate-500 sm:hidden">
              <Icon name="back" className="h-4 w-4" /> All chats
            </button>
            <div className="flex-1 overflow-hidden p-3 sm:p-4">
              <ChatPanel
                key={active.customer.id}
                ticket={{ id: active.ticketId, customer: active.customer }}
                heightClass="h-[calc(100vh-19rem)]"
              />
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
            <Icon name="chat" className="h-12 w-12 text-slate-300" />
            <p className="mt-3 text-sm">Select a chat to view the conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}
