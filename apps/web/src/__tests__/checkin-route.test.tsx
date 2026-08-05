import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { storageKey } from "../lib/checkinQueue";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) } },
}));
// The camera is not available in jsdom; the roster path is what this test drives.
vi.mock("../components/QrScanner", () => ({ QrScanner: () => <div data-testid="qr-scanner" /> }));

import { CheckIn } from "../routes/CheckIn";

/** Builds a token `decodeTicketEventId` can actually decode, the same way
 *  `checkin-result.test.ts` does — a base64url JSON body plus a dummy signature. */
const tokenFor = (eid: string) =>
  `${btoa(JSON.stringify({ rid: "r9", eid })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;

/** jsdom does not populate KeyboardEvent.timeStamp usefully; set it explicitly,
 *  matching keyboard-wedge.test.ts's helper. */
function press(key: string, timeStamp: number) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "timeStamp", { value: timeStamp });
  document.dispatchEvent(ev);
}

/** Drives the route's live useKeyboardWedge listener with a machine-speed burst
 *  (sub-30ms gaps) terminated by Enter — the same shape a hardware scanner
 *  produces — so submit() fires without a camera. */
function scanBurst(token: string) {
  let t = 1000;
  for (const key of token) { press(key, t); t += 5; }
  press("Enter", t);
}

const EVENTS = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", end_date: null }];
const ROSTER = [
  { registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz", bib: "ANA", category: "10K", status: "paid", checked_in_at: null },
  { registration_id: "r2", ticket_token: "tok2", runner: "Ben Reyes", bib: "BEN", category: "21K", status: "paid", checked_in_at: "2026-08-06T01:00:00Z" },
];

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CheckIn /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
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

it("refuses a ticket scanned for a different event, without submitting it", async () => {
  const TWO_EVENTS = [
    { id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", end_date: null },
    { id: "e2", name: "Davao Sunrise Run", event_date: "2026-10-01", end_date: null },
  ];
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === "checkin_events" ? TWO_EVENTS : ROSTER, error: null }));
  // Two events means nothing auto-selects; pre-seed the persisted choice instead
  // of driving the shadcn Select, which is incidental to what this test checks.
  localStorage.setItem("race-pace.checkin.v1.selected-event", "e1");

  renderRoute();
  await screen.findByText("Ana Cruz"); // roster for e1 has loaded

  scanBurst(tokenFor("e2"));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Wrong event"));
  expect(screen.getByRole("status")).toHaveTextContent("Davao Sunrise Run");

  expect(globalThis.fetch).not.toHaveBeenCalled();
  const stored = JSON.parse(localStorage.getItem(storageKey("e1")) ?? "{}");
  expect(stored.queue ?? []).toHaveLength(0);
});

it("lets a ticket for the selected event fall through to the server, even if the roster has never heard of it", async () => {
  // The on-site-registration case: the runner signed up after the marshal's last
  // roster sync, so `offlineDecision` says not_found. While ONLINE that must NOT be
  // a local refusal — the server is authoritative and it would happily check them in.
  // The wrong-event guard is the only local pre-check that survives being online.
  (globalThis.fetch as any).mockResolvedValue({
    status: 200, json: () => Promise.resolve({ ok: true, registration_id: "r99" }),
  });
  renderRoute(); // single-event fixture auto-selects e1
  await screen.findByText("Ana Cruz");

  scanBurst(tokenFor("e1"));

  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checked in"));
  expect(screen.queryByText(/Wrong event/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Ticket not recognised/i)).not.toBeInTheDocument();
});

it("renders the server's refusal for an unknown ticket rather than inventing one locally", async () => {
  (globalThis.fetch as any).mockResolvedValue({
    status: 404, json: () => Promise.resolve({ error: "not_found" }),
  });
  renderRoute();
  await screen.findByText("Ana Cruz");

  scanBurst(tokenFor("e1"));

  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ticket not recognised"));
});

it("still POSTs a scan whose roster row is locally 'pending' — the runner may have paid on-site", async () => {
  const PENDING_TOKEN = tokenFor("e1");
  const PENDING_ROSTER = [
    { registration_id: "r3", ticket_token: PENDING_TOKEN, runner: "Cely Lim", bib: "CEL", category: "10K", status: "pending", checked_in_at: null },
  ];
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === "checkin_events" ? EVENTS : PENDING_ROSTER, error: null }));
  (globalThis.fetch as any).mockResolvedValue({
    status: 200, json: () => Promise.resolve({ ok: true, registration_id: "r3" }),
  });

  renderRoute();
  await screen.findByText("Cely Lim");

  scanBurst(PENDING_TOKEN);

  // The roster snapshot says "pending" only because it predates the on-site payment.
  // Refusing locally while online would strand a runner who is paid on the server.
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Checked in"));
});

it("surfaces a roster sync failure instead of leaving the marshal to assume it worked", async () => {
  rpc.mockImplementation((fn: string) =>
    fn === "checkin_events"
      ? Promise.resolve({ data: EVENTS, error: null })
      : Promise.resolve({ data: null, error: { message: "roster rpc exploded" } }));

  renderRoute();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/could not sync the roster/i);
  expect(alert).toHaveTextContent("roster rpc exploded");
});

it("clears a stale wrong-event banner when the picker is switched to a different event", async () => {
  const TWO_EVENTS = [
    { id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", end_date: null },
    { id: "e2", name: "Davao Sunrise Run", event_date: "2026-10-01", end_date: null },
  ];
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === "checkin_events" ? TWO_EVENTS : ROSTER, error: null }));
  localStorage.setItem("race-pace.checkin.v1.selected-event", "e1");

  const user = userEvent.setup();
  renderRoute();
  await screen.findByText("Ana Cruz");

  scanBurst(tokenFor("e2"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Wrong event"));

  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "Davao Sunrise Run" }));

  // Switching events must not leave the previous event's "Wrong event" banner
  // hanging over the newly-selected event's session.
  await waitFor(() => expect(screen.queryByText(/Wrong event/i)).not.toBeInTheDocument());
});

it("clears a stale wrong-event banner when the selected event drops out of the list", async () => {
  localStorage.setItem("race-pace.checkin.v1.selected-event", "e1");
  const { qc } = renderRoute(); // single-event fixture (e1) via beforeEach's rpc mock
  await screen.findByText("Ana Cruz");

  scanBurst(tokenFor("e2"));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Wrong event"));

  // e1 disappears from the org's event list (e.g. the marshal was reassigned) —
  // the stale-event-id effect resets the picker and must not leave the old
  // banner pinned to a session that no longer exists.
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === "checkin_events" ? [] : ROSTER, error: null }));
  await qc.invalidateQueries({ queryKey: ["checkin-events"] });

  await waitFor(() => expect(screen.queryByText(/Wrong event/i)).not.toBeInTheDocument());
});
