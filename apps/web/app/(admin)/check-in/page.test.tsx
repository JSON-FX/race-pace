import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("./scanner", () => ({ CheckInStation: () => <div>Scanner station</div> }));
vi.mock("./history", () => ({ CheckInHistory: () => <div>Past check-ins</div> }));
import CheckInPage from "./page";

const event = { id: "event-a", name: "Race A", event_date: "2026-09-18", end_date: null };
beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation((name: string) => {
    if (name === "checkin_events") return { data: [event], error: null };
    if (name === "checkin_roster") return { data: [], error: null };
    return { data: false, error: null };
  });
});

it("shows the disabled event and its history without mounting a scanner", async () => {
  render(await CheckInPage({ searchParams: Promise.resolve({ event: event.id }) }));
  expect(screen.getByText("Check-in not required")).toBeInTheDocument();
  expect(screen.getByText("Past check-ins")).toBeInTheDocument();
  expect(screen.queryByText("Scanner station")).not.toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalledWith("checkin_roster", expect.anything());
});

it("mounts the station for enabled events and fails closed on an unknown mode", async () => {
  rpc.mockImplementation((name: string) => {
    if (name === "checkin_events") return { data: [event], error: null };
    if (name === "checkin_event_required") return { data: true, error: null };
    return { data: [], error: null };
  });
  const ui = render(await CheckInPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("Scanner station")).toBeInTheDocument();
  ui.unmount();
  rpc.mockImplementation((name: string) => name === "checkin_events"
    ? { data: [event], error: null }
    : { data: undefined, error: null });
  render(await CheckInPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load this event’s check-in setting");
});
