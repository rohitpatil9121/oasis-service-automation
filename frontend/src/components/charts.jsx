/* The figures the Home report is drawn from.

   Each one is an <svg> with a hover layer, because a chart on a screen that
   cannot be interrogated is a picture of data rather than data. Values are
   labelled directly where there is room; nothing carries a number on every
   mark. Axes and grid lines are recessive — they orient, they do not compete.

   Text never wears the series colour: a coloured mark sits beside ink-coloured
   text, so identity survives being read by someone who cannot separate the
   hues, or printed in grey. */
import { SERIES, INK, GRID } from "../lib/chart.js";

const R = 4;   // rounded data-end, anchored to the baseline

export function Figure({ title, sub, children, right }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
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

/* Two counts a day over a fortnight. Grouped bars, not stacked: the question is
   "did we close as many as came in", which is a comparison of two lengths from
   the same baseline — stacking would make one of them float and unreadable. */
export function DailyBars({ days, series, height = 190 }) {
  const W = 720, H = height, padL = 28, padR = 8, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = plotW / days.length;
  const barW = Math.min(9, (step - 6) / series.length);
  const y = (v) => padT + plotH - (v / max) * plotH;

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`${series.map((s) => s.label).join(" and ")} per day`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(max * f)} y2={y(max * f)} stroke={GRID} strokeWidth="1" />
            <text x={padL - 6} y={y(max * f) + 3.5} textAnchor="end" fontSize="9" fill={INK.muted}>
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {days.map((d, i) => (
          <g key={d}>
            {series.map((s, si) => {
              const v = s.values[i];
              const x = padL + i * step + step / 2 - (series.length * barW + 2) / 2 + si * (barW + 2);
              const top = y(v);
              return (
                <rect key={s.label} x={x} y={v ? top : y(0) - 1} width={barW}
                  height={v ? Math.max(2, y(0) - top) : 1} rx={R} fill={v ? s.color : GRID}>
                  <title>{`${d} · ${s.label}: ${v}`}</title>
                </rect>
              );
            })}
            {i % 2 === 0 && (
              <text x={padL + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize="9" fill={INK.muted}>
                {d.slice(8)}/{+d.slice(5, 7)}
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
export function RankedBars({ rows, unit = "", color = SERIES[0], max: forcedMax }) {
  const max = Math.max(1, forcedMax ?? Math.max(...rows.map((r) => r.value)));
  if (!rows.length) return <p className="py-6 text-center text-xs text-slate-400">Nothing to show yet.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(84px,132px)_1fr_auto] items-center gap-2">
          <span className="truncate text-xs text-slate-600" title={r.label}>{r.label}</span>
          <span className="h-3 rounded-full bg-slate-100">
            {/* Zero draws NOTHING. A minimum-width sliver for an empty count is
                a mark that says "a little" where the truth is "none". */}
            {r.value > 0 && (
              <span
                className="block h-3 rounded-full transition-all"
                style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: r.color || color }}
                title={`${r.label}: ${r.value}${unit}`}
              />
            )}
          </span>
          <span className="tabular-nums text-xs font-semibold text-slate-700">{r.display ?? r.value}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

/* One number that is the whole answer. No plot, so no hover layer — there is
   nothing to interrogate that the number does not already say. */
export function Stat({ label, value, sub, tone = "slate", icon }) {
  const TONE = {
    slate: "text-slate-900", blue: "text-blue-700", emerald: "text-emerald-700",
    amber: "text-amber-700", rose: "text-rose-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon}{label}
      </div>
      <div className={`mt-1.5 text-[26px] font-bold leading-none ${TONE[tone]}`}>{value}</div>
      {sub && <div className="mt-1.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
