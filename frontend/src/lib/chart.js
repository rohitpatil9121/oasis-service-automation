/* Chart primitives for the Home report.

   Hand-rolled SVG rather than a charting library: the dashboard ships four
   dependencies today, and a chart bundle would be the largest of them for six
   small figures whose shapes never change.

   The palette is fixed and ordered. Series keep their colour whatever the
   filter does — a colour that follows rank instead of identity repaints the
   survivors the moment a series drops out, and the reader reads the change as
   data. These five were checked for colour-blind separation (worst adjacent
   pair ΔE 12.5 protan) rather than chosen by eye. */
export const SERIES = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#be123c"];

export const INK = { primary: "#0f172a", secondary: "#475569", muted: "#94a3b8" };
export const GRID = "#e2e8f0";

export const money = (n) =>
  "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

export const shortMoney = (n) => {
  const v = Math.round(Number(n) || 0);
  if (v >= 1e7) return "₹" + (v / 1e7).toFixed(1).replace(/\.0$/, "") + "Cr";
  if (v >= 1e5) return "₹" + (v / 1e5).toFixed(1).replace(/\.0$/, "") + "L";
  if (v >= 1000) return "₹" + (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return "₹" + v;
};

/** IST calendar day for a timestamp — the office's day, not the browser's. */
export const istDay = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null;

export const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** The last `n` IST days, oldest first, as YYYY-MM-DD. */
export function lastDays(n) {
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(now - i * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  }
  return out;
}

export const dayLabel = (d) => {
  const [, m, day] = d.split("-");
  return `${+day}/${+m}`;
};
