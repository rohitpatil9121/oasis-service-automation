import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Login from "./pages/Login.jsx";
import Home from "./pages/Home.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import TicketView from "./pages/TicketView.jsx";
import Technicians from "./pages/Technicians.jsx";
import TechnicianView from "./pages/TechnicianView.jsx";
import LiveMap from "./pages/LiveMap.jsx";
import Stock from "./pages/Stock.jsx";
import Incentives from "./pages/Incentives.jsx";
import Customers from "./pages/Customers.jsx";
import CustomerView from "./pages/CustomerView.jsx";
import Inbox from "./pages/Inbox.jsx";
import Layout from "./components/Layout.jsx";
import { Spinner } from "./components/ui.jsx";

function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading)
    return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  /* A page this account may not open sends it to the board rather than to an
     error: a manager typing "/" out of habit should land somewhere useful, not
     be told off. The sidebar does not offer the link in the first place. */
  if (roles && !roles.includes(user.role)) return <Navigate to="/requests" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* The Home report reads as the owner's view of the business — payouts,
          billing, who is earning what. Owner only. */}
      <Route path="/" element={<Protected roles={["owner"]}><Home /></Protected>} />
      <Route path="/requests" element={<Protected><Dashboard /></Protected>} />
      <Route path="/tickets/:id" element={<Protected><TicketView /></Protected>} />
      <Route path="/technicians" element={<Protected><Technicians /></Protected>} />
      <Route path="/technicians/:id" element={<Protected><TechnicianView /></Protected>} />
      <Route path="/live-map" element={<Protected><LiveMap /></Protected>} />
      <Route path="/stock" element={<Protected><Stock /></Protected>} />
      <Route path="/incentives" element={<Protected><Incentives /></Protected>} />
      <Route path="/chats" element={<Protected><Inbox /></Protected>} />
      <Route path="/clients" element={<Protected><Customers /></Protected>} />
      <Route path="/clients/:id" element={<Protected><CustomerView /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
