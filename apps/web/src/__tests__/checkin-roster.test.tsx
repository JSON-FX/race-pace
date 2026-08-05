import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInRoster } from "../components/CheckInRoster";
import type { RosterRow } from "../lib/checkinQueue";

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz",
  bib: "ANA", category: "10K", status: "paid", checked_in_at: null, ...over,
});

it("shows a pre-sync message, not a failed search, when the roster hasn't been downloaded yet", () => {
  render(<CheckInRoster roster={[]} queuedIds={new Set()} onCheckIn={vi.fn()} />);
  expect(screen.getByText(/roster not downloaded yet/i)).toBeInTheDocument();
  expect(screen.queryByText(/no runner matches/i)).not.toBeInTheDocument();
});

it("shows the no-match copy only once a real search yields nothing", async () => {
  const user = userEvent.setup();
  render(<CheckInRoster roster={[row()]} queuedIds={new Set()} onCheckIn={vi.fn()} />);
  expect(screen.queryByText(/roster not downloaded yet/i)).not.toBeInTheDocument();

  await user.type(screen.getByPlaceholderText(/search/i), "zzz");
  expect(screen.getByText(/no runner matches “zzz”/i)).toBeInTheDocument();
});
