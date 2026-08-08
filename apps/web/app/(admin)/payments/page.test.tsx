import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Suspense, isValidElement, type ReactNode } from "react";
import PaymentsPage from "./page";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";

// The happy-path tests below render past the KPI row into <PaymentsTable>
// (a <DataTable>), which calls Next's router hooks — mock the same way every
// other DataTable-rendering test in this app does.
vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

// The event picker is a Client Component using the app-router hooks; the page
// renders it, so they must exist even though these tests assert on the readers.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(),
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

// PaymentsKpiSection and PaymentsTableSection are async Server Components,
// each with its own focused test file (kpi-section.test.tsx,
// table-section.test.tsx) that awaits them directly. testing-library's
// CLIENT renderer can't render an async component reached via JSX (see
// kpi-section.test.tsx's header comment) — rendering the real sections here
// would log "async Client Component" errors and leave only their fallbacks
// in the DOM. Stubbing them keeps page.test.tsx scoped to what the page
// itself still decides — org branching and which orgId/params reach each
// section — not the KPI values or table rows, which live one level down and
// are covered elsewhere.
const PaymentsKpiSection = vi.hoisted(() => vi.fn(() => null));
const PaymentsTableSection = vi.hoisted(() => vi.fn(() => null));
vi.mock("./kpi-section", () => ({ PaymentsKpiSection }));
vi.mock("./table-section", () => ({ PaymentsTableSection }));

const { getMyRoles, listOrgEventOptions } = vi.hoisted(() => ({
  getMyRoles: vi.fn(),
  // Explicit return-type annotation, not inference, on this throwing
  // default: an arrow function whose body is only `throw` infers `never`,
  // which then rejects every later `.mockResolvedValue(...)` call below with
  // "not assignable to parameter of type 'never'".
  listOrgEventOptions: vi.fn((): Promise<{ id: string; name: string; count: number }[]> => {
    throw new Error("must not be called");
  }),
}));

// The event picker's option list. Mocked because the real reader opens a
// Supabase server client, and `cookies()` throws outside a request scope.
vi.mock("@/lib/queries/registrations", () => ({ listOrgEventOptions }));

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

// Walks the React element tree PaymentsPage returns (WITHOUT rendering it —
// `key` isn't a DOM attribute, so it can't be recovered from `render()`
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

describe("PaymentsPage", () => {
  beforeEach(() => {
    resetTableParamsSpies();
    PaymentsKpiSection.mockClear();
    PaymentsTableSection.mockClear();
  });

  // Fix 2 regression test: Payments asserted no capability before this fix,
  // so a marshal (check_in only, no manage_org) reached a fully rendered
  // page past the (admin) layout's "some capability" gate.
  it("redirects a marshal to /no-access and never queries events or mounts either section", async () => {
    getMyRoles.mockResolvedValue({
      role: "marshal", orgId: "org-1", isSuperAdmin: false, isAdmin: false, isOrgAdmin: false,
      capabilities: ["check_in"],
    });

    await expect(PaymentsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT:/no-access");
    expect(listOrgEventOptions).not.toHaveBeenCalled();
    expect(PaymentsKpiSection).not.toHaveBeenCalled();
    expect(PaymentsTableSection).not.toHaveBeenCalled();
  });

  it("renders NoOrgScope and never queries events or mounts either section when the caller has no org", async () => {
    // A bare super_admin: isAdmin true (clears the (admin) layout guard) but
    // orgId null — there's no organization to scope a payments query to.
    // Querying with a null org id 500s rather than returning an empty list,
    // so the page must branch before calling any query at all.
    getMyRoles.mockResolvedValue({
      role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_platform", "manage_team", "manage_org", "check_in"],
    });

    const ui = await PaymentsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listOrgEventOptions).not.toHaveBeenCalled();
    // The row/aggregate/method reads live inside the sections now, not the
    // page — asserting the sections never mount is the equivalent (and
    // stronger) guarantee that those reads never ran.
    expect(PaymentsKpiSection).not.toHaveBeenCalled();
    expect(PaymentsTableSection).not.toHaveBeenCalled();
  });

  it("hands the same org id and params to both sections", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEventOptions.mockResolvedValue([{ id: "ev-1", name: "Kitanglad Skyline Ultra", count: 3 }]);

    const ui = await PaymentsPage({ searchParams: Promise.resolve({ method: "gcash" }) });
    render(ui);

    // Same org id AND the same filters reach both sections — the
    // "structural, not remembered" scope parity the KPI row and table depend
    // on (see kpi-section.test.tsx / table-section.test.tsx for what each
    // section does with them). Asserting orgId alone would miss the page
    // handing a section a mismatched or empty `params`.
    expect(PaymentsKpiSection).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        params: expect.objectContaining({ filters: expect.objectContaining({ status: "all", method: "gcash" }) }),
      }),
      undefined,
    );
    expect(PaymentsTableSection).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        params: expect.objectContaining({ filters: expect.objectContaining({ status: "all", method: "gcash" }) }),
      }),
      undefined,
    );
  });

  it("keys both Suspense boundaries on the resolved params, so the key changes with every param that changes what a section renders", async () => {
    getMyRoles.mockResolvedValue({
      role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true,
      capabilities: ["manage_team", "manage_org", "check_in"],
    });
    listOrgEventOptions.mockResolvedValue([
      { id: "ev-1", name: "Kitanglad Skyline Ultra", count: 3 },
      { id: "ev-9", name: "Some Other Event", count: 1 },
    ]);

    // Each case pairs a raw searchParams input with the serialized suffix
    // `sectionKey` must produce for it (per serializeTableParams — page, per
    // and q are only emitted when non-default; sort always comes after; a
    // filter is only emitted when it differs from its DEFAULTS entry).
    // Unlike Registrations, Payments has no eventId-resolution step, so
    // `sectionKey` serializes `params` as-is — `event` is just one more
    // filter key, covered here like `status`/`method`. Every param family
    // Tasks 1-3 make pending (event switch, paging, search, sort, a
    // status/method filter) is covered so a boundary that stops changing key
    // on any ONE of them regresses here, not just "no key at all".
    const cases: [Record<string, string>, string][] = [
      [{}, "sort=created_at%3Adesc"],
      [{ page: "2" }, "page=2&sort=created_at%3Adesc"],
      [{ q: "maria" }, "q=maria&sort=created_at%3Adesc"],
      [{ event: "ev-9" }, "sort=created_at%3Adesc&event=ev-9"],
      [{ sort: "amount:asc" }, "sort=amount%3Aasc"],
      [{ status: "paid" }, "sort=created_at%3Adesc&status=paid"],
      [{ method: "gcash" }, "sort=created_at%3Adesc&method=gcash"],
    ];

    for (const [searchParams, suffix] of cases) {
      const ui = await PaymentsPage({ searchParams: Promise.resolve(searchParams) });
      expect(findSuspenseKeys(ui)).toEqual([`kpi-${suffix}`, `table-${suffix}`]);
    }
  });
});
