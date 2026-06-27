import { STATUS_LABEL, STATUS_COLOR, BADGE_CLS } from "../lib/status.js";

export default function StatusBadge({ status }) {
  const cls = BADGE_CLS[STATUS_COLOR[status]] || "bg-slate-100 text-slate-600 ring-slate-500/20";
  const label = STATUS_LABEL[status] || status;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}
