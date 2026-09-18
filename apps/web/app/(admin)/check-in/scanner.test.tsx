import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CheckInStation } from "./scanner";
import type { RosterRow } from "@/lib/checkin";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock("./history", () => ({ CheckInHistory: () => null }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks }));
// Match the client's stable functions object without starting a real session.
Object.assign(mocks, { functions: { invoke: mocks.invoke } });
const row: RosterRow = { registration_id: "reg", ticket_token: "payload.signature", runner: "QA Runner", bib: "42", category: "10K", status: "paid", checked_in_at: null, avatar_url: null };
beforeEach(() => { vi.resetAllMocks(); });
it("sends the selected station for manual check-in and blocks a wrong-event response", async () => {
  mocks.invoke.mockResolvedValue({ error: { context: { json: async () => ({ error: "wrong_event" }) } } });
  render(<CheckInStation eventId="event-a" eventName="Race A" initialRows={[row]} />);
  fireEvent.click(screen.getByRole("button", { name: /^Check in$/ }));
  await screen.findByText("Ticket belongs to another event");
  expect(mocks.invoke).toHaveBeenCalledWith("check-in", { body: { ticket_token: row.ticket_token, event_id: "event-a" } });
  expect(screen.getByText("Nobody has checked in yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Check in$/ })).toBeEnabled();
});

it("shows a disabled-event response instead of a successful scan", async () => {
  mocks.invoke.mockResolvedValue({ error: { context: { json: async () => ({ error: "check_in_disabled" }) } } });
  render(<CheckInStation eventId="event-a" eventName="Race A" initialRows={[row]} />);
  fireEvent.click(screen.getByRole("button", { name: /^Check in$/ }));
  await screen.findByText("Check-in not required");
  expect(screen.getByText(/No attendance was recorded/)).toBeInTheDocument();
  expect(screen.getByText("Nobody has checked in yet.")).toBeInTheDocument();
});
it("ignores an old scan response after switching events", async () => {
  let finish!: (value: unknown) => void;
  mocks.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const view = render(<CheckInStation eventId="event-a" eventName="Race A" initialRows={[row]} />);
  fireEvent.click(screen.getByRole("button", { name: /^Check in$/ }));
  view.rerender(<CheckInStation eventId="event-b" eventName="Race B" initialRows={[]} />);
  await act(async () => { finish({ data: { ok: true, registration_id: row.registration_id } }); });
  expect(screen.getByText("Nobody has checked in yet.")).toBeInTheDocument();
  expect(screen.queryByText("QA Runner")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
});
