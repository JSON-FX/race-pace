import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ManageAdminsDialog } from "./manage-admins-dialog";

const org = { id: "o1", name: "Muspo", slug: "muspo", isActive: true };

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({
    data: { ok: true, members: [
      { user_id: "u1", email: "boss@muspo.ph", full_name: "Boss", role: "admin" },
      { user_id: "u2", email: "ed@muspo.ph", full_name: null, role: "editor" },
    ] },
    error: null,
  });
});

describe("ManageAdminsDialog", () => {
  it("lists the org's members with their emails", async () => {
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);

    expect(await screen.findByText("boss@muspo.ph")).toBeInTheDocument();
    expect(screen.getByText("ed@muspo.ph")).toBeInTheDocument();
    // The whole point: an explicit org_id, not the caller's own scope.
    expect(invoke).toHaveBeenCalledWith("org-members", { body: { action: "list", org_id: "o1" } });
  });

  it("invites a new admin against that org", async () => {
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("boss@muspo.ph");

    await userEvent.type(screen.getByLabelText(/email/i), "new@muspo.ph");
    await userEvent.click(screen.getByRole("button", { name: /invite/i }));

    expect(invoke).toHaveBeenCalledWith("org-members", {
      body: { action: "invite", org_id: "o1", email: "new@muspo.ph", role: "admin" },
    });
  });

  it("removes a member", async () => {
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("ed@muspo.ph");

    await userEvent.click(screen.getByRole("button", { name: /remove ed@muspo.ph/i }));

    expect(invoke).toHaveBeenCalledWith("org-members", {
      body: { action: "remove", org_id: "o1", user_id: "u2" },
    });
  });

  it("does not clear the typed email when the invite fails", async () => {
    // Ruling 5: `run` swallows its own errors (toasts them), so chaining
    // setEmail("") onto every call — success or failure — would silently
    // wipe an address the operator typed after a FAILED invite. It must
    // only clear on success.
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) => {
      if (opts.body.action === "invite") {
        return Promise.resolve({ data: null, error: { context: { status: 502 } } });
      }
      return Promise.resolve({
        data: { ok: true, members: [
          { user_id: "u1", email: "boss@muspo.ph", full_name: "Boss", role: "admin" },
        ] },
        error: null,
      });
    });

    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("boss@muspo.ph");

    const field = screen.getByLabelText(/email/i);
    await userEvent.type(field, "new@muspo.ph");
    await userEvent.click(screen.getByRole("button", { name: /invite/i }));

    expect(await screen.findByDisplayValue("new@muspo.ph")).toBeInTheDocument();
  });
});
