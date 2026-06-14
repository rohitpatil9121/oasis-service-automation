// Tiny fetch wrapper. Token is kept in memory + sessionStorage via AuthContext.
const BASE = import.meta.env.VITE_API_BASE || "";

let authToken = null;
export function setToken(t) { authToken = t; }

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  // auth
  login: (phone, password) => request("/auth/login", { method: "POST", body: { phone, password } }),
  requestOtp: (phone) => request("/auth/otp/request", { method: "POST", body: { phone } }),
  verifyOtp: (phone, code) => request("/auth/otp/verify", { method: "POST", body: { phone, code } }),
  me: () => request("/auth/me"),
  // tickets
  listTickets: (status) => request(`/tickets${status ? `?status=${status}` : ""}`),
  getTicket: (id) => request(`/tickets/${id}`),
  getHistory: (id) => request(`/tickets/${id}/history`),
  createTicket: (payload) => request("/tickets", { method: "POST", body: payload }),
  assign: (id, technician_id, note) =>
    request(`/tickets/${id}/assign`, { method: "POST", body: { technician_id, note } }),
  setStatus: (id, status) =>
    request(`/tickets/${id}/status`, { method: "PATCH", body: { status } }),
  // technicians
  listTechnicians: () => request("/technicians"),
  createTechnician: (payload) => request("/technicians", { method: "POST", body: payload }),
  // stock
  listStock: () => request("/stock"),
  createStockItem: (payload) => request("/stock", { method: "POST", body: payload }),
  listStockIssues: (ticketId) => request(`/tickets/${ticketId}/stock-issues`),
  issueStock: (ticketId, technician_id, lines) =>
    request(`/tickets/${ticketId}/stock-issue`, { method: "POST", body: { technician_id, lines } }),
};
