import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import StatusBadge from "../components/StatusBadge.jsx";
import AssignModal from "../components/AssignModal.jsx";
import IssueStockModal from "../components/IssueStockModal.jsx";
import { Card, Button, Icon, Select, Spinner, Alert } from "../components/ui.jsx";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");
const STATUSES = ["NEW", "ASSIGNED", "IN_PROGRESS", "CLOSED", "CANCELLED"];
const STATUS_LABEL = { NEW: "New", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", CLOSED: "Closed", CANCELLED: "Cancelled" };

export default function TicketView() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [history, setHistory] = useState({ events: [], assignments: [] });
  const [stockIssues, setStockIssues] = useState([]);
  const [showAssign, setShowAssign] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [{ ticket }, h, s] = await Promise.all([
        api.getTicket(id), api.getHistory(id), api.listStockIssues(id),
      ]);
      setTicket(ticket); setHistory(h); setStockIssues(s.issues || []); setErr("");
    } catch (e) { setErr(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(s) {
    setBusy(true);
    try { await api.setStatus(id, s); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
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
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          {!closed && (
            <Button onClick={() => setShowAssign(true)}>
              <Icon name="wrench" /> {ticket.technician ? "Reassign" : "Assign"}
            </Button>
          )}
        </div>
      </div>

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      {/* Details */}
      <Card className="mb-5">
        <div className="border-b border-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Details</div>
        <dl className="grid sm:grid-cols-2">
          <Row label="Customer" value={ticket.customer?.full_name} />
          <Row label="Phone" value={ticket.customer?.phone} mono />
          <Row label="Address" value={ticket.customer?.address || "—"} />
          <Row label="Source" value={ticket.source === "whatsapp" ? "WhatsApp" : "Manual entry"} />
          <Row label="Technician" value={ticket.technician?.full_name || "Unassigned"} />
          <Row label="Created" value={fmt(ticket.created_at)} />
          {ticket.closed_at && <Row label="Closed" value={fmt(ticket.closed_at)} />}
        </dl>
      </Card>

      {/* Issue */}
      <Card className="mb-5 p-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Issue</h3>
        <p className="whitespace-pre-wrap text-slate-700">{ticket.issue_description}</p>
      </Card>

      {/* Stock issued */}
      <Card className="mb-5 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stock issued</h3>
          {!closed && (
            <Button variant="secondary" onClick={() => setShowIssue(true)}>
              <Icon name="box" /> Issue stock
            </Button>
          )}
        </div>
        {stockIssues.length === 0 ? (
          <p className="text-sm text-slate-400">No parts issued for this job yet.</p>
        ) : (
          <ul className="space-y-3">
            {stockIssues.map((iss) => (
              <li key={iss.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    {iss.technician?.full_name ? <>To <b className="text-slate-600">{iss.technician.full_name}</b> · </> : null}
                    {iss.status === "RECONCILED"
                      ? <span className="font-medium text-emerald-600">Reconciled</span>
                      : <span className="font-medium text-amber-600">Issued</span>}
                  </span>
                  <span>{fmt(iss.issued_at)}</span>
                </div>
                <ul className="space-y-1">
                  {(iss.lines || []).map((l) => (
                    <li key={l.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{l.item?.name || "Item"}</span>
                      <span className="font-mono text-xs text-slate-500">{l.qty_issued} {l.item?.unit || ""}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
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

      {showIssue && (
        <IssueStockModal ticket={ticket} onClose={() => setShowIssue(false)}
          onIssued={() => { setShowIssue(false); load(); }} />
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
