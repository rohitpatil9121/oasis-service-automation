import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client.js";
import IssueStockModal from "../components/IssueStockModal.jsx";
import ReconcileModal from "../components/ReconcileModal.jsx";
import TechnicianChatPanel from "../components/TechnicianChatPanel.jsx";
import { Card, Button, Icon, Spinner, Alert } from "../components/ui.jsx";

const fmt = (d) => (d ? new Date(d).toLocaleString() : "—");

export default function TechnicianView() {
  const { id } = useParams();
  const [tech, setTech] = useState(null);
  const [issues, setIssues] = useState([]);
  const [incentive, setIncentive] = useState(null);
  const [err, setErr] = useState("");
  const [showIssue, setShowIssue] = useState(false);
  const [reconcileIssue, setReconcileIssue] = useState(null);

  const load = useCallback(async () => {
    try {
      const [{ technician }, { issues }, report] = await Promise.all([
        api.getTechnician(id), api.getTechnicianStock(id),
        api.incentiveReport().catch(() => null),
      ]);
      setTech(technician); setIssues(issues || []);
      setIncentive(report?.technicians?.find((t) => t.technician_id === id) || null);
      setErr("");
    } catch (e) { setErr(e.message); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (err && !tech) return <div><BackLink /><div className="mt-3"><Alert>{err}</Alert></div></div>;
  if (!tech) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>;

  const initials = (tech.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div>
      <BackLink />

      <div className="mt-3 mb-5 flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-base font-bold text-brand">{initials}</span>
        <div>
          <h1 className="text-xl font-bold leading-tight text-slate-900">{tech.full_name}</h1>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500">
            <span className="font-mono">{tech.phone}</span>
            {tech.email && <span className="text-slate-400">· {tech.email}</span>}
          </div>
        </div>
      </div>

      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      {/* Live location + incentive for this technician */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Live location</h3>
          {tech.last_lat != null && tech.last_lng != null ? (
            <>
              <div className="mt-1 font-mono text-sm text-slate-700">
                {Number(tech.last_lat).toFixed(5)}, {Number(tech.last_lng).toFixed(5)}
              </div>
              <div className="text-xs text-slate-400">Updated {fmt(tech.location_at)}</div>
              <a className="mt-2 inline-block text-sm font-medium text-brand hover:underline"
                href={`https://maps.google.com/?q=${tech.last_lat},${tech.last_lng}`} target="_blank" rel="noreferrer">
                Open in Google Maps ↗
              </a>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">No location yet — shows once the technician opens the app with location enabled.</p>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Incentive earned</h3>
          {incentive ? (
            <>
              <div className="mt-1 text-2xl font-bold text-emerald-600">₹{Number(incentive.total_payout).toLocaleString("en-IN")}</div>
              <div className="text-xs text-slate-400">On ₹{Number(incentive.total_billing).toLocaleString("en-IN")} billed</div>
            </>
          ) : (
            <p className="mt-1 text-sm text-slate-400">No incentive earned yet.</p>
          )}
        </Card>
      </div>

      {/* WhatsApp chat with this technician (92 number) */}
      <div className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">WhatsApp chat</h3>
        <div className="max-w-xl">
          <TechnicianChatPanel technician={tech} />
        </div>
      </div>

      {/* Stock issued (bulk) */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stock issued</h3>
            <p className="mt-0.5 text-xs text-slate-400">Parts taken in bulk. Reconcile when returned (e.g. next day).</p>
          </div>
          <Button variant="secondary" onClick={() => setShowIssue(true)}>
            <Icon name="box" /> Issue stock
          </Button>
        </div>

        {issues.length === 0 ? (
          <p className="text-sm text-slate-400">No stock issued to this technician yet.</p>
        ) : (
          <ul className="space-y-3">
            {issues.map((iss) => {
              const reconciled = iss.status === "RECONCILED";
              return (
                <li key={iss.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {reconciled
                        ? <span className="font-medium text-emerald-600">Reconciled</span>
                        : <span className="font-medium text-amber-600">Issued</span>}
                    </span>
                    <span>{fmt(iss.issued_at)}</span>
                  </div>
                  {reconciled && (
                    <div className="mb-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      <span /><span>Issued</span><span>Used</span><span>Ret.</span>
                    </div>
                  )}
                  <ul className="space-y-1">
                    {(iss.lines || []).map((l) => {
                      const v = Number(l.qty_issued) - Number(l.qty_used) - Number(l.qty_returned);
                      return (
                        <li key={l.id} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 text-sm">
                          <span className="text-slate-700">
                            {l.item?.name || "Item"}
                            {reconciled && v > 0 && <span className="ml-1.5 text-xs text-red-500">−{v} missing</span>}
                          </span>
                          {reconciled ? (
                            <>
                              <span className="text-right font-mono text-xs text-slate-500">{l.qty_issued}</span>
                              <span className="text-right font-mono text-xs text-slate-700">{l.qty_used}</span>
                              <span className="text-right font-mono text-xs text-emerald-600">{l.qty_returned}</span>
                            </>
                          ) : (
                            <span className="col-span-3 text-right font-mono text-xs text-slate-500">{l.qty_issued} {l.item?.unit || ""}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {!reconciled && (
                    <div className="mt-2.5 flex justify-end border-t border-slate-100 pt-2.5">
                      <Button variant="secondary" onClick={() => setReconcileIssue(iss)} className="px-3 py-1.5 text-xs">
                        <Icon name="check" className="h-3.5 w-3.5" /> Reconcile stock
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {showIssue && (
        <IssueStockModal technician={tech} onClose={() => setShowIssue(false)}
          onIssued={() => { setShowIssue(false); load(); }} />
      )}
      {reconcileIssue && (
        <ReconcileModal issue={reconcileIssue} onClose={() => setReconcileIssue(null)}
          onDone={() => { setReconcileIssue(null); load(); }} />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/technicians" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
      <Icon name="back" /> Back to technicians
    </Link>
  );
}
