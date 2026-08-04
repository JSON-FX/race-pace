import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { SidebarProvider } from "../components/ui/sidebar";

let mockRoles: { data?: { isSuperAdmin: boolean; isOrgAdmin?: boolean } } = {};
vi.mock("../lib/roles", () => ({ useMyRoles: () => mockRoles }));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ signOut: vi.fn(), session: { user: { email: "admin@racepace.test" } } }),
}));

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    </MemoryRouter>
  );
}

it("org admin sees 6 nav items, not the platform ones", () => {
  mockRoles = { data: { isSuperAdmin: false } };
  renderSidebar();
  expect(screen.getByText("Events")).toBeInTheDocument();
  expect(screen.queryByText("Payouts")).not.toBeInTheDocument();
});

it("super_admin also sees the platform items", () => {
  mockRoles = { data: { isSuperAdmin: true } };
  renderSidebar();
  expect(screen.getByText("Organizations")).toBeInTheDocument();
  expect(screen.getByText("Payouts")).toBeInTheDocument();
});

it("hides Team from an admin who is not an org admin", () => {
  mockRoles = { data: { isSuperAdmin: false, isOrgAdmin: false } };
  renderSidebar();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});

it("shows the dark-mode toggle in the footer", () => {
  mockRoles = { data: { isSuperAdmin: false, isOrgAdmin: true } };
  renderSidebar();
  expect(screen.getByLabelText("Toggle dark mode")).toBeInTheDocument();
});
