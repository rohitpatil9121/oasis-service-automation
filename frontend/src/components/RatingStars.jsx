// Customer service rating, shown wherever a ticket appears. `value` is 1–5 (or
// null when not yet rated). Compact by default (stars only, for table cells);
// pass `showLabel` to append the word (Poor … Excellent) on the ticket detail.
const RATING_LABELS = { 1: "Poor", 2: "Fair", 3: "Okay", 4: "Good", 5: "Excellent" };

export default function RatingStars({ value, showLabel = false, className = "" }) {
  if (value == null) return null;
  const label = `Rated ${value} out of 5${RATING_LABELS[value] ? ` — ${RATING_LABELS[value]}` : ""}`;
  return (
    <span role="img" aria-label={label} className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="text-amber-500" aria-hidden="true">
        {"★".repeat(value)}<span className="text-slate-300">{"★".repeat(5 - value)}</span>
      </span>
      {showLabel && <span aria-hidden="true" className="text-slate-500">{RATING_LABELS[value] || `${value}/5`}</span>}
    </span>
  );
}
