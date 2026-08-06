import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { Icon } from "./ui.jsx";
import MediaBubble from "./MediaBubble.jsx";
import { markSeen } from "../lib/notify.js";

const POLL_MS = 10000;

// Just the clock inside a bubble — the day is carried by the date separator
// above it, exactly as WhatsApp does it.
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });

// "Today" / "Yesterday" / "12 Aug 2026" for the separator pills.
const dayKey = (iso) => new Date(iso).toDateString();
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

/* WhatsApp's tick marks, driven by Meta's delivery receipts:
     one tick   accepted by WhatsApp
     two ticks  delivered to the handset
     two blue   read
     !          the message never arrived
   Only outbound messages carry them. */
function Ticks({ status, delivery, pending }) {
  if (pending) return <span className="opacity-70">🕘</span>;
  if (status === "FAILED" || delivery === "failed") {
    return <span title="Not delivered" className="font-bold text-red-200">!</span>;
  }
  const two = delivery === "delivered" || delivery === "read";
  const blue = delivery === "read";
  return (
    <svg viewBox="0 0 18 12" className={`h-3 w-[18px] ${blue ? "text-sky-300" : "text-emerald-100/80"}`}
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-label={blue ? "Read" : two ? "Delivered" : "Sent"}>
      <path d="M1 6.5 4 9.5 10 2.5" />
      {two && <path d="M7 6.5 10 9.5 16 2.5" />}
    </svg>
  );
}

/* The WhatsApp wallpaper. Inlined as a data URI so it needs no asset pipeline
   and no network request — a handful of faint marks tiled behind the thread. */
const DOODLE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140'%3E%3Cg fill='none' stroke='%23000' stroke-opacity='0.035' stroke-width='1.6' stroke-linecap='round'%3E%3Cpath d='M18 24c4-6 10-6 14 0M22 34v8'/%3E%3Ccircle cx='96' cy='22' r='7'/%3E%3Cpath d='M92 22h8M96 18v8'/%3E%3Cpath d='M28 88c6-10 14-10 20 0s-6 16-12 8'/%3E%3Cpath d='M108 74l6 10-12 0z'/%3E%3Cpath d='M116 104c-6 4-12 4-18 0'/%3E%3Ccircle cx='64' cy='120' r='5'/%3E%3Cpath d='M56 56h14v10H56z'/%3E%3Cpath d='M124 44v10M120 49h8'/%3E%3C/g%3E%3C/svg%3E\")";

/* A small palette — the handful anyone actually uses replying to a customer.
   Not a full picker: the office types on a desktop keyboard, not a phone. */
const EMOJI = ["😊", "🙏", "👍", "👌", "✅", "❌", "🙋", "😢",
  "🙌", "🔧", "💧", "🧰", "📞", "📍", "📅", "⏰",
  "💰", "🧾", "🚚", "⭐", "🙍", "😅", "🙎", "🔄",
  "❗", "❓", "👋", "🎉", "🙂", "🤝", "💬", "🛠"];

/* Turn URLs and phone numbers in a message into links, like WhatsApp does.
   Bill links and numbers come through chat constantly and were dead text. */
const LINK_RE = /(https?:\/\/\S+|\+?\d[\d\s-]{8,}\d)/g;
function Linkify({ text, out }) {
  const cls = out ? "underline decoration-emerald-200 underline-offset-2" : "text-emerald-700 underline underline-offset-2";
  return (text || "").split(LINK_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    const href = part.startsWith("http") ? part : "tel:" + part.replace(/[\s-]/g, "");
    return <a key={i} href={href} target="_blank" rel="noreferrer" className={cls}>{part}</a>;
  });
}

// Inline WhatsApp chat with the ticket's customer. Shows the full thread
// (inbound + outbound) and lets the manager send a free-form message — handy
// for asking the customer to clarify a missing detail.
export default function ChatPanel({ ticket, heightClass = "h-72" }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [warn, setWarn] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [botOn, setBotOn] = useState(true);
  const [replyTo, setReplyTo] = useState(null); // message the manager is quoting
  const [emoji, setEmoji] = useState(false);
  const [atBottom, setAtBottom] = useState(true); // drives the jump-to-latest button
  const boxRef = useRef(null);
  const scrollRef = useRef(null);
  const atBottomRef = useRef(true); // only auto-scroll when the user is already at the bottom

  // Track whether the user is near the bottom; if they scrolled up to read older
  // messages, we won't yank them down on the next poll.
  function onScroll(e) {
    const el = e.currentTarget;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(atBottomRef.current);
  }

  // A chat doesn't always have a ticket: during WhatsApp intake the customer
  // exists before the request does. Fall back to the phone-keyed endpoints so
  // those conversations are still readable and answerable.
  const phone = ticket.customer?.phone;
  const byTicket = !!ticket.id;

  const load = useCallback(async () => {
    try {
      const { messages, botOn } = byTicket
        ? await api.getConversation(ticket.id)
        : await api.getPhoneConversation(phone);
      setMessages(messages);
      if (typeof botOn === "boolean") setBotOn(botOn);
      markSeen(ticket.id || phone); // viewing the chat clears its unread badge
    } catch { /* ignore transient */ } finally { setLoaded(true); }
  }, [ticket.id, phone, byTicket]);

  async function toggleBot() {
    const next = !botOn;
    setBotOn(next);
    try {
      if (byTicket) await api.setBot(ticket.id, next);
      else await api.setPhoneBot(phone, next);
    } catch { setBotOn(!next); }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (scrollRef.current && atBottomRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Grow the box with the text, the way WhatsApp's composer does.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [text]);

  // Jump to the message being quoted, the way tapping a reply does in WhatsApp.
  function jumpTo(id) {
    const el = document.getElementById("msg-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-emerald-400");
    setTimeout(() => el.classList.remove("ring-2", "ring-emerald-400"), 1200);
  }

  // A short label for a quoted message (handles media-only messages).
  const snippet = (m) => (m?.body || "").trim() || (m?.mediaId ? "📎 Attachment" : "");

  async function send(e) {
    e?.preventDefault?.();
    const body = text.trim();
    if (!body) return;
    const quoting = replyTo;
    setSending(true); setWarn("");
    atBottomRef.current = true; // sending my own message → scroll to show it
    // optimistic
    setMessages((m) => [...m, { id: "tmp-" + Date.now(), dir: "out", body, at: new Date().toISOString(), pending: true, replyTo: quoting ? { body: snippet(quoting) } : null }]);
    setText(""); setReplyTo(null);
    try {
      const payload = quoting ? { wamid: quoting.waMessageId || null, body: snippet(quoting) } : null;
      const res = byTicket
        ? await api.sendMessage(ticket.id, body, payload)
        : await api.sendPhoneMessage(phone, body, payload);
      if (!res.ok) setWarn("Couldn't deliver — the customer may be outside WhatsApp's 24-hour window. They need to message first.");
      await load();
    } catch (err) { setWarn(err.message); } finally { setSending(false); }
  }

  function onComposerKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(e);
    }
  }

  return (
    <div className="relative flex h-full max-h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-emerald-600 px-4 py-3 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <Icon name="phone" className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{ticket.customer?.full_name || "Customer"}</div>
          <div className="font-mono text-xs text-emerald-100">{ticket.customer?.phone}</div>
        </div>
        <button onClick={toggleBot} title="AI auto-reply for this customer"
          className="ml-auto flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-semibold transition hover:bg-white/25">
          <span className={`h-1.5 w-1.5 rounded-full ${botOn ? "bg-emerald-300" : "bg-white/40"}`} />
          Bot {botOn ? "On" : "Off"}
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} onScroll={onScroll}
        style={{ backgroundImage: DOODLE, backgroundColor: "#EFE7DE" }}
        className={`${heightClass} space-y-1.5 overflow-y-auto px-3 py-3`}>
        {!loaded ? (
          <p className="pt-8 text-center text-sm text-slate-500">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-slate-500">No messages yet. Say hello 👋</p>
        ) : (
          messages.map((m, i) => (
            <div key={m.id}>
            {/* Date separator whenever the day changes, WhatsApp-style pill. */}
            {(i === 0 || dayKey(m.at) !== dayKey(messages[i - 1].at)) && (
              <div className="flex justify-center py-2">
                <span className="rounded-md bg-white/85 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-500 shadow-sm">
                  {dayLabel(m.at)}
                </span>
              </div>
            )}
            <div id={`msg-${m.id}`} className={`group flex scroll-mt-4 items-center gap-1.5 rounded-lg transition ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
              {/* reply button (left of outbound bubbles) */}
              {m.dir === "out" && (
                <button onClick={() => setReplyTo(m)} title="Reply to this message"
                  className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-emerald-600">
                  <Icon name="reply" className="h-3.5 w-3.5" />
                </button>
              )}
              <div className={`relative max-w-[78%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm ${
                m.dir === "out"
                  ? "rounded-tr-none bg-[#128C7E] text-white"
                  : "rounded-tl-none bg-white text-slate-800"
              }`}>
                {/* bubble tail */}
                <span aria-hidden="true" className={`absolute top-0 h-3 w-3 ${
                  m.dir === "out"
                    ? "-right-[7px] bg-[#128C7E] [clip-path:polygon(0_0,100%_0,0_100%)]"
                    : "-left-[7px] bg-white [clip-path:polygon(0_0,100%_0,100%_100%)]"
                }`} />
                {m.replyTo?.body && (
                  <div className={`mb-1 rounded border-l-[3px] px-2 py-1 text-[11px] ${
                    m.dir === "out"
                      ? "border-emerald-200 bg-white/15 text-emerald-50"
                      : "border-emerald-500 bg-slate-50 text-slate-500"
                  }`}>
                    {m.replyTo.body}
                  </div>
                )}
                {m.mediaId && (
                  <MediaBubble mediaId={m.mediaId} mediaType={m.mediaType} isOutbound={m.dir === "out"} />
                )}
                {m.body ? <p className="whitespace-pre-wrap break-words"><Linkify text={m.body} out={m.dir === "out"} /></p> : null}
                <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none ${
                  m.dir === "out" ? "text-emerald-100/90" : "text-slate-400"
                }`}>
                  {m.dir === "out" && m.audience === "bot" && <span title="Sent by the AI">🤖</span>}
                  <span>{m.pending ? "sending…" : time(m.at)}</span>
                  {m.dir === "out" && !m.pending && (
                    <Ticks status={m.status} delivery={m.delivery} pending={m.pending} />
                  )}
                </div>
              </div>
              {/* reply button (right of inbound bubbles) */}
              {m.dir === "in" && (
                <button onClick={() => setReplyTo(m)} title="Reply to this message"
                  className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-emerald-600">
                  <Icon name="reply" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            </div>
          ))
        )}
      </div>

      {!atBottom && messages.length > 0 && (
        <button type="button" title="Jump to the latest message"
          onClick={() => { atBottomRef.current = true; setAtBottom(true);
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }}
          className="absolute bottom-20 right-5 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-500 shadow-pop transition hover:text-emerald-600">
          &#8595;
        </button>
      )}

      {warn && <div className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">{warn}</div>}

      {/* reply preview */}
      {replyTo && (
        <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2">
          <div className="flex-1 border-l-2 border-emerald-500 pl-2 text-xs text-slate-600">
            <div className="font-semibold text-emerald-700">
              Replying to {replyTo.dir === "out" ? "you" : ticket.customer?.full_name || "customer"}
            </div>
            <div className="truncate">{snippet(replyTo)}</div>
          </div>
          <button onClick={() => setReplyTo(null)} title="Cancel reply"
            className="text-slate-400 hover:text-slate-600">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* composer */}
      <form onSubmit={send} className="relative flex shrink-0 items-end gap-2 border-t border-slate-100 bg-slate-50 p-2.5">
        {emoji && (
          <div className="absolute bottom-full left-2 mb-1 grid w-72 grid-cols-8 gap-0.5 rounded-xl border border-slate-200 bg-white p-2 shadow-pop">
            {EMOJI.map((e) => (
              <button key={e} type="button" onClick={() => { setText((t) => t + e); setEmoji(false); boxRef.current?.focus(); }}
                className="rounded p-1 text-lg leading-none transition hover:bg-slate-100">{e}</button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setEmoji((v) => !v)} title="Emoji"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none transition hover:bg-slate-200 ${emoji ? "bg-slate-200" : ""}`}>
          😊
        </button>
        <textarea
          ref={boxRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder="Type a message"
          className="max-h-32 flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        />
        <button type="submit" disabled={sending || !text.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-50"
          aria-label="Send">
          <Icon name="send" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
