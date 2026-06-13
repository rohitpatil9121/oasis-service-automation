import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-full">
      <header className="bg-brand text-white shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="inline-block h-6 w-6 rounded-full bg-brand-light" />
            Oasis Globe
            <span className="ml-1 font-normal text-brand-light text-sm">Service Manager</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="opacity-90">{user?.full_name} · {user?.role}</span>
            <button onClick={logout}
              className="rounded bg-white/15 px-3 py-1 hover:bg-white/25">
              Logout
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
