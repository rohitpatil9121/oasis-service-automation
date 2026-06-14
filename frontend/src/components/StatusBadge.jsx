const MAP = {
  NEW:         { cls: "bg-blue-50 text-blue-700 ring-blue-600/20", label: "New" },
  ASSIGNED:    { cls: "bg-amber-50 text-amber-700 ring-amber-600/20", label: "Assigned" },
  IN_PROGRESS: { cls: "bg-violet-50 text-violet-700 ring-violet-600/20", label: "In progress" },
  CLOSED:      { cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", label: "Closed" },
  CANCELLED:   { cls: "bg-slate-100 text-slate-500 ring-slate-500/20", label: "Cancelled" },
};

export default function StatusBadge({ status }) {
  const s = MAP[status] || { cls: "bg-slate-100 text-slate-600 ring-slate-500/20", label: status };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {s.label}
    </span>
  );
}
