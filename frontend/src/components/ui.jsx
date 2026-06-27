import { useEffect, useRef } from "react";

// Small, dependency-free UI primitives shared across the dashboard so styling
// stays consistent. Tailwind utility classes under the hood.

// ---------- Icons (inline SVG, currentColor) ----------
const PATHS = {
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  plus: "M12 5v14 M5 12h14",
  refresh: "M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0 1 14.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  search: "M21 21l-4.35-4.35 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
  back: "M19 12H5 M12 19l-7-7 7-7",
  phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
  pin: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1a2 2 0 0 1-2.8-2.8z",
  check: "M20 6 9 17l-5-5",
  box: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12",
  trash: "M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0",
  chevron: "M6 9l6 6 6-6",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  calendar: "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  send: "M22 2 11 13 M22 2 15 22 11 13 2 9 22 2z",
  edit: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  reply: "M9 14 4 9l5-5 M20 20v-7a4 4 0 0 0-4-4H4",
  x: "M18 6 6 18 M6 6l12 12",
};
export function Icon({ name, className = "h-4 w-4", stroke = 2 }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name]?.split(" M").map((d, i) => <path key={i} d={(i ? "M" : "") + d} />)}
    </svg>
  );
}

// ---------- Button ----------
const BTN = {
  primary: "bg-brand text-white hover:bg-brand-dark shadow-sm",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
};
export function Button({ variant = "primary", className = "", children, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none ${BTN[variant]} ${className}`}
      {...props}>
      {children}
    </button>
  );
}

// ---------- Card ----------
export function Card({ className = "", children }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-card ${className}`}>{children}</div>;
}

// ---------- Inputs ----------
const FIELD = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";
export function Input(props) { return <input {...props} className={`${FIELD} ${props.className || ""}`} />; }
export function Textarea(props) { return <textarea {...props} className={`${FIELD} ${props.className || ""}`} />; }
export function Select(props) { return <select {...props} className={`${FIELD} ${props.className || ""}`} />; }
// Phone input with a fixed +91 prefix so staff type only the local 10-digit
// number (no country code). Reads/writes the full value ("+919876543210") and
// fires onChange with a synthetic event, so it drops into existing form handlers.
export function PhoneInput({ value, onChange, className = "", ...props }) {
  let local = String(value || "").replace(/\D/g, "");
  if (local.startsWith("91")) local = local.slice(2); // strip +91 country code (stored value is always "+91"+digits)
  local = local.slice(0, 10);
  const handle = (e) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    onChange?.({ target: { value: digits ? "+91" + digits : "" } });
  };
  return (
    <div className={`flex items-center rounded-lg border border-slate-300 bg-white text-sm transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 ${className}`}>
      <span className="select-none border-r border-slate-200 px-3 py-2 text-slate-500">+91</span>
      <input {...props} value={local} onChange={handle} inputMode="numeric" maxLength={10}
        className="w-full rounded-r-lg bg-transparent px-3 py-2 outline-none" />
    </div>
  );
}
export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

// ---------- Alert ----------
export function Alert({ children }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div>;
}

// ---------- Modal ----------
// Closes on Escape and on backdrop click. Moves focus into the dialog on open,
// keeps Tab from escaping (focus trap), and restores focus to the trigger on
// close — the basics a screen-reader / keyboard user expects from a dialog.
const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
export function Modal({ title, subtitle, onClose, children }) {
  const panelRef = useRef(null);
  const titleId = title ? "modal-title" : undefined;

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    // focus the first field (or the panel itself) once mounted
    const first = panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus();

    function onKeyDown(e) {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab") return;
      const items = panel?.querySelectorAll(FOCUSABLE);
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); opener?.focus?.(); };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="w-full max-w-md animate-in rounded-2xl bg-white p-6 shadow-pop outline-none"
        onMouseDown={(e) => e.stopPropagation()}>
        {title && <h3 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h3>}
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

// ---------- Misc ----------
export function Spinner({ className = "h-5 w-5" }) {
  return (
    <svg className={`animate-spin text-brand ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
export function EmptyState({ icon = "inbox", title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <p className="font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

// relative time like "5m ago"
export function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
