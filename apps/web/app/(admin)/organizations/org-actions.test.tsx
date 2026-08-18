import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
const refresh = vi.fn();
// Named consts (not inline vi.fn()s) so beforeEach can reset call history —
// without that, "not.toHaveBeenCalled()" assertions see calls left over from
// earlier tests in this file. vi.hoisted is required here (unlike invoke /
// refresh above) because the sonner mock factory reads these eagerly at
// import time, not lazily inside a closure — a plain const hits the TDZ.
const { toastSuccess, toastError, toastWarning } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, warning: toastWarning } }));

import { OrgActions } from "./org-actions";

const org = { id: "o1", name: "Muspo", slug: "muspo", isActive: true };

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  refresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
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

describe("OrgActions — delete", () => {
  function previewReturning(preview: Record<string, unknown>) {
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) =>
      opts.body.action === "delete_preview"
        ? Promise.resolve({ data: { ok: true, ...preview }, error: null })
        : Promise.resolve({ data: { ok: true }, error: null }));
  }

  const clean = {
    counts: { events: 2, categories: 3, registrations: 0, payments: 0, checkins: 0, members: 1, payout_statements: 0 },
    blocked: false, blocking: null,
  };

  it("requires the slug typed exactly before deleting", async () => {
    previewReturning(clean);
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));

    const confirm = await screen.findByRole("button", { name: /delete organization/i });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/type the slug/i), "musp");
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/type the slug/i), "o");
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    expect(invoke).toHaveBeenCalledWith("org-provision", {
      body: { action: "delete", org_id: "o1", slug: "muspo" },
    });
  });

  it("shows what will be destroyed", async () => {
    previewReturning(clean);
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));

    expect(await screen.findByText(/2 events/i)).toBeInTheDocument();
    expect(screen.getByText(/3 categories/i)).toBeInTheDocument();
  });

  it("refuses when money has moved, and says why", async () => {
    previewReturning({
      counts: { events: 4, categories: 9, registrations: 412, payments: 412, checkins: 0, members: 2, payout_statements: 1 },
      blocked: true,
      blocking: { paid: 400, refunded: 10, partially_refunded: 2 },
    });
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));

    // The guard is the edge function's decision, rendered — never recomputed here.
    expect(await screen.findByText(/412 settled payments/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete organization/i })).toBeDisabled();
    expect(screen.queryByLabelText(/type the slug/i)).not.toBeInTheDocument();
  });

  it("disables the confirm button when the preview check itself fails", async () => {
    // A failed count query must never be read as "nothing to delete" — it
    // must block the confirm button just as hard as a real money guard.
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) =>
      opts.body.action === "delete_preview"
        ? Promise.resolve({ data: null, error: { context: { clone: () => ({ json: () => Promise.resolve({ error: "server_error" }) }) } } })
        : Promise.resolve({ data: { ok: true }, error: null }));
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));

    expect(await screen.findByText(/could not check/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete organization/i })).toBeDisabled();
    expect(screen.queryByLabelText(/type the slug/i)).not.toBeInTheDocument();
  });

  it("maps a 404 not_found delete error to a realistic message", async () => {
    previewReturning(clean);
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) => {
      if (opts.body.action === "delete_preview") {
        return Promise.resolve({ data: { ok: true, ...clean }, error: null });
      }
      return Promise.resolve({ data: null, error: { context: { clone: () => ({ json: () => Promise.resolve({ error: "not_found" }) }) } } });
    });
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));

    await user.type(screen.getByLabelText(/type the slug/i), "muspo");
    await user.click(screen.getByRole("button", { name: /delete organization/i }));

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith("That organization no longer exists.");
  });

  it("shows a plain success toast when storage cleanup fully succeeded", async () => {
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) => {
      if (opts.body.action === "delete_preview") {
        return Promise.resolve({ data: { ok: true, ...clean }, error: null });
      }
      return Promise.resolve({
        data: { ok: true, deleted: true, name: org.name, storage_cleanup: "complete" },
        error: null,
      });
    });
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));
    await user.type(screen.getByLabelText(/type the slug/i), "muspo");
    await user.click(screen.getByRole("button", { name: /delete organization/i }));

    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith("Muspo deleted.");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("warns — not a plain success — when storage cleanup only partially succeeded", async () => {
    // storage_cleanup: "partial" means the DB rows are gone but some
    // uploaded files could not be removed. On this project `supabase
    // storage rm` is a silent no-op against the hosted project, so a
    // plain success toast would leave orphaned files nobody knows about.
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) => {
      if (opts.body.action === "delete_preview") {
        return Promise.resolve({ data: { ok: true, ...clean }, error: null });
      }
      return Promise.resolve({
        data: { ok: true, deleted: true, name: org.name, storage_cleanup: "partial" },
        error: null,
      });
    });
    const user = userEvent.setup();
    render(<OrgActions org={org} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /delete/i }));
    await user.type(screen.getByLabelText(/type the slug/i), "muspo");
    await user.click(screen.getByRole("button", { name: /delete organization/i }));

    const { toast } = await import("sonner");
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/could not be removed/i));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
