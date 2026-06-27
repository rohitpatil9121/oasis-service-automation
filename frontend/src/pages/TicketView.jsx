import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.jsx";
import AssignModal from "../components/AssignModal.jsx";
import ScheduleModal from "../components/ScheduleModal.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import EditCustomerModal from "../components/EditCustomerModal.jsx";
import CancelModal from "../components/CancelModal.jsx";
import { Card, Button, Icon, Select, Spinner, Alert, Textarea } from "../components/ui.jsx";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const fmtSlot = (s, e) => {
  if (!s) return "—";
  const start = new Date(s).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  if (!e) return start;
  const end = new Date(e).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  return `${start} – ${end}`;
};
const STATUSES = ["NEW", "CLOSED", "CANCELLED"];
const STATUS_LABEL = { NEW: "New", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", CLOSED: "Closed", CANCELLED: "Cancelled" };

export default function TicketView() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [history, setHistory] = useState({ events: [], assignments: [] });
  const [showAssign, setShowAssign] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [editIssue, setEditIssue] = useState(false);
  const [issueText, setIssueText] = useState("");
  const [issueErr, setIssueErr] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ ticket }, h] = await Promise.all([api.getTicket(id), api.getHistory(id)]);
      setTicket(ticket); setHistory(h); setErr("");
    } catch (e) { setErr(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(s) {
    if (s === "CANCELLED") { setShowCancel(true); return; }
    setBusy(true);
    try { await api.setStatus(id, s); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function confirmCancel(reason) {
    await api.setStatus(id, "CANCELLED", reason);
    setShowCancel(false);
    await load();
  }

  function startEditIssue() { setIssueText(ticket.issue_description || ""); setIssueErr(""); setEditIssue(true); }
  async function saveIssue() {
    if (!issueText.trim()) return setIssueErr("Issue can't be empty.");
    setBusy(true); setIssueErr("");
    try { await api.updateIssue(id, issueText); setEditIssue(false); await load(); }
    catch (e) { setIssueErr(e.message); } finally { setBusy(false); }
  }

  if (err && !ticket) return <div><BackLink /><div className="mt-3"><Alert>{err}</Alert></div></div>;
  if (!ticket) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>;

  const assignments = [...(history.assignments || [])].reverse();
  const initials = (ticket.customer?.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const closed = ticket.status === "CLOSED" || ticket.status === "CANCELLED";

  return (
    <div>
      <BackLink />

      {/* Header */}
      <div className="mt-3 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-base font-bold text-brand">{initials}</span>
          <div>
            <h1 className="text-xl font-bold leading-tight text-slate-900">{ticket.customer?.full_name || "Customer"}</h1>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{ticket.ticket_number}</span>
              <StatusBadge status={ticket.status} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={ticket.status} disabled={busy} onChange={(e) => changeStatus(e.target.value)} className="w-auto">
            {STATUSES.includes(ticket.status)
              ? STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)
              : [ticket.status, ...STATUSES].map((s) => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)
            }
          </Select>
          {!closed && (
            <Button onClick={() => setShowAssign(true)}>
              <Icon name="wrench" /> {ticket.technician ? "Reassign" : "Assign"}
            </Button>
          )}
        </div>
      </div>

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      {ticket.intake_complete === false && ticket.status === "NEW" && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
          Collecting details from the customer on WhatsApp — this request updates live as they reply.
        </div>
      )}

      {/* Details */}
      <Card className="mb-5">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Details</span>
          <button onClick={() => setShowEditCustomer(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            <Icon name="edit" className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
        <dl className="grid sm:grid-cols-2">
          <Row label="Customer" value={ticket.customer?.full_name || "—"} />
          <Row label="Phone" value={ticket.customer?.phone} mono />
          <Row label="Address" value={ticket.customer?.address || "—"} />
          <Row label="Appliance" value={ticket.appliance || "—"} />
          <Row label="Source" value={ticket.source === "whatsapp" ? "WhatsApp" : "Manual entry"} />
          <Row label="Lead source" value={ticket.lead_source === "KENT" ? "KENT" : "Oasis Globe (our service team)"} />
          <Row label="Technician" value={ticket.technician?.full_name || "Unassigned"} />
          <Row label="Created" value={fmt(ticket.created_at)} />
          {ticket.closed_at && <Row label="Closed" value={fmt(ticket.closed_at)} />}
        </dl>
      </Card>

      {/* Issue + Customer chat side by side */}
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Issue</h3>
            {!editIssue && (
              <button onClick={startEditIssue}
                className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                <Icon name="edit" className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>
          {editIssue ? (
            <div>
              <Textarea value={issueText} onChange={(e) => setIssueText(e.target.value)} rows={4} autoFocus />
              {issueErr && <p className="mt-1 text-xs text-red-600">{issueErr}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditIssue(false)}>Cancel</Button>
                <Button onClick={saveIssue} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-slate-700">{ticket.issue_description}</p>
          )}
          <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
            Missing or unclear details? Message the customer on the right to confirm before assigning.
          </div>
        </Card>
        <ChatPanel ticket={ticket} />
      </div>

      {/* Visit schedule */}
      <Card className="mb-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Visit schedule</h3>
            {ticket.scheduled_start ? (
              <p className="mt-1 flex items-center gap-1.5 font-medium text-slate-700">
                <Icon name="calendar" className="h-4 w-4 text-brand" />
                {fmtSlot(ticket.scheduled_start, ticket.scheduled_end)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Not scheduled yet.</p>
            )}
          </div>
          {!closed && (
            <Button variant="secondary" onClick={() => setShowSchedule(true)}>
              <Icon name="calendar" /> {ticket.scheduled_start ? "Reschedule" : "Schedule visit"}
            </Button>
          )}
        </div>
      </Card>

      {/* History + Activity */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Assignment history</h3>
          {assignments.length === 0 ? (
            <p className="text-sm text-slate-400">Not assigned yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    <Icon name="wrench" className="mr-1.5 inline h-3.5 w-3.5 text-slate-400" />
                    <b>{a.technician?.full_name}</b>
                    {a.assigner?.full_name ? <span className="text-slate-400"> · by {a.assigner.full_name}</span> : null}
                    {a.note ? <span className="text-slate-400"> — {a.note}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{fmt(a.assigned_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Activity log</h3>
          <ul className="space-y-2.5">
            {history.events.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">
                  <span className="font-medium capitalize">{e.event_type.replace("_", " ")}</span>
                  {e.to_status ? <span className="text-slate-400"> → {STATUS_LABEL[e.to_status] || e.to_status}</span> : null}
                  {e.meta?.reason ? <span className="text-slate-400"> — {e.meta.reason}</span> : null}
                  <span className="text-slate-400"> · {e.actor?.full_name || "system/customer"}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">{fmt(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {showAssign && (
        <AssignModal ticket={ticket} onClose={() => setShowAssign(false)}
          onAssigned={() => { setShowAssign(false); load(); }} />
      )}

      {showSchedule && (
        <ScheduleModal ticket={ticket} onClose={() => setShowSchedule(false)}
          onScheduled={() => { setShowSchedule(false); load(); }} />
      )}

      {showEditCustomer && (
        <EditCustomerModal ticket={ticket} onClose={() => setShowEditCustomer(false)}
          onUpdated={() => { setShowEditCustomer(false); load(); }} />
      )}

      {showCancel && (
        <CancelModal ticket={ticket} onClose={() => setShowCancel(false)} onConfirm={confirmCancel} />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
      <Icon name="back" /> Back to inbox
    </Link>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3 sm:odd:border-r">
      <dt className="shrink-0 text-sm text-slate-400">{label}</dt>
      <dd className={`text-right text-sm text-slate-700 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
