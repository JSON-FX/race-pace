import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useMyRoles } from "./lib/roles";
import { AppShell } from "./components/AppShell";
import { Login } from "./routes/Login";
import { NoAccess } from "./routes/NoAccess";
import { Placeholder } from "./routes/Placeholder";
import { Events } from "./routes/Events";
import { EventEditor } from "./routes/EventEditor";
import { Registrations } from "./routes/Registrations";
import { Payments } from "./routes/Payments";
import { Team } from "./routes/Team";

function RequireAdmin() {
  const { session, loading } = useAuth();
  const roles = useMyRoles();
  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (roles.isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!roles.data?.isAdmin) return <Navigate to="/no-access" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route element={<RequireAdmin />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/events" replace />} />
            <Route path="events" element={<Events />} />
            <Route path="events/new" element={<EventEditor />} />
            <Route path="events/:id/edit" element={<EventEditor />} />
            <Route path="dashboard" element={<Placeholder title="Dashboard" />} />
            <Route path="registrations" element={<Registrations />} />
            <Route path="payments" element={<Payments />} />
            <Route path="check-in" element={<Placeholder title="Check-in" />} />
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<Placeholder title="Settings" />} />
            <Route path="organizations" element={<Placeholder title="Organizations" />} />
            <Route path="commission" element={<Placeholder title="Commission" />} />
            <Route path="payouts" element={<Placeholder title="Payouts" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
