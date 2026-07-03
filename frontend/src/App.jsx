import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import TicketView from "./pages/TicketView.jsx";
import Technicians from "./pages/Technicians.jsx";
import TechnicianView from "./pages/TechnicianView.jsx";
import Stock from "./pages/Stock.jsx";
import Incentives from "./pages/Incentives.jsx";
import Customers from "./pages/Customers.jsx";
import CustomerView from "./pages/CustomerView.jsx";
import Inbox from "./pages/Inbox.jsx";
import Layout from "./components/Layout.jsx";
import { Spinner } from "./components/ui.jsx";

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading)
    return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/tickets/:id" element={<Protected><TicketView /></Protected>} />
      <Route path="/technicians" element={<Protected><Technicians /></Protected>} />
      <Route path="/technicians/:id" element={<Protected><TechnicianView /></Protected>} />
      <Route path="/stock" element={<Protected><Stock /></Protected>} />
      <Route path="/incentives" element={<Protected><Incentives /></Protected>} />
      <Route path="/chats" element={<Protected><Inbox /></Protected>} />
      <Route path="/clients" element={<Protected><Customers /></Protected>} />
      <Route path="/clients/:id" element={<Protected><CustomerView /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
