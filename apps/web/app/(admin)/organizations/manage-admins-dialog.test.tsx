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

  it("names a member with no email by their name, never \"Remove null\"", async () => {
    // org-members returns `email: u?.user?.email ?? null` — an auth account
    // can genuinely have no email (phone/OAuth), and the row's only control
    // announced itself to a screen reader as "Remove null".
    const user = userEvent.setup();
    invoke.mockResolvedValue({
      data: { ok: true, members: [
        { user_id: "u1", email: "boss@muspo.ph", full_name: "Boss", role: "admin" },
        { user_id: "u9", email: null, full_name: "No Mail", role: "editor" },
      ] },
      error: null,
    });
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("No Mail");

    expect(screen.queryByRole("button", { name: /remove null/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove no mail/i }));
    expect(invoke).toHaveBeenCalledWith("org-members", {
      body: { action: "remove", org_id: "o1", user_id: "u9" },
    });
  });

  it("falls back to the user id when a member has neither an email nor a name", async () => {
    invoke.mockResolvedValue({
      data: { ok: true, members: [
        { user_id: "u7", email: null, full_name: null, role: "marshal" },
      ] },
      error: null,
    });
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);

    expect(await screen.findByRole("button", { name: /remove u7/i })).toBeInTheDocument();
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

  it("shows the manual sign-in link the invite came back with, and copies it", async () => {
    // Final-review finding: SMTP is not configured on this project — that is
    // the whole reason org-provision's create returns a manual invite_link —
    // and this dialog used to say "Invite sent to X" and nothing else, so the
    // invited admin could never actually sign in. org-members now returns the
    // same /auth/confirm link, and it has to reach the operator's clipboard.
    const user = userEvent.setup();
    // Spied AFTER setup(), and spied rather than assigned: userEvent installs
    // its own navigator.clipboard as a getter-only property, so replacing the
    // object throws and assigning before setup() would be overwritten.
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const link = "http://localhost:3001/auth/confirm?token_hash=abc123&type=magiclink&next=%2Fteam";
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) => {
      if (opts.body.action === "invite") {
        return Promise.resolve({ data: { ok: true, invite_link: link }, error: null });
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
    await user.type(screen.getByLabelText(/email/i), "new@muspo.ph");
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(await screen.findByText(link)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(link);
  });

  it("says so when the invite succeeded but no link could be generated", async () => {
    // buildInviteLink returns null when ADMIN_APP_URL is unset or generateLink
    // gave back no hashed_token, and org-members answers ok anyway because the
    // role grant is already committed. A silent success there would leave the
    // operator believing an email went out that cannot arrive.
    const user = userEvent.setup();
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) => {
      if (opts.body.action === "invite") {
        return Promise.resolve({ data: { ok: true, invite_link: null }, error: null });
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
    await user.type(screen.getByLabelText(/email/i), "new@muspo.ph");
    await user.click(screen.getByRole("button", { name: /^invite$/i }));

    expect(await screen.findByText(/could not be generated/i)).toBeInTheDocument();
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
