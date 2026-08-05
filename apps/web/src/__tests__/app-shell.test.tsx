import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { EMPTY_STORE, enqueue, storageKey } from "../lib/checkinQueue";
import type { MyRoles } from "../lib/roles";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
// orgId: null keeps TopBar's org-name query disabled, so it never touches the
// supabase stub above.
const roles: MyRoles = {
  role: "marshal", orgId: null, isSuperAdmin: false, isAdmin: false,
  isOrgAdmin: false, isMarshal: true, canCheckIn: true,
};
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: roles }) }));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ signOut: vi.fn(), session: { user: { email: "marshal@racepace.test" } } }),
}));

function GoTo({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>{label}</button>;
}

function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/check-in"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/check-in" element={<GoTo to="/dashboard" label="go to dashboard" />} />
            <Route path="/dashboard" element={<div>Dashboard screen</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fireBeforeUnload() {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev;
}

const rosterRow = {
  registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz",
  bib: "ANA", category: "10K", status: "paid", checked_in_at: null,
};

beforeEach(() => localStorage.clear());

it("does not warn when nothing is unsent", () => {
  renderShell();
  expect(fireBeforeUnload().defaultPrevented).toBe(false);
});

it("warns on close while a scan is queued for /check-in", () => {
  renderShell();
  const s = enqueue(EMPTY_STORE, rosterRow, "tok1", "c1", "2026-08-06T01:00:00Z");
  localStorage.setItem(storageKey("e1"), JSON.stringify(s));

  expect(fireBeforeUnload().defaultPrevented).toBe(true);
});

it("stays armed after navigating away from /check-in to Dashboard, unlike a route-local effect", async () => {
  const user = userEvent.setup();
  renderShell();
  const s = enqueue(EMPTY_STORE, rosterRow, "tok1", "c1", "2026-08-06T01:00:00Z");
  localStorage.setItem(storageKey("e1"), JSON.stringify(s));

  await user.click(screen.getByText("go to dashboard"));
  await screen.findByText("Dashboard screen"); // check-in route is now unmounted

  expect(fireBeforeUnload().defaultPrevented).toBe(true);
});
