import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const tables: Record<string, any[]> = {};
const errors: Record<string, { message: string }> = {};

function builder(name: string) {
  const result = () => (errors[name] ? { data: null, error: errors[name] } : { data: tables[name] ?? [], error: null });
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain, in: () => chain,
    limit: () => Promise.resolve(result()),
    maybeSingle: () => Promise.resolve(errors[name] ? { data: null, error: errors[name] } : { data: (tables[name] ?? [])[0] ?? null, error: null }),
    then: (res: any) => Promise.resolve(result()).then(res),
  };
  return chain;
}

vi.mock("../lib/supabase", () => ({ supabase: { from: (n: string) => builder(n) } }));
let rolesResult: any = { data: { orgId: "a1", isAdmin: true }, isLoading: false };
vi.mock("../lib/roles", () => ({ useMyRoles: () => rolesResult }));

import { Dashboard } from "../routes/Dashboard";

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(errors)) delete errors[k];
  rolesResult = { data: { orgId: "a1", isAdmin: true }, isLoading: false };
});

it("tells a super_admin no organization is selected instead of 'create your first event'", async () => {
  // A super_admin has no admin/editor row, so useMyRoles().orgId is null and all four
  // queries stay disabled. React Query v5 reports isLoading === false for a disabled
  // query, so both guards above fall through — and `/` now sends super_admins straight
  // here, making this the first screen they see.
  rolesResult = { data: { orgId: null, isAdmin: true, isSuperAdmin: true }, isLoading: false };
  renderDash();
  expect(await screen.findByText(/no organization selected/i)).toBeInTheDocument();
  expect(screen.queryByText(/create your first event/i)).not.toBeInTheDocument();
});

it("shows the loading skeleton, not the no-organization state, while roles are still resolving", async () => {
  rolesResult = { data: undefined, isLoading: true };
  const { container } = renderDash();
  expect(screen.queryByText(/no organization selected/i)).not.toBeInTheDocument();
  expect(container.querySelectorAll(".rounded-xl").length).toBeGreaterThan(0);
});

it("renders the empty state instead of four zeros when there are no events", async () => {
  tables.events = [];
  tables.admin_org_totals_v = [];
  tables.admin_event_totals_v = [];
  tables.admin_registrations_v = [];
  renderDash();
  expect(await screen.findByText(/create your first event/i)).toBeInTheDocument();
});

it("explains an events-but-no-registrations org rather than implying breakage", async () => {
  tables.events = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", status: "published" }];
  tables.admin_org_totals_v = [];
  tables.admin_event_totals_v = [];
  tables.admin_registrations_v = [];
  renderDash();
  expect(await screen.findByText(/no registrations yet/i)).toBeInTheDocument();
});

it("formats centavos as pesos only at the render edge", async () => {
  tables.events = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", status: "published" }];
  tables.admin_org_totals_v = [{ org_id: "a1", reg_count: 3, paid_count: 2, pending_count: 1, gross_revenue: 300000, net_to_org: 270000, platform_fee: 30000 }];
  tables.admin_event_totals_v = [{ org_id: "a1", event_id: "e1", reg_count: 3, gross_revenue: 300000 }];
  tables.admin_registrations_v = [{ id: "r1", event_id: "e1", full_name: "Ana Cruz", category_label: "10K", payment_status: "paid", created_at: "2026-08-06T01:00:00Z" }];

  renderDash();
  await waitFor(() => expect(screen.getAllByText("₱3,000.00").length).toBeGreaterThan(0));
  expect(screen.getByText("₱2,700.00")).toBeInTheDocument();
  expect(screen.getByText("2 paid · 1 pending")).toBeInTheDocument();
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getAllByText("Apo Sky Ultra").length).toBeGreaterThan(0);
});

it("shows an error state and does not crash when org totals fails to load", async () => {
  tables.events = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", status: "published" }];
  tables.admin_event_totals_v = [{ org_id: "a1", event_id: "e1", reg_count: 3, gross_revenue: 300000 }];
  tables.admin_registrations_v = [{ id: "r1", event_id: "e1", full_name: "Ana Cruz", category_label: "10K", payment_status: "paid", created_at: "2026-08-06T01:00:00Z" }];
  errors.admin_org_totals_v = { message: "boom" };

  renderDash();
  expect(await screen.findByText(/couldn't load the dashboard/i)).toBeInTheDocument();
  // The non-null assertion this replaced would have thrown reading reg_count off undefined data.
  expect(screen.queryByText(/registrations$/i)).not.toBeInTheDocument();
});

it("shows an error state without the create-first-event CTA when the events query fails", async () => {
  tables.admin_org_totals_v = [{ org_id: "a1", reg_count: 3, paid_count: 2, pending_count: 1, gross_revenue: 300000, net_to_org: 270000, platform_fee: 30000 }];
  tables.admin_event_totals_v = [];
  tables.admin_registrations_v = [];
  errors.events = { message: "boom" };

  renderDash();
  expect(await screen.findByText(/couldn't load the dashboard/i)).toBeInTheDocument();
  // This is the lie under test: an org with events must never be told to create its "first" one.
  expect(screen.queryByText(/create your first event/i)).not.toBeInTheDocument();
});
