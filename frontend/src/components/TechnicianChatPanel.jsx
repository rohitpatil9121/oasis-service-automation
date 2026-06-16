import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { Icon } from "./ui.jsx";

const POLL_MS = 10000;
const time = (iso) => new Date(iso).toLocaleString([], { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

// WhatsApp chat (company 92 number) with a technician — the Service Manager can
// see what was sent to them (job alerts, schedules) and reply on WhatsApp.
export default function TechnicianChatPanel({ technician }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [warn, setWarn] = useState("");
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { messages } = await api.getTechnicianConversation(technician.id);
      setMessages(messages);
    } catch { /* ignore transient */ } finally { setLoaded(true); }
  }, [technician.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true); setWarn("");
    setMessages((m) => [...m, { id: "tmp-" + Date.now(), dir: "out", body, at: new Date().toISOString(), pending: true }]);
    setText("");
    try {
      const res = await api.sendTechnicianMessage(technician.id, body);
      if (!res.ok) setWarn("Couldn't deliver — the technician may be outside WhatsApp's 24-hour window. They need to message first.");
      await load();
    } catch (err) { setWarn(err.message); } finally { setSending(false); }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="flex items-center gap-2.5 border-b border-slate-100 bg-emerald-600 px-4 py-3 text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
          <Icon name="phone" className="h-4 w-4" />
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{technician.full_name || "Technician"}</div>
          <div className="font-mono text-xs text-emerald-100">{technician.phone}</div>
        </div>
        <span className="ml-auto text-[11px] font-medium text-emerald-100">WhatsApp</span>
      </div>

      <div ref={scrollRef} className="h-72 space-y-2 overflow-y-auto bg-slate-50 px-3 py-3">
        {!loaded ? (
          <p className="pt-8 text-center text-sm text-slate-400">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="pt-8 text-center text-sm text-slate-400">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.dir === "out" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                m.dir === "out"
                  ? "rounded-br-sm bg-emerald-600 text-white"
                  : "rounded-bl-sm border border-slate-200 bg-white text-slate-700"
              }`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div className={`mt-0.5 text-right text-[10px] ${m.dir === "out" ? "text-emerald-100" : "text-slate-400"}`}>
                  {m.pending ? "sending…" : time(m.at)}{m.status === "FAILED" ? " · failed" : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {warn && <div className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">{warn}</div>}

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
