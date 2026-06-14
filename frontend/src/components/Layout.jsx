import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Icon } from "./ui.jsx";

const NAV = [
  { to: "/", label: "Inbox", icon: "inbox", end: true },
  { to: "/technicians", label: "Technicians", icon: "users" },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const initials = (user?.full_name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-xs font-extrabold text-white">OG</span>
            <span className="font-bold text-slate-900">Oasis Globe</span>
            <span className="hidden text-sm text-slate-400 sm:inline">· Service Manager</span>
          </Link>

          <nav className="ml-4 flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? "bg-brand/10 text-brand" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}>
                <Icon name={n.icon} className="h-4 w-4" />
                <span className="hidden sm:inline">{n.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight text-slate-700">{user?.full_name}</div>
              <div className="text-xs capitalize leading-tight text-slate-400">{user?.role}</div>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand">{initials}</span>
            <button onClick={logout} title="Log out"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <Icon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
