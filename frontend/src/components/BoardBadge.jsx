import { BUCKET_LABEL, BUCKET_COLOR } from "../lib/boardBucket.js";

const BADGE = {
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/15",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/15",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/15",
};

export default function BoardBadge({ bucket, reopened }) {
  if (!bucket || bucket === "cancelled") return null;
  const color = BUCKET_COLOR[bucket] || "slate";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${BADGE[color] || BADGE.slate}`}>
      {BUCKET_LABEL[bucket] || bucket}
      {reopened && bucket === "pending" && <span className="normal-case opacity-80">· Reopened</span>}
    </span>
  );
}
