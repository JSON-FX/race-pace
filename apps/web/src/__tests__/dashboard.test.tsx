import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const tables: Record<string, any[]> = {};

function builder(name: string) {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain, in: () => chain,
    limit: () => Promise.resolve({ data: tables[name] ?? [], error: null }),
    maybeSingle: () => Promise.resolve({ data: (tables[name] ?? [])[0] ?? null, error: null }),
    then: (res: any) => Promise.resolve({ data: tables[name] ?? [], error: null }).then(res),
  };
  return chain;
}

vi.mock("../lib/supabase", () => ({ supabase: { from: (n: string) => builder(n) } }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1", isAdmin: true }, isLoading: false }) }));

import { Dashboard } from "../routes/Dashboard";

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
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
