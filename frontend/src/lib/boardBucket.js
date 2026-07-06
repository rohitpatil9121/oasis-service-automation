// Dashboard board bucket labels + colours (data comes from API as board_bucket).

export const BUCKET_LABEL = {
  new: "New",
  pending: "Pending",
  assigned: "Assigned",
  service_done: "Service Done",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const BUCKET_HINT = {
  new: "Today's unassigned leads",
  pending: "Carry-over & reopened",
  assigned: "Technician in the field",
  service_done: "Closed · last 7 days",
  completed: "Archived · 7+ days",
  cancelled: "Cancelled",
};

export const BUCKET_COLOR = {
  new: "blue",
  pending: "orange",
  assigned: "amber",
  service_done: "emerald",
  completed: "slate",
  cancelled: "slate",
};

export const DASHBOARD_BUCKETS = [
  { key: "new", label: "New", icon: "alert", color: "blue" },
  { key: "pending", label: "Pending", icon: "clock", color: "orange" },
  { key: "assigned", label: "Assigned", icon: "wrench", color: "amber" },
  { key: "service_done", label: "Service Done", icon: "check", color: "emerald" },
  { key: "completed", label: "Completed", icon: "grid", color: "slate" },
  { key: "", label: "All requests", icon: "inbox", color: "indigo" },
];
