import { useEffect, useRef, useState, useCallback } from "react";
import { api, BASE, getToken } from "../api/client.js";
import { Icon } from "./ui.jsx";

const POLL_MS = 10000;
const time = (iso) => new Date(iso).toLocaleString([], { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

// Inline WhatsApp chat with the ticket's customer. Shows the full thread
// (inbound + outbound) and lets the manager send a free-form message — handy
// for asking the customer to clarify a missing detail.
export default function ChatPanel({ ticket }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [warn, setWarn] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [botOn, setBotOn] = useState(true);
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { messages, botOn } = await api.getConversation(ticket.id);
      setMessages(messages);
      if (typeof botOn === "boolean") setBotOn(botOn);
    } catch { /* ignore transient */ } finally { setLoaded(true); }
  }, [ticket.id]);

  async function toggleBot() {
    const next = !botOn;
    setBotOn(next);
    try { await api.setBot(ticket.id, next); } catch { setBotOn(!next); }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true); setWarn("");
    // optimistic
    setMessages((m) => [...m, { id: "tmp-" + Date.now(), dir: "out", body, at: new Date().toISOString(), pending: true }]);
    setText("");
    try {
      const res = await api.sendMessage(ticket.id, body);
      if (!res.ok) setWarn("Couldn't deliver — the customer may be outside WhatsApp's 24-hour window. They need to message first.");
      await load();
    } catch (err) { setWarn(err.message); } finally { setSending(false); }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
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
      <div ref={scrollRef} className="h-72 space-y-2 overflow-y-auto bg-slate-50 px-3 py-3">
        {!loaded ? (
          <p className="pt-8 text-center text-sm text-slate-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-slate-400">No messages yet. Say hello 👋</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                m.dir === "out"
                  ? "rounded-br-sm bg-emerald-600 text-white"
                  : "rounded-bl-sm border border-slate-200 bg-white text-slate-700"
              }`}>
                {m.mediaId && (
                  <a href={`${BASE}/api/media/${m.mediaId}?t=${getToken()}`} target="_blank" rel="noreferrer"
                    className="mb-1 block">
                    <img
                      src={`${BASE}/api/media/${m.mediaId}?t=${getToken()}`}
                      alt="Attached media"
                      className="max-h-48 w-auto rounded-lg object-contain"
                      onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.nextSibling.style.display = "inline"; }}
                    />
                    <span style={{ display: "none" }} className="text-xs opacity-70">📎 Media (tap to open)</span>
                  </a>
                )}
                {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                <div className={`mt-0.5 text-right text-[10px] ${m.dir === "out" ? "text-emerald-100" : "text-slate-400"}`}>
                  {m.dir === "out" && m.audience === "bot" ? "🤖 Bot · " : ""}
                  {m.pending ? "sending…" : time(m.at)}{m.status === "FAILED" ? " · failed" : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {warn && <div className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">{warn}</div>}

      {/* composer */}
      <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-100 p-2.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a WhatsApp message…"
          className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
        />
        <button type="submit" disabled={sending || !text.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-50"
          aria-label="Send">
          <Icon name="send" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
