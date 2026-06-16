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
  scheduleVisit: (id, start, end) =>
    request(`/tickets/${id}/schedule`, { method: "POST", body: { start, end } }),
  updateCustomer: (id, payload) => request(`/tickets/${id}/customer`, { method: "PATCH", body: payload }),
  updateIssue: (id, issue_description) => request(`/tickets/${id}/issue`, { method: "PATCH", body: { issue_description } }),
  getConversation: (id) => request(`/tickets/${id}/conversation`),
  sendMessage: (id, body) => request(`/tickets/${id}/message`, { method: "POST", body: { body } }),
  setBot: (id, on) => request(`/tickets/${id}/bot`, { method: "POST", body: { on } }),
  setStatus: (id, status) =>
    request(`/tickets/${id}/status`, { method: "PATCH", body: { status } }),
  // customers
  listCustomers: () => request("/customers"),
  getCustomer: (id) => request(`/customers/${id}`),
  // technicians
  listTechnicians: () => request("/technicians"),
  createTechnician: (payload) => request("/technicians", { method: "POST", body: payload }),
  getTechnician: (id) => request(`/technicians/${id}`),
  removeTechnician: (id) => request(`/technicians/${id}`, { method: "DELETE" }),
  getTechnicianConversation: (id) => request(`/technicians/${id}/conversation`),
  sendTechnicianMessage: (id, body) => request(`/technicians/${id}/message`, { method: "POST", body: { body } }),
  // stock (bulk, per technician)
  listStock: () => request("/stock"),
  createStockItem: (payload) => request("/stock", { method: "POST", body: payload }),
  updateStockItem: (id, payload) => request(`/stock/${id}`, { method: "PATCH", body: payload }),
  removeStockItem: (id) => request(`/stock/${id}`, { method: "DELETE" }),
  getTechnicianStock: (techId) => request(`/technicians/${techId}/stock-issues`),
  issueStockToTechnician: (techId, lines) =>
    request(`/technicians/${techId}/stock-issue`, { method: "POST", body: { lines } }),
  reconcileStock: (issueId, lines) =>
    request(`/stock/issues/${issueId}/reconcile`, { method: "POST", body: { lines } }),
};
