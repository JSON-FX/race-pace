import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckInHistory } from "./history";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockReturnValue({ limit: mocks.limit }); });
it("shows both actions and the retained staff identifier", async () => {
  mocks.limit.mockResolvedValue({ data: [
    { id: "2", runner: "QA Runner", action: "checkin_undone", actor_id: "staff-2", actor_role: "marshal", created_at: "2026-09-16T01:01:00Z" },
    { id: "1", runner: "QA Runner", action: "checked_in", actor_id: "staff-1", actor_role: "admin", created_at: "2026-09-16T01:00:00Z" },
  ] });
  render(<CheckInHistory eventId="event-a" revision={1} />);
  expect(await screen.findByText("QA Runner · Check-in reversed")).toBeInTheDocument();
  expect(screen.getByText("QA Runner · Checked in")).toBeInTheDocument();
  expect(screen.getByText("marshal · staff-2")).toBeInTheDocument();
  expect(mocks.rpc).toHaveBeenCalledWith("checkin_history", { p_event_id: "event-a" });
  expect(mocks.limit).toHaveBeenCalledWith(50);
});
it("reports a read failure instead of claiming the history is empty", async () => {
  mocks.limit.mockResolvedValue({ data: null, error: { message: "denied" } });
  render(<CheckInHistory eventId="event-a" revision={0} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load check-in history");
  expect(screen.queryByText("No recorded check-in actions yet.")).not.toBeInTheDocument();
});
