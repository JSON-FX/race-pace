import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamTable } from "./team-table";
import type { TeamMember } from "@/lib/queries/team";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

// Typed explicitly as the real actions' return shape (see
// lib/actions/team.ts's changeRoleAction/removeMemberAction:
// `Promise<{ ok: boolean; error?: string }>`) rather than left to infer
// from the literal `{ ok: true }` the mock happens to resolve with first.
// Without this, TS narrows the inferred return type to `{ ok: true }` only,
// and every `mockResolvedValueOnce({ ok: false, error: "..." })` below
// fails to typecheck (TS2353) — the mock and the real action must agree on
// shape for the test to mean anything.
const { changeRoleAction, removeMemberAction } = vi.hoisted(() => ({
  changeRoleAction: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(() => Promise.resolve({ ok: true })),
  removeMemberAction: vi.fn<() => Promise<{ ok: boolean; error?: string }>>(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/lib/actions/team", () => ({ changeRoleAction, removeMemberAction }));

beforeEach(() => {
  resetTableParamsSpies();
  changeRoleAction.mockClear();
  removeMemberAction.mockClear();
});

const rows: TeamMember[] = [
  { user_id: "u1", email: "admin@racepace.test", full_name: "Ada Admin", role: "admin", created_at: "2026-07-01T00:00:00Z" },
  { user_id: "u2", email: "marshal@racepace.test", full_name: null, role: "marshal", created_at: "2026-07-20T00:00:00Z" },
];

const props = { rows, total: 2, page: 1, per: 25, sort: [], activeFilters: {}, q: "", orgId: "a1" };

describe("TeamTable", () => {
  it("lists members with their roles in the right columns", () => {
    render(<TeamTable {...props} />);
    const rowsEls = screen.getAllByRole("row");
    // rowsEls[0] is the header row; data rows follow in order. No selection
    // column here (no bulkActions/getRowId), so cell 0 is Member.
    const adaRow = rowsEls[1];
    const cells = within(adaRow).getAllByRole("cell");
    expect(within(cells[0]).getByText("Ada Admin")).toBeInTheDocument();
    expect(within(cells[0]).getByText("admin@racepace.test")).toBeInTheDocument();
  });

  // TeamTable is only ever rendered for a caller TeamPage has already
  // confirmed is an org admin (the org-members edge function 403s anyone
  // else before its "list" branch even runs — see page.tsx and
  // team-table.tsx's top comment), so every row always gets a live role
  // picker. This guards that the picker renders unconditionally rather than
  // depending on a prop that no longer exists.
  it("always renders a live role picker for every row", () => {
    render(<TeamTable {...props} />);
    expect(screen.getByLabelText("Change role for Ada Admin")).toBeInTheDocument();
    expect(screen.getByLabelText(/change role for marshal@racepace.test/i)).toBeInTheDocument();
  });

  // Regression guard for the assignable-role list: if ASSIGNABLE_ROLES in
  // lib/queries/team.ts ever drifts from what the org-members edge function
  // accepts (supabase/functions/_shared/team.ts), this fails because an
  // assignable role option would disappear from the picker.
  it("offers every assignable role in the role picker", async () => {
    const user = userEvent.setup();
    render(<TeamTable {...props} />);
    const rowsEls = screen.getAllByRole("row");
    const trigger = within(rowsEls[1]).getByRole("combobox");
    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Marshal" })).toBeInTheDocument();
  });

  // Regression guard: when a role is removed from ASSIGNABLE_ROLES but a
  // member still holds it (e.g., "claiming" during race-kit development),
  // the picker must show the current role so the admin can see what they
  // hold and change it to something that grants access. If the fallback
  // logic is missing, the trigger renders blank.
  it("shows the label for a role no longer assignable (e.g., phased-out roles)", async () => {
    const user = userEvent.setup();
    const claimingMember: TeamMember = {
      user_id: "u3", email: "kit@racepace.test", full_name: "Kit Claimer",
      role: "claiming", created_at: "2026-08-01T00:00:00Z",
    };
    render(<TeamTable {...props} rows={[...props.rows, claimingMember]} total={3} />);
    const rowsEls = screen.getAllByRole("row");
    const claimingRow = rowsEls[3]; // Third data row
    const trigger = within(claimingRow).getByRole("combobox");
    // The trigger should show "Race Kit" even though "claiming" is not assignable.
    expect(trigger).toHaveTextContent("Race Kit");
    await user.click(trigger);
    // Opening the picker should still show the current role.
    expect(screen.getByRole("option", { name: "Race Kit" })).toBeInTheDocument();
  });

  // Regression guard: when a role is removed from ASSIGNABLE_ROLES but a
  // member still holds it (e.g., "claiming" during race-kit development),
  // the picker must show the current role so the admin can see what they
  // hold and change it to something that grants access. If the fallback
  // logic is missing, the trigger renders blank.
  it("shows the label for a role no longer assignable (e.g., phased-out roles)", async () => {
    const user = userEvent.setup();
    const claimingMember: TeamMember = {
      user_id: "u3", email: "kit@racepace.test", full_name: "Kit Claimer",
      role: "claiming", created_at: "2026-08-01T00:00:00Z",
    };
    render(<TeamTable {...props} rows={[...props.rows, claimingMember]} total={3} />);
    const rowsEls = screen.getAllByRole("row");
    const claimingRow = rowsEls[3]; // Third data row
    const trigger = within(claimingRow).getByRole("combobox");
    // The trigger should show "Race Kit" even though "claiming" is not assignable.
    expect(trigger).toHaveTextContent("Race Kit");
    await user.click(trigger);
    // Opening the picker should still show the current role.
    expect(screen.getByRole("option", { name: "Race Kit" })).toBeInTheDocument();
  });

  // Regression guard: the org-members edge function can reject a role
  // change server side (e.g. the last-admin guard) after the UI has
  // already shown the new value in the <Select>. If the cell ever goes
  // back to an uncontrolled `defaultValue`, this fails — the picker would
  // keep showing the rejected role instead of reverting to what the server
  // actually persisted.
  it("reverts the role picker to the previous value when the server rejects the change", async () => {
    changeRoleAction.mockResolvedValueOnce({ ok: false, error: "An organization must keep at least one admin." });
    const user = userEvent.setup();
    render(<TeamTable {...props} />);
    const rowsEls = screen.getAllByRole("row");
    const trigger = within(rowsEls[1]).getByRole("combobox");
    expect(trigger).toHaveTextContent("Admin");

    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Marshal" }));

    await waitFor(() => expect(changeRoleAction).toHaveBeenCalledWith("u1", "a1", "marshal"));
    await waitFor(() => expect(trigger).toHaveTextContent("Admin"));
  });

  // Revocation is the most consequential capability on a permissions
  // screen — this guards that it's actually wired to the real action with
  // the right ids, not just present visually.
  it("removes a member after confirming in the dialog", async () => {
    const user = userEvent.setup();
    render(<TeamTable {...props} />);
    await user.click(screen.getByLabelText("Remove marshal@racepace.test"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove member" }));
    await waitFor(() => expect(removeMemberAction).toHaveBeenCalledWith("u2", "a1"));
  });

  // The edge function refuses to remove an org's last admin (409) — that
  // error must reach the admin, not fail silently, and the dialog must
  // stay open so they actually see it.
  it("surfaces the server's error and keeps the dialog open when removal is rejected", async () => {
    removeMemberAction.mockResolvedValueOnce({ ok: false, error: "An organization must keep at least one admin." });
    const user = userEvent.setup();
    render(<TeamTable {...props} />);
    await user.click(screen.getByLabelText("Remove Ada Admin"));
    await user.click(screen.getByRole("button", { name: "Remove member" }));
    expect(await screen.findByText("An organization must keep at least one admin.")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("clears the removal error when the dialog is cancelled", async () => {
    removeMemberAction.mockResolvedValueOnce({ ok: false, error: "Couldn't remove the member." });
    const user = userEvent.setup();
    render(<TeamTable {...props} />);
    await user.click(screen.getByLabelText("Remove Ada Admin"));
    await user.click(screen.getByRole("button", { name: "Remove member" }));
    expect(await screen.findByText("Couldn't remove the member.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Couldn't remove the member.")).not.toBeInTheDocument();
  });
});
