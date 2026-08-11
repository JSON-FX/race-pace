import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventPicker } from "./event-picker";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/registrations",
}));

const events = [
  { id: "e1", name: "Dahilayan Sky Ultra 2026", count: 12 },
  { id: "e2", name: "Davao Sunrise Run 2026", count: 0 },
];

beforeEach(() => {
  push.mockClear();
});

describe("EventPicker", () => {
  // THE reason this test exists: the reset-on-switch behaviour is correct
  // purely by construction (`router.push` builds a brand-new query string
  // containing only `event=`, rather than patching the existing one). A
  // future "helpful" refactor to a param-merging `patch()` call would
  // silently reintroduce the stale-per-event-category bug (switching events
  // while a category filter from the OLD event is still active silently
  // returns zero rows), and nothing else in this suite would catch it.
  it("pushes a URL containing ONLY the new event param, dropping status/category/page/q", async () => {
    const user = userEvent.setup();
    render(<EventPicker events={events} value="e1" />);

    await user.click(screen.getByRole("combobox", { name: "Event" }));
    await user.click(await screen.findByRole("option", { name: /Davao Sunrise Run 2026/ }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/registrations?event=e2", { scroll: false });

    const [url] = push.mock.calls[0] as [string, unknown];
    // Assert the absence explicitly — a test that only checks "event=e2" is
    // present would still pass if the implementation switched to merging
    // onto the existing query string.
    expect(url).not.toContain("status");
    expect(url).not.toContain("category");
    expect(url).not.toContain("page");
    expect(url).not.toContain("q=");
  });

  it("marks the trigger idle before a switch", async () => {
    render(<EventPicker events={events} value="e1" />);
    // aria-busy must be present and false at rest: asserting only the pending
    // state would pass against a component that never sets the attribute at
    // all, since getByRole would simply not find a busy element either way.
    expect(screen.getByRole("combobox", { name: "Event" })).toHaveAttribute("aria-busy", "false");
  });
});
