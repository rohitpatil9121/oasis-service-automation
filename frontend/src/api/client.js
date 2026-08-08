// Tiny fetch wrapper. Token is kept in memory + sessionStorage via AuthContext.
export const BASE = import.meta.env.VITE_API_BASE || "";

let authToken = null;
export function setToken(t) { authToken = t; }
export function getToken() { return authToken; }

/* What to do when the server says the session is over.

   Tokens last seven days, and nothing used to notice them expiring. The stored
   user stayed put, so the app still believed it was logged in while every
   request came back 401 — the board sat empty, each page showed
   "Request failed (401)", and the only way out was to know to press Log out.
   AuthContext registers a handler here that clears the session and returns the
   manager to the login screen, which is what a finished session should do. */
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

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
  if (!res.ok) {
    // Only when we actually sent a token: a 401 from the login call itself is
    // simply a wrong password, and must stay on the form with its own message.
    if (res.status === 401 && authToken) {
      onUnauthorized?.();
      throw new Error("Your session has expired. Please sign in again.");
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
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
  sendMessage: (id, body, replyTo) => request(`/tickets/${id}/message`, { method: "POST", body: { body, replyTo } }),
  setBot: (id, on) => request(`/tickets/${id}/bot`, { method: "POST", body: { on } }),
  setStatus: (id, status, reason) =>
    request(`/tickets/${id}/status`, { method: "PATCH", body: { status, reason } }),
  // conversations (all-chats inbox)
  listConversations: () => request("/conversations"),
  // Phone-keyed thread — for chats that have no ticket yet (intake still in
  // progress, or a sender who never raised a request).
  getPhoneConversation: (phone) => request(`/conversations/thread?phone=${encodeURIComponent(phone)}`),
  sendPhoneMessage: (phone, body, replyTo) =>
    request("/conversations/thread/message", { method: "POST", body: { phone, body, replyTo } }),
  setPhoneBot: (phone, on) =>
    request("/conversations/thread/bot", { method: "POST", body: { phone, on } }),
  // customers
  listCustomers: () => request("/customers"),
  getCustomer: (id) => request(`/customers/${id}`),
  // technicians
  listTechnicians: () => request("/technicians"),
  createTechnician: (payload) => request("/technicians", { method: "POST", body: payload }),
  getTechnician: (id) => request(`/technicians/${id}`),
  removeTechnician: (id) => request(`/technicians/${id}`, { method: "DELETE" }),
  getTechnicianConversation: (id) => request(`/technicians/${id}/conversation`),
  sendTechnicianMessage: (id, body, replyTo) => request(`/technicians/${id}/message`, { method: "POST", body: { body, replyTo } }),
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
  // incentives (computed payout report)
  incentiveReport: ({ from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const s = qs.toString();
    return request(`/incentives${s ? `?${s}` : ""}`);
  },
  // GST invoices
  listInvoices: () => request("/invoices"),
  getCompanyProfile: () => request("/invoices/company"),
  updateCompanyProfile: (payload) => request("/invoices/company", { method: "PATCH", body: payload }),
  getTicketInvoice: (ticketId) => request(`/invoices/ticket/${ticketId}`),
  resendInvoice: (id, phone) => request(`/invoices/${id}/resend`, { method: "POST", body: { phone } }),
  // The PDF is binary and the route is authenticated, so it can't just be a link
  // href — fetch it with the bearer token and hand back an object URL.
  invoicePdfBlobUrl: async (id) => {
    const res = await fetch(`${BASE}/api/invoices/${id}/pdf`, {
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    });
    if (!res.ok) throw new Error(`Could not load invoice (${res.status})`);
    return URL.createObjectURL(await res.blob());
  },
  // Tally import file for a date range (defaults to the current month).
  tallyXmlBlobUrl: async ({ from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const s = qs.toString();
    const res = await fetch(`${BASE}/api/invoices/tally.xml${s ? `?${s}` : ""}`, {
      headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    });
    if (!res.ok) throw new Error(`Could not build Tally export (${res.status})`);
    return URL.createObjectURL(await res.blob());
  },
};
