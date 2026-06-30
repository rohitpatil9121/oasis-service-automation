import { useEffect, useState, useCallback } from "react";
import { api } from "../api/client.js";
import { Card, Icon, Input, Button, Alert, EmptyState, Spinner } from "../components/ui.jsx";

const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
// IST calendar day as YYYY-MM-DD (matches the backend's day boundaries).
const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const monthStart = () => istToday().slice(0, 8) + "01";

const BRAND_LABEL = { kent: "Kent", aquaguard: "Aquaguard", oasis: "Oasis", other: "Other" };

export default function Incentives() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(istToday());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null); // expanded technician id

  const load = useCallback(async (range) => {
    setLoading(true);
    try {
      setReport(await api.incentiveReport(range));
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load({ from, to }); }, []); // initial: this month

  const apply = () => load({ from, to });
  const preset = (f, t) => { setFrom(f); setTo(t); load({ from: f, to: t }); };

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Incentives</h1>
        <p className="mt-0.5 text-sm text-slate-400">
          Technician payouts, computed from closed jobs. Kent/Aquaguard earn 6% (10% once a
          technician bills ₹10,000 in a day); Oasis earns the margin (−18% on online payments).
        </p>
      </div>

      {/* Date range + presets */}
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">From</span>
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">To</span>
          <Input type="date" value={to} min={from} max={istToday()} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button onClick={apply}>Apply</Button>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => preset(istToday(), istToday())}>Today</Button>
          <Button variant="secondary" onClick={() => preset(monthStart(), istToday())}>This month</Button>
          <Button variant="ghost" onClick={() => preset("", "")}>All time</Button>
        </div>
      </Card>

      {err && <Alert>{err}</Alert>}

      {/* Total payout headline */}
      {report && !loading && (
        <Card className="mb-4 bg-gradient-to-br from-brand to-brand-dark p-5 text-white">
          <div className="text-sm text-white/80">Total payout for this period</div>
          <div className="text-3xl font-extrabold">{inr(report.total_payout)}</div>
          <div className="mt-1 text-sm text-white/70">{report.technicians.length} technician(s)</div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-14"><Spinner className="h-8 w-8" /></div>
      ) : !report?.technicians?.length ? (
        <EmptyState icon="users" title="No payouts in this period"
          hint="Closed jobs with branded parts will show up here." />
      ) : (
        <div className="space-y-3">
          {report.technicians.map((t) => (
            <Card key={t.technician_id} className="overflow-hidden">
              <button onClick={() => setOpen(open === t.technician_id ? null : t.technician_id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50">
                <div>
                  <div className="font-semibold text-slate-800">{t.technician_name}</div>
                  <div className="text-xs text-slate-400">Billing {inr(t.total_billing)} · {t.days.length} day(s)</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-extrabold text-brand">{inr(t.total_payout)}</span>
                  <Icon name="chevron" className={`h-4 w-4 text-slate-400 transition ${open === t.technician_id ? "rotate-180" : ""}`} />
                </div>
              </button>

              {open === t.technician_id && (
                <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                  {t.days.map((d) => (
                    <div key={d.date} className="mb-3 last:mb-0">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700">
                          {d.date}
                          {d.target_hit && (
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700">
                              10% unlocked
                            </span>
                          )}
                        </span>
                        <span className="text-slate-500">Billing {inr(d.billing)} · <b className="text-brand">{inr(d.payout)}</b></span>
                      </div>
                      <div className="mt-1 space-y-1">
                        {d.jobs.map((j) => (
                          <div key={j.ticket_id} className="rounded-lg bg-white px-3 py-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-slate-500">{j.ticket_number || j.ticket_id.slice(0, 8)}</span>
                              <span className="flex items-center gap-2">
                                <span className="capitalize text-slate-400">{j.payment_mode}</span>
                                <b className="text-slate-700">{inr(j.payout)}</b>
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-slate-500">
                              {j.parts.map((p, i) => (
                                <span key={i}>
                                  {BRAND_LABEL[p.brand] || p.brand} {inr(p.price)} → {inr(p.payout)}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
