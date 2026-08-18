import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrgActions } from "./org-actions";

const org = { id: "o1", name: "Muspo", slug: "muspo", isActive: true };

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  refresh.mockReset();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /actions for muspo/i }));
}

describe("OrgActions", () => {
  it("renames through org-provision and refreshes the list", async () => {
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /rename/i }));

    // Exact match, not a regex — "Rename organization" (the dialog's
    // aria-labelledby text) also contains the substring "name".
    const field = screen.getByLabelText("Name");
    await user.clear(field);
    await user.type(field, "Muspo Trail");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(invoke).toHaveBeenCalledWith("org-provision", {
      body: { action: "update", org_id: "o1", name: "Muspo Trail" },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("will not submit an empty name", async () => {
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /rename/i }));
    await user.clear(screen.getByLabelText("Name"));

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("suspends an active org", async () => {
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /suspend/i }));
    await user.click(screen.getByRole("button", { name: /^suspend$/i }));

    expect(invoke).toHaveBeenCalledWith("org-provision", {
      body: { action: "set_active", org_id: "o1", is_active: false },
    });
  });

  it("offers unsuspend for a suspended org", async () => {
    const user = userEvent.setup();
    render(<OrgActions org={{ ...org, isActive: false }} />);
    await openMenu(user);
    expect(screen.getByRole("menuitem", { name: /unsuspend/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^suspend$/i })).not.toBeInTheDocument();
  });

  it("states the real consequence of suspending", async () => {
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /suspend/i }));

    expect(
      screen.getByText(/leave the runner site and it stops taking new registrations/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/paid entries stay valid/i)).toBeInTheDocument();
    expect(
      screen.getByText(/check-in, refunds and payouts keep working/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/team keeps console access/i)).toBeInTheDocument();
  });
});
