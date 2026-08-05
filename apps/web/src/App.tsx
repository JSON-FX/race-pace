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
import { Settings } from "./routes/Settings";
import { CheckIn } from "./routes/CheckIn";
import { Dashboard } from "./routes/Dashboard";

/** Shared session + roles preamble. Returns an element to render, or null to proceed. */
function useGate() {
  const { session, loading } = useAuth();
  const roles = useMyRoles();
  if (loading) return { block: <div className="p-8">Loading…</div>, roles };
  if (!session) return { block: <Navigate to="/login" replace />, roles };
  if (roles.isLoading) return { block: <div className="p-8">Loading…</div>, roles };
  return { block: null, roles };
}

function RequireAdmin() {
  const { block, roles } = useGate();
  if (block) return block;
  if (!roles.data?.isAdmin) return <Navigate to="/no-access" replace />;
  return <Outlet />;
}

/** Admins AND marshals. Mirrors canCheckIn() server-side — this gate is convenience,
 *  the RPCs and the Edge Function are the actual boundary. */
function RequireCheckInAccess() {
  const { block, roles } = useGate();
  if (block) return block;
  if (!roles.data?.canCheckIn) return <Navigate to="/no-access" replace />;
  return <Outlet />;
}

/** Roles are additive: an admin who also holds a marshal row lands on the dashboard.
 *  /check-in is the landing only for someone who is exclusively a marshal. */
function HomeRedirect() {
  const { block, roles } = useGate();
  if (block) return block;
  if (roles.data?.isAdmin) return <Navigate to="/dashboard" replace />;
  if (roles.data?.canCheckIn) return <Navigate to="/check-in" replace />;
  return <Navigate to="/no-access" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/no-access" element={<NoAccess />} />

        <Route element={<RequireCheckInAccess />}>
          <Route element={<AppShell />}>
            <Route index element={<HomeRedirect />} />
            <Route path="check-in" element={<CheckIn />} />
          </Route>
        </Route>

        <Route element={<RequireAdmin />}>
          <Route element={<AppShell />}>
            <Route path="events" element={<Events />} />
            <Route path="events/new" element={<EventEditor />} />
            <Route path="events/:id/edit" element={<EventEditor />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="registrations" element={<Registrations />} />
            <Route path="payments" element={<Payments />} />
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<Settings />} />
            <Route path="organizations" element={<Placeholder title="Organizations" />} />
            <Route path="commission" element={<Placeholder title="Commission" />} />
            <Route path="payouts" element={<Placeholder title="Payouts" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
