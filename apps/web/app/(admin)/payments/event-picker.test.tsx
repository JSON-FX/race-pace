import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentsEventPicker } from "./event-picker";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams("status=paid&page=3"),
}));

const events = [
  { id: "e1", name: "Dahilayan Sky Ultra 2026", count: 12 },
  { id: "e2", name: "Davao Sunrise Run 2026", count: 4 },
];

beforeEach(() => {
  push.mockClear();
});

describe("PaymentsEventPicker", () => {
  // Unlike the Registrations picker (which resets everything), this one
  // PRESERVES status/method/search and drops only pagination — page 3 of the
  // whole org is rarely page 3 of one event.
  it("keeps other filters and drops the page when scoping to an event", async () => {
    const user = userEvent.setup();
    render(<PaymentsEventPicker events={events} value="all" />);

    await user.click(screen.getByRole("combobox", { name: "Filter payments by event" }));
    await user.click(await screen.findByRole("option", { name: /Davao Sunrise Run 2026/ }));

    expect(push).toHaveBeenCalledTimes(1);
    const [url] = push.mock.calls[0] as [string, unknown];
    expect(url).toContain("status=paid");
    expect(url).toContain("event=e2");
    expect(url).not.toContain("page");
  });

  it("marks the trigger idle before a switch", () => {
    render(<PaymentsEventPicker events={events} value="all" />);
    expect(screen.getByRole("combobox", { name: "Filter payments by event" }))
      .toHaveAttribute("aria-busy", "false");
  });
});
