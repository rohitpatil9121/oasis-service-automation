/* The figures the Home report is drawn from.

   Each one carries a hover layer, because a chart on a screen that cannot be
   interrogated is a picture of data rather than data. Values are labelled
   directly where there is room; nothing carries a number on every mark. Axes
   and grid lines are recessive — they orient, they do not compete.

   Text never wears the series colour: a coloured mark sits beside ink-coloured
   text, so identity survives being read by someone who cannot separate the hues,
   or printed in grey.

   On small text and grey: the dashboard's habit is slate-400 for hints, which is
   2.9:1 on white — below the 4.5:1 a body-size string needs. Everything here
   that a person actually reads uses slate-500 or darker. */
import { SERIES, INK, GRID } from "../lib/chart.js";

const R = 4;   // rounded data-end, anchored to the baseline

export function Figure({ title, sub, children, right, className = "" }) {
  return (
    <section className={`flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-card ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

export function Legend({ items }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Nothing to draw yet — say what would fill it, not just that it is empty. */
export function Empty({ children }) {
  return (
    <div className="flex h-full min-h-[96px] items-center justify-center rounded-lg border border-dashed border-slate-200 px-4 py-6">
      <p className="text-center text-xs text-slate-500">{children}</p>
    </div>
  );
}

/* Two counts a day over a fortnight. Grouped bars, not stacked: the question is
   "did we close as many as came in", which compares two lengths from the same
   baseline — stacking would make one of them float and unreadable. */
export function DailyBars({ days, series, height = 200 }) {
  const W = 720, H = height, padL = 26, padR = 8, padT = 10, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = plotW / days.length;
  const barW = Math.min(10, (step - 8) / series.length);
  const y = (v) => padT + plotH - (v / max) * plotH;

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`${series.map((s) => s.label).join(" and ")} per day, last ${days.length} days`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth="1" />
            <text x={padL - 6} y={y(max * f) + 3.5} textAnchor="end" fontSize="9" fill={INK.secondary}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => (
          <g key={d}>
            {/* A full-height target, so the tooltip is reachable without hitting
                a 10px bar — and so a day with nothing still answers. */}
            <rect x={padL + i * step} y={padT} width={step} height={plotH} fill="transparent">
              <title>{`${d}\n${series.map((s) => `${s.label}: ${s.values[i]}`).join("\n")}`}</title>
            </rect>
            {series.map((s, si) => {
              const v = s.values[i];
              if (!v) return null;
              const x = padL + i * step + step / 2 - (series.length * barW + 2) / 2 + si * (barW + 2);
              return (
                <rect key={s.label} x={x} y={y(v)} width={barW} height={Math.max(2, y(0) - y(v))}
                  rx={R} fill={s.color} pointerEvents="none" />
              );
            })}
            {i % 2 === 0 && (
              <text x={padL + i * step + step / 2} y={H - 7} textAnchor="middle" fontSize="9" fill={INK.secondary}>
                {+d.slice(8)}/{+d.slice(5, 7)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-2"><Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /></div>
    </>
  );
}

/* Ranked magnitudes — who has what, which column holds what. Horizontal,
   because the labels are names and a name reads along a line, not sideways. */
export function RankedBars({ rows, unit = "", color = SERIES[0], empty = "Nothing here yet." }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(76px,124px)_1fr_auto] items-center gap-2">
          <span className="truncate text-xs text-slate-600" title={r.label}>{r.label}</span>
          <span className="h-3 rounded-full bg-slate-100" title={`${r.label}: ${r.display ?? r.value}${unit}`}>
            {/* Zero draws NOTHING. A minimum-width sliver for an empty count is a
                mark that says "a little" where the truth is "none". */}
            {r.value > 0 && (
              <span
                className="block h-3 rounded-full motion-safe:transition-[width] motion-safe:duration-300"
                style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: r.color || color }}
              />
            )}
          </span>
          <span className="tabular-nums text-xs font-semibold text-slate-800">{r.display ?? r.value}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

/* One number that is the whole answer.

   `delta` is what turns a number into a report: 12 jobs means nothing until you
   know yesterday was 4. It carries an arrow AND a word, never colour alone —
   red and green are the first thing to go for eight percent of men. */
export function Stat({ label, value, sub, delta, accent = "#475569" }) {
  const up = delta && delta.direction === "up";
  const flat = delta && delta.direction === "flat";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} aria-hidden="true" />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-[28px] font-bold leading-none tabular-nums text-slate-900">{value}</span>
        {delta && (
          <span className={`mb-0.5 inline-flex items-center gap-0.5 text-xs font-semibold ${
            flat ? "text-slate-500" : up ? "text-emerald-700" : "text-amber-700"}`}>
            <span aria-hidden="true">{flat ? "→" : up ? "↑" : "↓"}</span>
            {delta.text}
          </span>
        )}
      </div>
      {sub && <div className="mt-1.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
