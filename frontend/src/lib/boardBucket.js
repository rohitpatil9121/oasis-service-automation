// Dashboard board bucket labels + colours (data comes from API as board_bucket).

export const BUCKET_LABEL = {
  new: "New",
  pending: "Pending",
  assigned: "Assigned",
  service_done: "Service Done",
  installation: "Installation",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const BUCKET_HINT = {
  new: "Today's leads, details complete",
  pending: "Carry-over, reopened & incomplete",
  assigned: "Technician in the field",
  service_done: "Closed · last 7 days",
  installation: "New machine fitted",
  completed: "Archived · 7+ days",
  cancelled: "Called off · not serviced",
};

export const BUCKET_COLOR = {
  new: "blue",
  pending: "orange",
  assigned: "amber",
  service_done: "emerald",
  installation: "amber",
  completed: "slate",
  cancelled: "slate",
};

export const DASHBOARD_BUCKETS = [
  { key: "new", label: "New", icon: "alert", color: "blue" },
  { key: "pending", label: "Pending", icon: "clock", color: "orange" },
  { key: "assigned", label: "Assigned", icon: "wrench", color: "amber" },
  { key: "service_done", label: "Service Done", icon: "check", color: "emerald" },
  /* Installation reads ACROSS the buckets rather than being one: an installed
     job is still Service Done or Completed, and pulling it out would leave those
     counts short. Dashboard.jsx matches it on the ticket's `installation` flag
     instead of on board_bucket. */
  { key: "installation", label: "Installation", icon: "install", color: "amber" },
  { key: "completed", label: "Completed", icon: "grid", color: "slate" },
  { key: "cancelled", label: "Cancelled", icon: "x", color: "slate" },
  { key: "", label: "All requests", icon: "inbox", color: "indigo" },
];
