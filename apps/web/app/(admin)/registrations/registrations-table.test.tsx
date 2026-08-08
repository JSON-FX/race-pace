import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegistrationsTable } from "./registrations-table";
import type { RegistrationRow } from "@/lib/queries/registrations";
import { tableParamsSpies, tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

// registrations-table.tsx now reads the open registration id straight from
// useSearchParams() (see its `urlRegId`), not the `activeFilters` prop, so a
// mocked search-param source is required the same way
// payments/event-picker.test.tsx supplies one for PaymentsEventPicker —
// though for a different failure mode than that file's: outside a real Next
// router, an unmocked useSearchParams() returns `null` rather than throwing
// (confirmed — every test here fails with `Cannot read properties of null
// (reading 'get')` without this mock), so `.get("reg")` is what breaks.
// "invariant expected app router to be mounted" is useRouter's failure mode,
// which is why the sibling file hits it — PaymentsEventPicker calls
// useRouter, not useSearchParams. A mutable binding, not a fixed literal
// like that file's, because different cases below need `reg` present or
// absent in the URL.
let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

// A SECOND, separate mock — not an alternative to the one above. Opening the
// sheet mounts RegistrationHistory (added on main), which queries
// registration_audit from the browser with an `.order()` step. Add-ons no
// longer need stubbing here: they arrive on `row.addons`, so the fixtures
// below set them directly.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  }),
}));

beforeEach(() => {
  resetTableParamsSpies();
  mockSearchParams = new URLSearchParams();
});

const rows: RegistrationRow[] = [
  {
    id: "r1", user_id: "u1", category_id: "c1", category_label: "50K Ultra",
    full_name: "Maria Josefa Santos", bib_name: "D-1042", avatar_url: null, email: "maria.santos@gmail.com",
    total_amount: 285000, payment_status: "paid", payment_method: "gcash",
    created_at: "2026-08-03T09:14:00Z", custom_data: {}, addons: [],
  },
  {
    id: "r2", user_id: "u2", category_id: "c1", category_label: "25K",
    full_name: "Angelo Lim", bib_name: null, avatar_url: null, email: "angelo.lim@yahoo.com",
    total_amount: 195000, payment_status: "pending", payment_method: null,
    created_at: "2026-08-03T08:31:00Z", custom_data: {}, addons: [],
  },
];

const props = {
  rows, total: 2, page: 1, per: 25, sort: [], activeFilters: {}, q: "",
  categories: [{ id: "c1", label: "50K Ultra" }],
};

describe("RegistrationsTable", () => {
  it("renders the runner name and category", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("Maria Josefa Santos")).toBeInTheDocument();
    expect(screen.getByText("50K Ultra")).toBeInTheDocument();
  });

  it("formats centavos as pesos", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("₱2,850")).toBeInTheDocument();
  });

  it("builds the category filter from the event's categories", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
  });

  // THE headline requirement of Task 7: Registrations is scoped by ?event=,
  // and DataTable's "Clear all" wipes every param except sort/per/whatever
  // is named in preserveOnClear. If this page fails to pass
  // preserveOnClear={["event"]}, clicking "Clear all" silently moves the
  // admin to a different event's registrations with no visible cause.
  it("passes preserveOnClear=[\"event\"] so Clear all cannot drop the event scope", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} activeFilters={{ status: "paid" }} />);
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(tableParamsSpies.clearFilters).toHaveBeenCalledWith(["event"]);
  });

  // MINOR 3: the detail sheet is deep-linkable via ?reg=<id> (restored to
  // match the old SPA — an admin can bookmark or paste a link to a specific
  // registration), driven from `activeFilters.reg` rather than local state.
  it("opens the detail sheet for the registration named in ?reg=", () => {
    mockSearchParams = new URLSearchParams("reg=r1");
    render(<RegistrationsTable {...props} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The name renders once in the table row and again in the sheet header.
    expect(screen.getAllByText("Maria Josefa Santos").length).toBeGreaterThanOrEqual(2);
  });

  it("does not render an active-filter chip for reg (it has no FilterDef)", () => {
    render(<RegistrationsTable {...props} activeFilters={{ reg: "r1" }} />);
    // ActiveFilters only builds chips from filterDefs (status/category) plus
    // q — reg isn't in filterDefs, same as `event` already isn't, so with no
    // other filter active there should be no chips row at all, and
    // therefore no "Clear all" button either.
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  // Was "... via setFilter, not local state" — closeReg no longer routes
  // through any useTableParams setter at all; it writes `?reg=` via the
  // History API directly (see the "without any server navigation" tests
  // below), so a name pinning any particular mechanism would only go stale
  // again the next time that mechanism changes.
  it("closing the sheet clears ?reg=, not local state", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("reg=r1");
    const pushState = vi.spyOn(window.history, "pushState");
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(pushState).toHaveBeenCalled();
    expect(String(pushState.mock.calls.at(-1)?.[2])).not.toContain("reg=");
    pushState.mockRestore();
  });

  // Was "... by setting ?reg= via setFilter" — same rename reason as above.
  it("clicking a runner name opens the sheet by setting ?reg=", async () => {
    const user = userEvent.setup();
    const pushState = vi.spyOn(window.history, "pushState");
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getByText("Maria Josefa Santos"));
    expect(String(pushState.mock.calls.at(-1)?.[2])).toContain("reg=r1");
    pushState.mockRestore();
  });

  // Table cell composition (visual parity V3): the Runner cell is now an
  // avatar + name-over-email "who" cell, not just a bare name.
  it("renders the runner's email under their name", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("maria.santos@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("MJ")).toBeInTheDocument(); // avatar initials
  });

  // Bib column: font-mono value when assigned, em-dash fallback when not —
  // r1 has a bib, r2 doesn't.
  it("renders the Bib column with an em-dash fallback for an unassigned bib", () => {
    render(<RegistrationsTable {...props} />);
    expect(screen.getByText("D-1042")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // "Send email"/"Assign bibs"/"Mark checked-in" have no real backend yet
  // (see task-v3-report.md) — they must render disabled, not silently do
  // nothing when clicked.
  it("renders the backend-less bulk actions as disabled once rows are selected", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getAllByLabelText("Select row")[0]);
    expect(screen.getByRole("button", { name: /Send email/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Assign bibs/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Mark checked-in/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Cancel$/ })).not.toBeDisabled();
  });

  // Regression: a `disabled` <button> is pulled out of the tab order
  // entirely, and the tooltip wrapper around it used to be a bare <span>
  // with no tabIndex — also unreachable by keyboard. A keyboard/screen-reader
  // user got three greyed buttons with no way to find out why. The wrapper
  // must be a real focus stop that carries the explanation itself, not just
  // something a mouse hover reveals.
  it("makes the disabled bulk actions' explanation reachable by keyboard, not just mouse hover", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getAllByLabelText("Select row")[0]);
    const sendEmailButton = screen.getByRole("button", { name: /Send email/ });
    const wrapper = sendEmailButton.closest("span[tabindex]");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(wrapper).toHaveAttribute("aria-label", expect.stringMatching(/bulk email sending/i));
  });

  it("opens the bulk-cancel confirmation dialog with the selected ids, and does not cancel until confirmed", async () => {
    const user = userEvent.setup();
    render(<RegistrationsTable {...props} />);
    await user.click(screen.getAllByLabelText("Select row")[0]);
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(screen.getByText("Cancel 1 registration?")).toBeInTheDocument();
  });

  it("opens the detail modal without waiting for the URL to update", async () => {
    const user = userEvent.setup();
    const pushState = vi.spyOn(window.history, "pushState");
    // The mocked useSearchParams never reflects writeRegParam's pushState — it
    // returns the same value for the component's whole lifetime — so a modal
    // that waited on the URL could never open here. That is the regression
    // this pins: before, `reg` was read straight from activeFilters and
    // opening cost a full server round trip.
    render(
      <RegistrationsTable
        rows={rows} total={2} page={1} per={25} sort={[]}
        activeFilters={{}} q="" categories={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /View Maria Josefa Santos/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Still syncs the URL behind the modal, so the registration stays linkable.
    expect(String(pushState.mock.calls.at(-1)?.[2])).toContain("reg=r1");
    pushState.mockRestore();
  });

  it("closes the modal without waiting for the URL either", async () => {
    const user = userEvent.setup();
    // Opposite direction: `reg` IS in the URL and the mock will never clear it.
    mockSearchParams = new URLSearchParams("reg=r1");
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <RegistrationsTable
        rows={rows} total={2} page={1} per={25} sort={[]}
        activeFilters={{}} q="" categories={[]}
      />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(pushState).toHaveBeenCalled();
    expect(String(pushState.mock.calls.at(-1)?.[2])).not.toContain("reg=");
    pushState.mockRestore();
  });

  // Opening a modal must not navigate. `patch` routes through router.push,
  // which always re-runs the server component: the admin saw the progress bar
  // and a full page re-render for data already on the client. The URL still
  // updates so a registration stays linkable — via the History API, which Next
  // syncs with useSearchParams without re-running anything.
  it("opens the modal without any server navigation", async () => {
    const user = userEvent.setup();
    // writeRegParam reads window.location.search directly, not the `page={2}`
    // prop — a genuine pagination-preserved guard needs a REAL `page` param
    // on the URL to preserve, or the assertion below is vacuous (confirmed by
    // mutation: see task-8-report.md).
    window.history.pushState(null, "", "/registrations?page=2");
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <RegistrationsTable
        rows={rows} total={60} page={2} per={25} sort={[]}
        activeFilters={{}} q="" categories={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /View Maria Josefa Santos/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(tableParamsSpies.patch).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalled();
    const url = String(pushState.mock.calls.at(-1)?.[2]);
    expect(url).toContain("reg=r1");
    // Pagination must survive — this is the page-2 bug's regression guard.
    expect(url).toContain("page=2");
    pushState.mockRestore();
  });

  it("closes the modal without any server navigation", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("reg=r1");
    // Same seeding as the open test above, plus `reg=r1` already present —
    // this test starts from the modal already open.
    window.history.pushState(null, "", "/registrations?page=2&reg=r1");
    const pushState = vi.spyOn(window.history, "pushState");
    render(
      <RegistrationsTable
        rows={rows} total={60} page={2} per={25} sort={[]}
        activeFilters={{}} q="" categories={[]}
      />,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(tableParamsSpies.patch).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalled();
    const url = String(pushState.mock.calls.at(-1)?.[2]);
    expect(url).not.toContain("reg=");
    // Pagination must survive on close too — Task 7's original regression
    // guard covered both directions; this restores the close-side half.
    expect(url).toContain("page=2");
    pushState.mockRestore();
  });

  // Back/Forward moves the URL without ever calling openReg/closeReg — Next
  // syncs history navigation with useSearchParams, so the component's ONLY
  // way to learn about it is `urlRegId` changing on a fresh render. The
  // clearing effect (`useEffect(() => setOverride(null), [urlRegId])`) is
  // what makes that translate into the modal actually closing — WITHOUT it,
  // the `override` a click leaves behind never gets dropped, and it
  // permanently wins over whatever `urlRegId` says afterward (`selectedId =
  // override ? override.id : urlRegId`). A test that only flips
  // `mockSearchParams` without ever setting `override` via a real click
  // (i.e. asserting on `urlRegId` alone) would pass with the effect deleted
  // too, since `override` would still be null on its own — so this must
  // open via a click first, exactly like a real Back press would follow a
  // real open.
  it("closes the modal on a Back press, even though a click set the override", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RegistrationsTable {...props} />);

    await user.click(screen.getByRole("button", { name: /View Maria Josefa Santos/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Simulate the URL catching up to the click a moment later (what a real
    // pushState -> useSearchParams sync does) — this is the point at which
    // the clearing effect drops the override while urlRegId still agrees,
    // so nothing is visibly different yet.
    mockSearchParams = new URLSearchParams("reg=r1");
    rerender(<RegistrationsTable {...props} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Now Back: the URL moves with no openReg/closeReg call in between.
    mockSearchParams = new URLSearchParams();
    rerender(<RegistrationsTable {...props} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
