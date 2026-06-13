const MAP = {
  NEW:         "bg-blue-100 text-blue-700",
  ASSIGNED:    "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-purple-100 text-purple-700",
  CLOSED:      "bg-emerald-100 text-emerald-700",
  CANCELLED:   "bg-slate-200 text-slate-600",
};
export default function StatusBadge({ status }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${MAP[status] || "bg-slate-100 text-slate-600"}`}>
      {status}
    </span>
  );
}
