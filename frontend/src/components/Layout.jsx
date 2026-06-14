import { useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Icon } from "./ui.jsx";

// Real, working pages only — grouped like an ERP for a richer feel.
const NAV = [
  {
    group: "Service",
    items: [
      { to: "/", label: "Service Requests", icon: "inbox", end: true },
      { to: "/technicians", label: "Technicians", icon: "users" },
    ],
  },
  {
    group: "Operations",
    items: [
      { to: "/stock", label: "Inventory & Parts", icon: "box" },
    ],
  },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const initials = (user?.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  // Global search: drive the Service Requests list via ?q=. Typing anywhere
  // sends you to the inbox filtered by the query.
  const q = params.get("q") || "";
  const onSearch = (e) => {
    const value = e.target.value;
    if (location.pathname !== "/") {
      navigate(value ? `/?q=${encodeURIComponent(value)}` : "/");
    } else {
      const next = new URLSearchParams(params);
      value ? next.set("q", value) : next.delete("q");
      setParams(next, { replace: true });
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* ---------- Sidebar ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-slate-900 lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-extrabold text-white">OG</span>
          <div className="leading-tight">
            <div className="text-sm font-bold text-white">Oasis Globe</div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Service ERP</div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {NAV.map((sec) => (
            <div key={sec.group}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{sec.group}</div>
              <div className="space-y-0.5">
                {sec.items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-400 hover:bg-white/5 hover:text-white"
                      }`}>
                    <Icon name={n.icon} className="h-4 w-4" />
                    {n.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 text-[10px] text-slate-600">Phase 2 · Capture → Stock</div>
      </aside>

      {/* ---------- Main column ---------- */}
      <div className="flex min-h-screen flex-1 flex-col lg:ml-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          {/* mobile brand */}
          <Link to="/" className="flex items-center gap-2 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-xs font-extrabold text-white">OG</span>
          </Link>

          <div className="relative max-w-xl flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Icon name="search" />
            </span>
            <input
              value={q}
              onChange={onSearch}
              placeholder="Search ticket #, customer, phone, issue…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand focus:bg-white focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button title="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <Icon name="bell" />
            </button>

            {/* User chip */}
            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">{initials}</span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block text-sm font-medium text-slate-700">{user?.full_name}</span>
                  <span className="block text-xs capitalize text-slate-400">{user?.role}</span>
                </span>
                <Icon name="chevron" className="hidden h-4 w-4 text-slate-400 sm:block" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-pop">
                    <div className="border-b border-slate-100 px-3 py-2">
                      <div className="text-sm font-medium text-slate-700">{user?.full_name}</div>
                      <div className="text-xs capitalize text-slate-400">{user?.role}</div>
                    </div>
                    <button onClick={logout}
                      className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-100">
                      <Icon name="logout" className="h-4 w-4" /> Log out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* mobile nav (simple row) */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          {NAV.flatMap((s) => s.items).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
                  isActive ? "bg-brand/10 text-brand" : "text-slate-500"
                }`}>
              <Icon name={n.icon} className="h-4 w-4" /> {n.label}
            </NavLink>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
