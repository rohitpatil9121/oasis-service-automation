// Single source of truth for ticket status → label + colour. Imported by
// StatusBadge, the dashboard KPI cards and anywhere else a status is shown, so
// the same status always reads the same colour across the app.

export const STATUS_LABEL = {
  NEW: "New",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

// Colour family per status (one name → many class maps below).
export const STATUS_COLOR = {
  NEW: "blue",
  ASSIGNED: "amber",
  IN_PROGRESS: "violet",
  CLOSED: "emerald",
  CANCELLED: "slate",
};

// Pill/badge classes (fill + text + ring) per colour family.
export const BADGE_CLS = {
  blue: "bg-blue-50 text-blue-700 ring-blue-600/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  slate: "bg-slate-100 text-slate-500 ring-slate-500/20",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/20",
};

// Square icon-chip background (used on KPI cards).
export const ICON_BG = {
  slate: "bg-slate-100 text-slate-500",
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  violet: "bg-violet-50 text-violet-600",
  emerald: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
};

// Left accent bar on KPI cards (groups cards by state at a glance).
export const ACCENT = {
  slate: "bg-slate-300",
  blue: "bg-blue-400",
  amber: "bg-amber-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-500",
  orange: "bg-orange-400",
};

// Focus/selected ring (used on the active KPI filter card).
export const RING = {
  slate: "ring-slate-300",
  blue: "ring-blue-400",
  amber: "ring-amber-400",
  violet: "ring-violet-400",
  emerald: "ring-emerald-400",
  orange: "ring-orange-400",
};
