import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamTable } from "./team-table";
import type { TeamMember } from "@/lib/queries/team";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

const { changeRoleAction } = vi.hoisted(() => ({
  changeRoleAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/lib/actions/team", () => ({ changeRoleAction }));

beforeEach(() => {
  resetTableParamsSpies();
  changeRoleAction.mockClear();
});

const rows: TeamMember[] = [
  { user_id: "u1", email: "admin@racepace.test", full_name: "Ada Admin", role: "admin", created_at: "2026-07-01T00:00:00Z", status: "active" },
  { user_id: "u2", email: "marshal@racepace.test", full_name: null, role: "marshal", created_at: "2026-07-20T00:00:00Z", status: "invited" },
];

const props = { rows, total: 2, page: 1, per: 25, sort: [], activeFilters: {}, q: "", canManage: true, orgId: "a1" };

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

  it("marks a pending invite in the Status column, not elsewhere", () => {
    render(<TeamTable {...props} />);
    const rowsEls = screen.getAllByRole("row");
    const marshalRow = rowsEls[2];
    const cells = within(marshalRow).getAllByRole("cell");
    expect(within(cells[2]).getByText("Invited")).toBeInTheDocument();
    expect(within(rowsEls[1]).queryByText("Invited")).not.toBeInTheDocument();
  });

  // Regression guard: an editor (canManage=false) must not be able to
  // trigger changeRoleAction at all — if the Select ever renders for a
  // non-manager, this catches it via the missing aria-label as well as via
  // the plain-text role fallback appearing instead.
  it("hides role controls and shows plain text when the viewer cannot manage the team", () => {
    render(<TeamTable {...props} canManage={false} />);
    expect(screen.queryByLabelText(/change role/i)).not.toBeInTheDocument();
    const rowsEls = screen.getAllByRole("row");
    const cells = within(rowsEls[1]).getAllByRole("cell");
    expect(within(cells[1]).getByText("Admin")).toBeInTheDocument();
  });

  // Regression guard for the assignable-role list: if ASSIGNABLE_ROLES in
  // lib/queries/team.ts ever drifts from what the org-members edge function
  // accepts (supabase/functions/_shared/team.ts), this fails because the
  // "Race Kit" (claiming) option would disappear from the picker.
  it("offers every assignable role in the role picker, including claiming", async () => {
    const user = userEvent.setup();
    render(<TeamTable {...props} />);
    const rowsEls = screen.getAllByRole("row");
    const trigger = within(rowsEls[1]).getByRole("combobox");
    await user.click(trigger);
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Marshal" })).toBeInTheDocument();
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
});
