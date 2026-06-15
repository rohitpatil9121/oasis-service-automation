import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { Card, Icon, Input, Alert, EmptyState } from "../components/ui.jsx";

export default function Customers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const { customers } = await api.listCustomers();
      setCustomers(customers);
      setErr("");
    } catch (e) { setErr(e.message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = customers.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.full_name?.toLowerCase().includes(q) ||
      c.phone?.includes(q) ||
      c.address?.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Clients</h1>
        <p className="mt-0.5 text-sm text-slate-400">Everyone who has raised a service request.</p>
      </div>

      <div className="mb-4 relative max-w-sm">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Icon name="search" />
        </span>
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, mobile, location…" className="pl-9" />
      </div>

      {err && <Alert>{err}</Alert>}

      {!loaded ? (
        <div className="rounded-xl border border-slate-200 bg-white py-14 text-center text-slate-400">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState icon="user" title="No clients yet" hint={search ? "Try a different search." : "Customers appear here once they raise a request."} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Mobile</th>
                  <th className="px-4 py-3 font-semibold">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)}
                    className="cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                          {(c.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </span>
                        <span className="font-medium text-slate-800">{c.full_name || <span className="text-slate-300">—</span>}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{c.phone}</td>
                    <td className="px-4 py-3 text-slate-600">{c.address || <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
