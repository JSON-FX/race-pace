import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MyRoles } from "@/lib/queries/roles";
import type { Capability } from "@/lib/capabilities";
import { CommandPalette } from "./CommandPalette";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/events",
}));

const searchEvents = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/actions/search", () => ({
  searchEvents: (term: string) => searchEvents(term),
}));

// The palette gates on roles.capabilities (lib/nav-items.ts), not on
// isOrgAdmin/isSuperAdmin directly — these mirror what getMyRoles() would
// have derived for an admin vs. an editor vs. a super_admin.
const ADMIN_CAPS: Capability[] = ["manage_team", "manage_org", "check_in"];
const EDITOR_CAPS: Capability[] = ["manage_org", "check_in"];
const SUPER_CAPS: Capability[] = ["manage_platform", "manage_team", "manage_org", "check_in"];

function roles(overrides: Partial<MyRoles> = {}): MyRoles {
  return {
    role: "admin",
    isSuperAdmin: false,
    isAdmin: true,
    isOrgAdmin: true,
    orgId: "a1",
    capabilities: ADMIN_CAPS,
    ...overrides,
  };
}

beforeEach(() => {
  push.mockClear();
  searchEvents.mockClear();
  searchEvents.mockResolvedValue([]);
});

describe("CommandPalette", () => {
  it("is closed by default and opens on Cmd+K", async () => {
    const user = userEvent.setup();
    render(<CommandPalette roles={roles()} />);

    expect(screen.queryByPlaceholderText(/Jump to a page or an event/)).not.toBeInTheDocument();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(await screen.findByPlaceholderText(/Jump to a page or an event/)).toBeInTheDocument();
  });

  it("opens on click of the topbar trigger", async () => {
    const user = userEvent.setup();
    render(<CommandPalette roles={roles()} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));

    expect(await screen.findByPlaceholderText(/Jump to a page or an event/)).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<CommandPalette roles={roles()} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));
    await screen.findByPlaceholderText(/Jump to a page or an event/);

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Jump to a page or an event/)).not.toBeInTheDocument(),
    );
  });

  // The palette must apply the SAME gating as Sidebar.tsx — see
  // lib/nav-items.ts. An org editor (isAdmin but not isOrgAdmin) reaches
  // every other org-scoped page but must not be offered Team; a regular
  // org admin must never be offered the super-admin-only PLATFORM group.
  it("hides Team from a non-org-admin", async () => {
    const user = userEvent.setup();
    render(<CommandPalette roles={roles({ isOrgAdmin: false, capabilities: EDITOR_CAPS })} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));
    await screen.findByPlaceholderText(/Jump to a page or an event/);

    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
  });

  it("hides the PLATFORM destinations from a regular org admin", async () => {
    const user = userEvent.setup();
    render(<CommandPalette roles={roles({ isSuperAdmin: false, isOrgAdmin: true })} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));
    await screen.findByPlaceholderText(/Jump to a page or an event/);

    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
    expect(screen.queryByText("Commission")).not.toBeInTheDocument();
    expect(screen.queryByText("Payouts")).not.toBeInTheDocument();
  });

  it("offers PLATFORM destinations to a super_admin", async () => {
    const user = userEvent.setup();
    render(<CommandPalette roles={roles({ isSuperAdmin: true, capabilities: SUPER_CAPS })} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));
    await screen.findByPlaceholderText(/Jump to a page or an event/);

    expect(screen.getByText("Organizations")).toBeInTheDocument();
    expect(screen.getByText("Commission")).toBeInTheDocument();
    expect(screen.getByText("Payouts")).toBeInTheDocument();
  });

  it("navigates to a page on selecting a Navigation entry", async () => {
    const user = userEvent.setup();
    render(<CommandPalette roles={roles()} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));
    await screen.findByPlaceholderText(/Jump to a page or an event/);

    await user.click(screen.getByText("Registrations"));

    expect(push).toHaveBeenCalledWith("/registrations");
  });

  it("calls the server search with the typed term, debounced", async () => {
    // Deliberately real timers, not fake ones: Radix's Dialog schedules its
    // own open/focus work via rAF-adjacent timers, which hangs indefinitely
    // under vi.useFakeTimers() (a previous version of this test tried fake
    // timers and every run past the dialog-open click timed out at 5s).
    // Asserting "not called synchronously right after typing" plus a real
    // ~300ms wait is enough to prove the debounce without touching the
    // fake-timer clock.
    const user = userEvent.setup();
    render(<CommandPalette roles={roles()} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));
    const input = await screen.findByPlaceholderText(/Jump to a page or an event/);

    await user.type(input, "Dahilayan");
    expect(searchEvents).not.toHaveBeenCalled();

    await waitFor(() => expect(searchEvents).toHaveBeenCalledWith("Dahilayan"), { timeout: 1000 });
  });

  it("navigates to the event editor on selecting a searched event", async () => {
    searchEvents.mockResolvedValue([{ id: "e1", name: "Dahilayan Sky Ultra 2026" }]);
    const user = userEvent.setup();
    render(<CommandPalette roles={roles()} />);

    await user.click(screen.getByRole("button", { name: "Open search (command palette)" }));
    const input = await screen.findByPlaceholderText(/Jump to a page or an event/);

    await user.type(input, "Dahilayan");

    const option = await screen.findByText("Dahilayan Sky Ultra 2026");
    await user.click(option);

    expect(push).toHaveBeenCalledWith("/events/e1/edit");
  });
});
