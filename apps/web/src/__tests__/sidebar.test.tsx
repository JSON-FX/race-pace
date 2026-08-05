import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { SidebarProvider } from "../components/ui/sidebar";
import type { MyRoles } from "../lib/roles";

let mockRoles: { data?: MyRoles } = {};
vi.mock("../lib/roles", () => ({ useMyRoles: () => mockRoles }));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ signOut: vi.fn(), session: { user: { email: "admin@racepace.test" } } }),
}));

const roles = (over: Partial<MyRoles> = {}): MyRoles => ({
  role: "admin", orgId: "a1", isSuperAdmin: false, isAdmin: true,
  isOrgAdmin: true, isMarshal: false, canCheckIn: true, ...over,
});

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    </MemoryRouter>
  );
}

it("org admin sees the org nav, not the platform items", () => {
  mockRoles = { data: roles() };
  renderSidebar();
  expect(screen.getByText("Events")).toBeInTheDocument();
  expect(screen.getByText("Check-in")).toBeInTheDocument();
  expect(screen.queryByText("Payouts")).not.toBeInTheDocument();
});

it("super_admin also sees the platform items", () => {
  mockRoles = { data: roles({ isSuperAdmin: true }) };
  renderSidebar();
  expect(screen.getByText("Organizations")).toBeInTheDocument();
  expect(screen.getByText("Payouts")).toBeInTheDocument();
});

it("hides Team from an admin who is not an org admin", () => {
  mockRoles = { data: roles({ isOrgAdmin: false }) };
  renderSidebar();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});

it("shows the dark-mode toggle in the footer", () => {
  mockRoles = { data: roles() };
  renderSidebar();
  expect(screen.getByLabelText("Toggle dark mode")).toBeInTheDocument();
});

it("a marshal sees only Check-in", () => {
  mockRoles = {
    data: roles({ role: "marshal", orgId: null, isAdmin: false, isOrgAdmin: false, isMarshal: true }),
  };
  renderSidebar();
  expect(screen.getByText("Check-in")).toBeInTheDocument();
  expect(screen.queryByText("Events")).not.toBeInTheDocument();
  expect(screen.queryByText("Payments")).not.toBeInTheDocument();
  expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});

it("labels a marshal as Marshal in the footer", () => {
  mockRoles = {
    data: roles({ role: "marshal", orgId: null, isAdmin: false, isOrgAdmin: false, isMarshal: true }),
  };
  renderSidebar();
  expect(screen.getByText("Marshal")).toBeInTheDocument();
});
