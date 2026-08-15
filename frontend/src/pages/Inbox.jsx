import { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import ChatPanel from "../components/ChatPanel.jsx";
import NewTicketModal from "../components/NewTicketModal.jsx";
import { Icon, Spinner, Alert, Button } from "../components/ui.jsx";
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
  // Open on the trouble, not on the noise — that is the point of the split.
  const [box, setBox] = useState("issues");   // "issues" | "all"
  const [raising, setRaising] = useState(null); // conversation we're raising a request for
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

  /* Two boxes, not one long list.

     Everything used to sit in a single stream ordered by time, so a customer
     saying "water is still leaking after your visit" scrolled away under the
     ordinary "thanks" and "ok" of the day. Three days of chats had four people
     waiting on an answer and one unanswered complaint, all of them buried in
     plain sight.

     "Needs a reply" holds the two kinds of trouble the backend marks: a
     complaint the bot escalated, and a customer whose last message has gone
     unanswered for a quarter of an hour. Nothing is hidden — the other tab is
     still every conversation. */
  const issues = useMemo(() => convos.filter((c) => c.issue), [convos]);
  const pool = box === "issues" ? issues : convos;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return pool;
    return pool.filter((c) =>
      (c.customer.full_name || "").toLowerCase().includes(s) ||
      (c.customer.phone || "").includes(s) ||
      (c.lastMessage || "").toLowerCase().includes(s));
  }, [pool, q]);

  // Keyed on phone, not customer id: a conversation can exist before the
  // customer row does (WhatsApp intake still collecting details).
  const active = convos.find((c) => (c.phone || c.customer.id) === activeId) || null;
  const select = (id) => setParams(id ? { c: id } : {}, { replace: true });

  return (
    <div className="flex h-[calc(100vh-9rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      {/* ---------- Conversation list ---------- */}
      <div className={`flex w-full flex-col border-r border-slate-200 sm:w-80 lg:w-96 ${active ? "hidden sm:flex" : "flex"}`}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Icon name="chat" className="h-5 w-5 text-emerald-600" />
          <h1 className="text-sm font-semibold text-slate-800">Chats</h1>
        </div>
        <div className="flex gap-1 border-b border-slate-100 px-3 py-2" role="tablist" aria-label="Which chats">
          {[
            { key: "issues", label: "Needs a reply", n: issues.length },
            { key: "all", label: "All chats", n: convos.length },
          ].map((t) => (
            <button key={t.key} role="tab" aria-selected={box === t.key} onClick={() => setBox(t.key)}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 sm:min-h-[34px] sm:flex-none ${
                box === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}>
              {t.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                box === t.key ? "bg-white/20"
                  : t.key === "issues" && t.n ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"
              }`}>{t.n}</span>
            </button>
          ))}
        </div>
        <div className="border-b border-slate-100 px-3 py-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, message…"
              className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 sm:h-9"
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
              {q ? "No chats match your search."
                 : box === "issues" ? "Nobody is waiting. Every customer has had an answer."
                 : "No conversations yet."}
            </p>
          ) : (
            filtered.map((c) => {
              const unread = isUnread({ id: c.phone, last_inbound_at: c.lastInboundAt });
              const key = c.phone || c.customer.id;
              const on = key === activeId;
              return (
                <button key={key} onClick={() => select(key)}
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
                      {/* Why this one is in the list. A complaint and a customer
                          simply left waiting need different answers, so they are
                          not flattened into one "!" — and the label is a word,
                          not a colour, so it survives being read in grey. */}
                      {c.issue && (
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          c.issueKind === "complaint" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
                        }`}>
                          {c.issueKind === "complaint" ? "Complaint" : "Waiting"}
                        </span>
                      )}
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

            {/* Raise a request straight from the chat. The bot normally does this,
                but a conversation can stall before it gets there — the customer
                stops replying, or never says what is wrong. This is the manual
                way out, pre-filled with whatever the chat already told us. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
              <span className="truncate text-sm font-semibold text-slate-800">
                {active.customer.full_name || active.customer.phone}
              </span>
              {/* Only an OPEN request counts. This used to read the latest ticket
                  of any age, so a chat whose job closed weeks ago was badged
                  "Has a request" and looked handled when nothing was on the
                  board. */}
              {active.openTicketId
                ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Open request</span>
                : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">No open request</span>}
              <Button className="ml-auto" onClick={() => setRaising(active)}>
                Create request
              </Button>
            </div>

            {/* The panel fills whatever is left, rather than guessing a pixel
                height — a guess left the composer hanging off the bottom. */}
            <div className="min-h-0 flex-1 overflow-hidden p-3 sm:p-4">
              <ChatPanel
                key={active.phone || active.customer.id}
                ticket={{ id: active.ticketId, customer: active.customer }}
                heightClass="min-h-0 flex-1"
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

      {raising && (
        <NewTicketModal
          initial={raising.customer}
          subtitle={`From the chat with ${raising.customer.full_name || raising.customer.phone}`}
          onClose={() => setRaising(null)}
          onCreated={() => { setRaising(null); load(); }}
        />
      )}
    </div>
  );
}
