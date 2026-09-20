import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { PlatformUser } from "@/lib/queries/platform-users";

const invoke = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("@/components/PhotoAvatar", () => ({ PhotoAvatar: ({ fallback }: { fallback: React.ReactNode }) => <span>{fallback}</span> }));

import { UsersDirectory } from "./users-directory";

const user: PlatformUser = {
  id: "u1",
  email: "alina@example.com",
  name: "Alina Santos",
  avatarUrl: "https://example.com/alina.jpg",
  provider: "google",
  createdAt: "2026-09-12T00:00:00Z",
  lastSignInAt: "2026-09-20T00:00:00Z",
  status: "active",
  protectedAccount: false,
  registrations: [],
  currentRegistrations: [],
  latestPayment: null,
  passports: [{
    id: "p1",
    name: "Maya Santos",
    avatarUrl: "https://example.com/maya.jpg",
    relationship: "managed",
    claimed: false,
    latestPayment: { method: "gcash", amountCents: 245000, paidAt: "2026-09-15T00:00:00Z", eventName: "Forest Loop Juniors" },
    currentRegistrations: [],
    registrations: [{
      id: "r1",
      eventName: "Forest Loop Juniors",
      eventDate: "2026-10-18",
      eventStatus: "open",
      category: "5K",
      status: "paid",
      createdAt: "2026-09-15T00:00:00Z",
      amountCents: 245000,
      payment: { method: "gcash", amountCents: 245000, paidAt: "2026-09-15T00:00:00Z", eventName: "Forest Loop Juniors" },
    }],
  }],
};

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});

it("filters users, opens the inspector, and drills into a managed Race Passport", async () => {
  const events = userEvent.setup();
  render(<UsersDirectory initialUsers={[user]} />);

  await events.type(screen.getByRole("textbox", { name: "Search users" }), "missing");
  expect(screen.getByText("No users match these filters.")).toBeInTheDocument();
  await events.clear(screen.getByRole("textbox", { name: "Search users" }));
  await events.click(screen.getByRole("button", { name: "View Alina Santos" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("alina@example.com")).toBeInTheDocument();
  await events.click(within(dialog).getByRole("button", { name: /Maya Santos/ }));
  expect(within(dialog).getByText("Managed Race Passport")).toBeInTheDocument();
  expect(within(dialog).getAllByText(/Forest Loop Juniors/).length).toBeGreaterThan(0);
});

it("requires confirmation before suspending an account", async () => {
  const events = userEvent.setup();
  render(<UsersDirectory initialUsers={[user]} />);
  await events.click(screen.getByRole("button", { name: "View Alina Santos" }));
  await events.click(await screen.findByRole("button", { name: "Suspend user" }));
  const confirmation = await screen.findByRole("alertdialog");
  await events.click(within(confirmation).getByRole("button", { name: "Suspend user" }));
  expect(invoke).toHaveBeenCalledWith("platform-users", { body: { action: "suspend", user_id: "u1" } });
  expect((await screen.findAllByText("Suspended")).length).toBeGreaterThan(0);
});
