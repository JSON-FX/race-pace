import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) } },
}));
// The camera is not available in jsdom; the roster path is what this test drives.
vi.mock("../components/QrScanner", () => ({ QrScanner: () => <div data-testid="qr-scanner" /> }));

import { CheckIn } from "../routes/CheckIn";

const EVENTS = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", end_date: null }];
const ROSTER = [
  { registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz", bib: "ANA", category: "10K", status: "paid", checked_in_at: null },
  { registration_id: "r2", ticket_token: "tok2", runner: "Ben Reyes", bib: "BEN", category: "21K", status: "paid", checked_in_at: "2026-08-06T01:00:00Z" },
];

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CheckIn /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === "checkin_events" ? EVENTS : ROSTER, error: null }));
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, registration_id: "r1" }) })));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("auto-selects the only event and shows roster progress", async () => {
  renderRoute();
  expect(await screen.findByText(/Apo Sky Ultra/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/1 \/ 2 checked in/)).toBeInTheDocument());
});

it("shows the roster sync state so the marshal knows offline will work", async () => {
  renderRoute();
  expect(await screen.findByText(/Roster synced/)).toBeInTheDocument();
  expect(screen.getByText(/2 runners/)).toBeInTheDocument();
});

it("checks a runner in from the roster list", async () => {
  const user = userEvent.setup();
  renderRoute();
  await screen.findByText("Ana Cruz");
  await user.click(screen.getByRole("button", { name: /check in ana cruz/i }));
  // Scoped to the live-region banner: the fixture's already-checked-in Ben Reyes
  // row also renders literal "Checked in" text, so a bare getByText is ambiguous.
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checked in"));
  expect(globalThis.fetch).toHaveBeenCalled();
});

it("marks an already-checked-in runner as done rather than offering a button", async () => {
  renderRoute();
  await screen.findByText("Ben Reyes");
  expect(screen.queryByRole("button", { name: /check in ben reyes/i })).not.toBeInTheDocument();
});

it("filters the roster by name", async () => {
  const user = userEvent.setup();
  renderRoute();
  await screen.findByText("Ana Cruz");
  await user.type(screen.getByPlaceholderText(/search/i), "ben");
  await waitFor(() => expect(screen.queryByText("Ana Cruz")).not.toBeInTheDocument());
  expect(screen.getByText("Ben Reyes")).toBeInTheDocument();
});

it("warns when offline", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  renderRoute();
  expect(await screen.findByText(/offline/i)).toBeInTheDocument();
});
