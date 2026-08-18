import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    const user = userEvent.setup();
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("boss@muspo.ph");

    await user.type(screen.getByLabelText(/email/i), "new@muspo.ph");
    await user.click(screen.getByRole("button", { name: /invite/i }));

    expect(invoke).toHaveBeenCalledWith("org-members", {
      body: { action: "invite", org_id: "o1", email: "new@muspo.ph", role: "admin" },
    });
  });

  it("removes a member", async () => {
    const user = userEvent.setup();
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("ed@muspo.ph");

    await user.click(screen.getByRole("button", { name: /remove ed@muspo.ph/i }));

    expect(invoke).toHaveBeenCalledWith("org-members", {
      body: { action: "remove", org_id: "o1", user_id: "u2" },
    });
  });

  it("does not clear the typed email when the invite fails", async () => {
    // Ruling 5: `run` swallows its own errors (toasts them), so chaining
    // setEmail("") onto every call — success or failure — would silently
    // wipe an address the operator typed after a FAILED invite. It must
    // only clear on success.
    const user = userEvent.setup();
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
    await user.type(field, "new@muspo.ph");
    await user.click(screen.getByRole("button", { name: /invite/i }));

    expect(await screen.findByDisplayValue("new@muspo.ph")).toBeInTheDocument();
  });

  it("clears the typed email after a successful invite", async () => {
    // Finding 3: the mirror of the failure case above — both halves of the
    // ok/fail branch in the invite handler deserve coverage.
    const user = userEvent.setup();
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("boss@muspo.ph");

    const field = screen.getByLabelText(/email/i);
    await user.type(field, "new@muspo.ph");
    await user.click(screen.getByRole("button", { name: /invite/i }));

    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("shows a failure state, not a permanent Loading, when the list fails to load", async () => {
    // Finding 2: `load()` used to toast the error and leave `members` at
    // `null` forever, so the body stayed on "Loading…" with no way out.
    invoke.mockResolvedValue({ data: null, error: { context: { status: 500 } } });
    const user = userEvent.setup();
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);

    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText(/^loading/i)).not.toBeInTheDocument();

    // Retry must actually call load() again, and recover once it succeeds.
    invoke.mockResolvedValueOnce({
      data: { ok: true, members: [
        { user_id: "u1", email: "boss@muspo.ph", full_name: "Boss", role: "admin" },
      ] },
      error: null,
    });
    await user.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("boss@muspo.ph")).toBeInTheDocument();
  });

  it("does not flash the previous org's stale list when reopened for a different org", async () => {
    // Finding 4: `members` must be reset before the refetch kicks off on
    // open, or the last org's rows render for a moment before the fresh
    // fetch for the new org lands.
    const { rerender } = render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("boss@muspo.ph");

    rerender(<ManageAdminsDialog org={org} open={false} onOpenChange={() => {}} />);

    let resolveList: (v: unknown) => void = () => {};
    invoke.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    rerender(<ManageAdminsDialog org={{ ...org, id: "o2", name: "Other" }} open onOpenChange={() => {}} />);

    expect(screen.queryByText("boss@muspo.ph")).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    resolveList({
      data: { ok: true, members: [
        { user_id: "u5", email: "fresh@other.ph", full_name: "Fresh", role: "admin" },
      ] },
      error: null,
    });
    expect(await screen.findByText("fresh@other.ph")).toBeInTheDocument();
  });
});
