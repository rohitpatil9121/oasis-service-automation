// In-app "new customer message" alerts for the Service Manager.
// - tracks which ticket chats the manager has already opened ("seen")
// - exposes isUnread() so the dashboard can badge tickets with new messages
// - beep() + popup() fire a short sound + browser notification on arrival
// No backend/DB changes: "seen" lives in localStorage, keyed per ticket.

const SEEN_KEY = "og_seen_inbound_v1";

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; }
}
function writeSeen(map) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(map)); } catch { /* quota — ignore */ }
}

// Has the customer messaged on this ticket since the manager last opened the chat?
export function isUnread(ticket) {
  if (!ticket?.last_inbound_at) return false;
  const seen = readSeen()[ticket.id];
  return !seen || new Date(ticket.last_inbound_at) > new Date(seen);
}

// Mark a ticket's chat as seen — call when the manager opens the conversation.
export function markSeen(ticketId, at) {
  if (!ticketId) return;
  const map = readSeen();
  map[ticketId] = at || new Date().toISOString();
  writeSeen(map);
}

// Ask once for browser-notification permission (best-effort, no-op if denied).
export function requestNotifyPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  } catch { /* ignore */ }
}

// Short beep via Web Audio — avoids shipping an audio file. Browsers may block
// audio until the first user interaction; that's fine, it just stays silent then.
let audioCtx = null;
export function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "sine"; o.frequency.value = 660;
    const t = audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.start(t); o.stop(t + 0.36);
  } catch { /* ignore */ }
}

// Browser notification (best-effort; needs granted permission).
export function popup(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, tag: "og-inbound", renotify: true });
    }
  } catch { /* ignore */ }
}
