import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Suspense, isValidElement, type ReactNode } from "react";
import RegistrationsPage from "./page";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

// The happy-path tests below render past the header into <EventPicker>,
// which calls Next's router hooks — mock the same way every other
// DataTable/EventPicker-rendering test in this app does.
vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/registrations",
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

// RegistrationsKpiSection and RegistrationsTableSection are async Server
// Components, each with its own focused test file (kpi-section.test.tsx,
// table-section.test.tsx) that awaits them directly. testing-library's
// CLIENT renderer can't render an async component reached via JSX (see
// kpi-section.test.tsx's header comment) — rendering the real sections here
// would log "async Client Component" errors and leave only their fallbacks
// in the DOM. Stubbing them keeps page.test.tsx scoped to what the page
// itself still decides — org/event branching, the header subtitle, and
// which eventId reaches each section — not the KPI values or table rows,
// which live one level down and are covered elsewhere.
const RegistrationsKpiSection = vi.hoisted(() => vi.fn(() => null));
const RegistrationsTableSection = vi.hoisted(() => vi.fn(() => null));
vi.mock("./kpi-section", () => ({ RegistrationsKpiSection }));
vi.mock("./table-section", () => ({ RegistrationsTableSection }));

const {
  listOrgEventOptions, getOrgRegistrationCount, getOrgPendingRegistrationCount, getMyRoles,
} = vi.hoisted(() => ({
  // Explicit return-type annotations, not inference, on these throwing
  // defaults: an arrow function whose body is only `throw` infers `never`,
  // which then rejects every later `.mockResolvedValue(...)` call below with
  // "not assignable to parameter of type 'never'".
  listOrgEventOptions: vi.fn((): Promise<{ id: string; name: string; count: number }[]> => {
    throw new Error("must not be called");
  }),
  // Header-subtitle figures ("N total across M events · K pending payment")
  // — org-wide, independent of the event/filters scope the sections read.
  getOrgRegistrationCount: vi.fn((): Promise<number> => {
    throw new Error("must not be called");
  }),
  getOrgPendingRegistrationCount: vi.fn((): Promise<number> => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/registrations", () => ({
  listOrgEventOptions,
  getOrgRegistrationCount,
  getOrgPendingRegistrationCount,
}));

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

// Walks the React element tree RegistrationsPage returns (WITHOUT rendering
// it — `key` isn't a DOM attribute, so it can't be recovered from `render()`
// output) to collect the `key` of every <Suspense> boundary, in document
// order. This is what lets the "keying" test below assert on the boundary
// key directly, the one thing that makes a skeleton reappear on a
// searchParams-only navigation (see page.tsx's `sectionKey` comment).
function findSuspenseKeys(node: ReactNode): (string | null)[] {
  const keys: (string | null)[] = [];
  function walk(n: ReactNode) {
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (!isValidElement(n)) return;
    if (n.type === Suspense) keys.push(n.key);
    walk((n.props as { children?: ReactNode })?.children ?? null);
  }
  walk(node);
  return keys;
}

describe("RegistrationsPage", () => {
  beforeEach(() => {
    resetTableParamsSpies();
    RegistrationsKpiSection.mockClear();
    RegistrationsTableSection.mockClear();
  });

  // Fix 2 regression test: Registrations asserted no capability before this
  // fix, so a marshal (check_in only, no manage_org) reached a fully
  // rendered page past the (admin) layout's "some capability" gate.
  it("redirects a marshal to /no-access and never queries events or mounts either section", async () => {
    getMyRoles.mockResolvedValue({
      role: "marshal", orgId: "org-1", isSuperAdmin: false, isAdmin: false, isOrgAdmin: false,
      capabilities: ["check_in"],
    });

    await expect(RegistrationsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/no-access");
    expect(listOrgEventOptions).not.toHaveBeenCalled();
    expect(RegistrationsKpiSection).not.toHaveBeenCalled();
    expect(RegistrationsTableSection).not.toHaveBeenCalled();
  });

  it("renders NoOrgScope and never queries events or mounts either section when the caller has no org", async () => {
    // A bare super_admin: isAdmin true (clears the (admin) layout guard) but
    // orgId null — there's no organization to scope an events query to.
    // Querying with a null org id 500s rather than returning an empty list,
    // so the page must branch before calling any query at all.
    getMyRoles.mockResolvedValue({
      role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"],
    });

    const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listOrgEventOptions).not.toHaveBeenCalled();
    // The row/aggregate reads live inside the sections now, not the page —
    // asserting the sections never mount is the equivalent (and stronger)
    // guarantee that those reads never ran.
    expect(RegistrationsKpiSection).not.toHaveBeenCalled();
    expect(RegistrationsTableSection).not.toHaveBeenCalled();
  });

  it("resolves eventId to the org's most recent event, hands it to both sections, and renders the subtitle from the org-wide counts", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEventOptions.mockResolvedValue([{ id: "event-1", name: "Dahilayan Sky Ultra", count: 4 }]);
    getOrgRegistrationCount.mockResolvedValue(4);
    getOrgPendingRegistrationCount.mockResolvedValue(1);

    const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    // Same event id AND the same (default) filters reach both sections —
    // the "structural, not remembered" filter parity the KPI row and table
    // depend on (see kpi-section.test.tsx / table-section.test.tsx for what
    // each section does with them). Asserting eventId alone would miss the
    // page handing a section a mismatched or empty `params`.
    expect(RegistrationsKpiSection).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-1",
        params: expect.objectContaining({ filters: expect.objectContaining({ status: "all", category: "all" }) }),
      }),
      undefined,
    );
    expect(RegistrationsTableSection).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-1",
        params: expect.objectContaining({ filters: expect.objectContaining({ status: "all", category: "all" }) }),
      }),
      undefined,
    );
    // The subtitle's figures each live in their own `<span>` (for
    // `font-mono tabular`), so its full text is split across sibling nodes —
    // match against the header <p>'s own textContent rather than
    // getByText's default (direct-text-node-only) matching.
    expect(
      screen.getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "4 total across 1 event · 1 pending payment",
      ),
    ).toBeInTheDocument();
  });

  it("renders the subtitle's zeroed figures, not a blank header, when the org has no registrations yet", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEventOptions.mockResolvedValue([{ id: "event-1", name: "Dahilayan Sky Ultra", count: 0 }]);
    getOrgRegistrationCount.mockResolvedValue(0);
    getOrgPendingRegistrationCount.mockResolvedValue(0);

    const ui = await RegistrationsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(
      screen.getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "0 total across 1 event · 0 pending payment",
      ),
    ).toBeInTheDocument();
  });

  it("keys both Suspense boundaries on the resolved params, so the key changes with every param that changes what a section renders", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEventOptions.mockResolvedValue([
      { id: "event-1", name: "Dahilayan Sky Ultra", count: 4 },
      { id: "event-9", name: "Some Other Event", count: 1 },
    ]);
    getOrgRegistrationCount.mockResolvedValue(4);
    getOrgPendingRegistrationCount.mockResolvedValue(1);

    // Each case pairs a raw searchParams input with the serialized suffix
    // `sectionKey` must produce for it (per serializeTableParams — page,
    // per and q are only emitted when non-default; sort and filters always
    // come after; `event` is always pinned to the resolved eventId). Every
    // param family Tasks 1-3 make pending (event switch, paging, search,
    // sort, a status/category filter) is covered so a boundary that stops
    // changing key on any ONE of them regresses here, not just "no key at
    // all".
    const cases: [Record<string, string>, string][] = [
      [{}, "sort=created_at%3Adesc&event=event-1"],
      [{ page: "2" }, "page=2&sort=created_at%3Adesc&event=event-1"],
      [{ q: "maria" }, "q=maria&sort=created_at%3Adesc&event=event-1"],
      [{ event: "event-9" }, "sort=created_at%3Adesc&event=event-9"],
      [{ sort: "full_name:asc" }, "sort=full_name%3Aasc&event=event-1"],
      [{ status: "paid" }, "sort=created_at%3Adesc&status=paid&event=event-1"],
    ];

    for (const [searchParams, suffix] of cases) {
      const ui = await RegistrationsPage({ searchParams: Promise.resolve(searchParams) });
      expect(findSuspenseKeys(ui)).toEqual([`kpi-${suffix}`, `table-${suffix}`]);
    }
  });

  it("does not change the Suspense keys when only the open modal changes", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEventOptions.mockResolvedValue([{ id: "event-1", name: "Dahilayan Sky Ultra", count: 4 }]);
    getOrgRegistrationCount.mockResolvedValue(4);
    getOrgPendingRegistrationCount.mockResolvedValue(1);

    const withModal = await RegistrationsPage({ searchParams: Promise.resolve({ reg: "r-123" }) });
    const withoutModal = await RegistrationsPage({ searchParams: Promise.resolve({}) });

    expect(findSuspenseKeys(withModal)).toEqual(findSuspenseKeys(withoutModal));
  });
});
