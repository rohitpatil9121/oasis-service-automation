import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import BoardBadge from "../components/BoardBadge.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import AssignModal from "../components/AssignModal.jsx";
import ChatPanel from "../components/ChatPanel.jsx";
import EditCustomerModal from "../components/EditCustomerModal.jsx";
import CancelModal from "../components/CancelModal.jsx";
import RatingStars from "../components/RatingStars.jsx";
import InvoiceCard from "../components/InvoiceCard.jsx";
import { Card, Button, Icon, Select, Spinner, Alert, Textarea } from "../components/ui.jsx";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const STATUSES = ["NEW", "CLOSED", "CANCELLED"];
// Closed reads as "Service done" here to match the board column the ticket
// lands in once it's closed.
const STATUS_LABEL = { NEW: "New", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", CLOSED: "Service done", CANCELLED: "Cancelled" };

export default function TicketView() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [history, setHistory] = useState({ events: [], assignments: [] });
  const [showAssign, setShowAssign] = useState(false);
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
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{ticket.ticket_number}</span>
              <StatusBadge status={ticket.status} />
              {ticket.board_bucket && <BoardBadge bucket={ticket.board_bucket} reopened={!!(ticket.reopened_at || ticket.tech_work?.reopened_at)} />}
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

      {/* Details + customer chat, side by side.
          The details used to be a full-width two-column grid with the issue in a card of
          its own below it, which left the chat squeezed into a quarter of the screen and
          spread eleven short facts across a lot of empty space. One column of facts on the
          left, the conversation full-height on the right: the two things an agent actually
          reads while deciding who to send. */}
      <div className="mb-5 grid gap-5 lg:grid-cols-2 lg:items-start">
        <Card>
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Details</span>
            <button onClick={() => setShowEditCustomer(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <Icon name="edit" className="h-3.5 w-3.5" /> Edit
            </button>
          </div>
          <dl>
            <Row label="Customer" value={ticket.customer?.full_name || "—"} />
            <Row label="Address" value={ticket.customer?.address || "—"} />
            <Row label="Source" value={ticket.source === "whatsapp" ? "WhatsApp" : "Manual entry"} />
            <Row label="Technician" value={ticket.technician?.full_name || "Unassigned"} />
            <Row label="Phone" value={ticket.customer?.phone} mono />
            <Row label="Appliance" value={ticket.appliance || "—"} />
            <Row label="Lead source" value={ticket.lead_source === "KENT" ? "KENT" : "Oasis Globe (our service team)"} />
            <Row label="Created" value={fmt(ticket.created_at)} />
            {ticket.closed_at && <Row label="Closed" value={fmt(ticket.closed_at)} />}
            {(ticket.rating != null || ticket.status === "CLOSED") && (
              <Row label="Rating" value={ticket.rating != null
                ? <RatingStars value={ticket.rating} showLabel />
                : <span className="text-slate-400">Awaiting customer rating…</span>} />
            )}

            {/* The issue is the one fact here the agent edits rather than reads, so it keeps
                its own control — but it is still a fact about this request, and it belongs
                in the list with the rest of them. It only breaks out of the row when it is
                being edited, because a textarea does not fit in a right-aligned cell. */}
            {editIssue ? (
              <div className="border-b border-slate-100 px-5 py-3">
                <div className="mb-2 text-sm text-slate-400">Issue</div>
                <Textarea value={issueText} onChange={(e) => setIssueText(e.target.value)} rows={3} autoFocus />
                {issueErr && <p className="mt-1 text-xs text-red-600">{issueErr}</p>}
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setEditIssue(false)}>Cancel</Button>
                  <Button onClick={saveIssue} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
                </div>
              </div>
            ) : (
              <Row
                label="Issue"
                value={
                  <span className="inline-flex items-start gap-2">
                    <span className="whitespace-pre-wrap">{ticket.issue_description || "—"}</span>
                    <button onClick={startEditIssue} aria-label="Edit issue"
                      className="mt-0.5 shrink-0 text-brand hover:underline">
                      <Icon name="edit" className="h-3.5 w-3.5" />
                    </button>
                  </span>
                }
              />
            )}
          </dl>
          <p className="px-5 py-3 text-xs text-slate-400">
            Missing or unclear details? Message the customer on the right to confirm before assigning.
          </p>
        </Card>

        {/* Taller: the conversation is what the details are drawn from, and at h-72 it
            showed about two messages before scrolling. */}
        <ChatPanel ticket={ticket} heightClass="h-[440px]" />
      </div>

      {/* Customer notes — extra info shared on WhatsApp (timings, access, etc.).
          Also visible to the technician in the app. */}
      {ticket.notes && (
        <Card className="mb-5 border-amber-200 bg-amber-50 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600">Customer notes</h3>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">{ticket.notes}</p>
        </Card>
      )}

      {/* GST tax invoice — renders itself only once one has been issued, which
          happens when the technician records payment. */}
      <InvoiceCard ticketId={ticket.id} />

      {/* Technician photos captured on site */}
      {ticket.tech_work?.tech_photos?.length > 0 && (
        <Card className="mb-5 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Technician photos</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {ticket.tech_work.tech_photos.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt="Job" className="h-28 w-28 rounded-lg border border-slate-200 object-cover" />
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* No visit-schedule card. The slot was never how this business works: a
          request comes in, the office assigns a technician, and he goes — the
          customer is told who is coming, not a time window anyone was holding
          to. The customer-facing "visit scheduled" message has been off in
          config/notify.js since 3 Aug 2026 for the same reason, so the card was
          setting a field that no longer said anything to anybody. */}
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
    <Link to="/requests" className="inline-flex min-h-[44px] items-center gap-1 text-sm text-slate-500 transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:min-h-0">
      <Icon name="back" /> Back to inbox
    </Link>
  );
}

// One column now, so the odd-child right border that separated the two columns is gone —
// left as-is it drew a rule down the middle of a list that no longer has a middle.
function Row({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3">
      <dt className="shrink-0 text-sm text-slate-400">{label}</dt>
      <dd className={`min-w-0 text-right text-sm text-slate-700 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
