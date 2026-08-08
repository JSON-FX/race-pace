# Marshal Console Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a marshal open the admin console and use the check-in station that was built for them, by replacing the `isAdmin` boolean with a four-tier capability model asserted server-side on every route.

**Architecture:** `getMyRoles()` gains a `capabilities` array derived from the single `resolvedRow` it already resolves. The `(admin)` layout gates on "has any capability" instead of "is admin"; each route asserts its own capability; the nav filters on the same list. One edge-function change gives `canCheckIn()` the `event_scope` test its SQL counterpart already applies.

**Tech Stack:** Next.js 15 App Router (server components, server actions), TypeScript, vitest + jsdom, Deno edge functions, pnpm 9.

**Spec:** `docs/superpowers/specs/2026-08-09-marshal-console-access-design.md`

## Global Constraints

- Node >= 20, pnpm 9.7.0. Never run `npm`.
- `apps/web` tests live **beside** their subject as `foo.test.ts(x)`, never in `__tests__/`. Run with `pnpm --filter web test` (the script pins `TZ=America/New_York`).
- **No schema changes.** This plan touches `apps/web` application code plus `supabase/functions/_shared/authz.ts` and `supabase/functions/check-in/index.ts`.
- `apps/web/lib/nav-items.ts` must stay free of server-only imports. Its header explains that importing `@/lib/queries/roles`'s runtime surface drags `next/headers` into every client component that imports it and breaks the build. It may `import type` from there, and may value-import from a pure module.
- `capabilities` is an **array**, not a `Set`. `MyRoles` is passed as a prop into `AppShell` (`apps/web/app/(admin)/layout.tsx:44`), crossing the server→client boundary, and a `Set` does not serialize across it.
- **Preserve today's gating exactly.** Where this plan and the existing code disagree about who may reach a route, the code is right and the plan is wrong — stop and report rather than loosening a gate.
- Comments explain *why*, not *what*.

## Test Commands

| Scope | Command |
| --- | --- |
| Admin web | `pnpm --filter web test` |
| One file | `pnpm --filter web test lib/queries/roles.test.ts` |
| Types | `pnpm --filter web typecheck` |

## File Structure

**Created:**
- `apps/web/lib/capabilities.ts` — the `Capability` type and the pure role→capabilities mapping. Server-free so `nav-items.ts` can value-import it.
- `apps/web/lib/capabilities.test.ts`
- `apps/web/lib/nav-items.test.ts`

**Modified:**
- `apps/web/lib/queries/roles.ts` — `MyRoles.capabilities`, marshal in `resolvedRow`, `requireCapability`
- `apps/web/lib/queries/roles.test.ts`
- `apps/web/lib/nav-items.ts` — `requires` per item; filters read capabilities
- `apps/web/app/(admin)/layout.tsx` — gate on capabilities
- `apps/web/app/(admin)/team/page.tsx`, `organizations/page.tsx`, `commission/page.tsx`, `payouts/page.tsx` — assert capabilities instead of `isOrgAdmin`/`isSuperAdmin`
- `apps/web/lib/team-roles.ts` + `.test.ts` — drop `claiming` from the assignable list
- `supabase/functions/_shared/authz.ts` — `canCheckIn` takes `eventId`
- `supabase/functions/check-in/index.ts` — pass the registration's `event_id`

---

### Task 1: The capability vocabulary

**Files:**
- Create: `apps/web/lib/capabilities.ts`
- Create: `apps/web/lib/capabilities.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Capability = "manage_platform" | "manage_team" | "manage_org" | "check_in"`
  - `capabilitiesFor(role: string | null, isSuperAdmin: boolean): Capability[]`
  - `hasCapability(caps: readonly Capability[], cap: Capability): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/capabilities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { capabilitiesFor, hasCapability, type Capability } from "./capabilities";

const sorted = (c: readonly Capability[]) => [...c].sort();

describe("capabilitiesFor", () => {
  it("gives a super admin every capability", () => {
    expect(sorted(capabilitiesFor(null, true)))
      .toEqual(sorted(["manage_platform", "manage_team", "manage_org", "check_in"]));
  });

  it("gives an org admin team and org management plus check-in, but not platform", () => {
    expect(sorted(capabilitiesFor("admin", false)))
      .toEqual(sorted(["manage_team", "manage_org", "check_in"]));
  });

  // The privilege-escalation guard. /team is admin-only today (nav-items.ts
  // filters it on isOrgAdmin); folding it into manage_org would hand editors
  // org membership management as a side effect of this refactor.
  it("does NOT give an editor manage_team", () => {
    expect(capabilitiesFor("editor", false)).not.toContain("manage_team");
  });

  it("gives an editor org management and check-in", () => {
    expect(sorted(capabilitiesFor("editor", false))).toEqual(sorted(["manage_org", "check_in"]));
  });

  it("gives a marshal check-in and nothing else", () => {
    expect(capabilitiesFor("marshal", false)).toEqual(["check_in"]);
  });

  // `claiming` is assignable in the team UI but has no consumer until the
  // race-kit spec. It must not silently inherit anything.
  it("gives the claiming role nothing yet", () => {
    expect(capabilitiesFor("claiming", false)).toEqual([]);
  });

  it("gives an unknown or absent role nothing", () => {
    expect(capabilitiesFor(null, false)).toEqual([]);
    expect(capabilitiesFor("nonsense", false)).toEqual([]);
  });

  it("lets super admin win over a lesser role held in the resolved org", () => {
    expect(capabilitiesFor("marshal", true)).toContain("manage_platform");
  });
});

describe("hasCapability", () => {
  it("is true when present and false when absent", () => {
    expect(hasCapability(["check_in"], "check_in")).toBe(true);
    expect(hasCapability(["check_in"], "manage_org")).toBe(false);
    expect(hasCapability([], "check_in")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter web test lib/capabilities.test.ts`
Expected: FAIL — cannot resolve `./capabilities`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/capabilities.ts`:

```ts
/**
 * What a console user may do, as opposed to what they are called.
 *
 * Four tiers because the console already draws four distinctions; this states
 * them once instead of spreading them across a layout gate, two nav filters and
 * a handful of per-page checks that could drift apart.
 *
 * Deliberately server-free — no next/headers, no Supabase, no imports at all —
 * so `lib/nav-items.ts` can value-import it without dragging server-only modules
 * into every client component. See that file's header for what happens otherwise.
 */
export type Capability =
  | "manage_platform" // Organizations, Commission, Payouts — every org's data
  | "manage_team"     // Team — org membership; admin-only within an org
  | "manage_org"      // Dashboard, Events, Registrations, Payments, Settings
  | "check_in";       // the check-in station

const BY_ROLE: Record<string, Capability[]> = {
  admin: ["manage_team", "manage_org", "check_in"],
  editor: ["manage_org", "check_in"],
  marshal: ["check_in"],
  // `claiming` ("Race Kit") is assignable in the team UI but has no authorization
  // consumer anywhere yet. It gets `release_kits` when the race-kit spec lands;
  // until then it must grant nothing rather than inherit a neighbour's set.
  claiming: [],
};

const ALL: Capability[] = ["manage_platform", "manage_team", "manage_org", "check_in"];

/** `role` is the caller's role IN THE RESOLVED ORG — not any role they hold
 *  anywhere. See roles.ts: orgId, isOrgAdmin and this must all describe the
 *  same single row, or a two-org user gets one org's data with another's powers. */
export function capabilitiesFor(role: string | null, isSuperAdmin: boolean): Capability[] {
  if (isSuperAdmin) return [...ALL];
  if (!role) return [];
  return [...(BY_ROLE[role] ?? [])];
}

export function hasCapability(caps: readonly Capability[], cap: Capability): boolean {
  return caps.includes(cap);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter web test lib/capabilities.test.ts && pnpm --filter web typecheck`
Expected: PASS, 9 tests, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/capabilities.ts apps/web/lib/capabilities.test.ts
git commit -m "feat(admin): add the console capability vocabulary"
```

---

### Task 2: Resolve capabilities, and let a marshal resolve an org at all

**Files:**
- Modify: `apps/web/lib/queries/roles.ts`
- Modify: `apps/web/lib/queries/roles.test.ts`

**Interfaces:**
- Consumes: `Capability`, `capabilitiesFor` (Task 1).
- Produces: `MyRoles` gains `capabilities: Capability[]`. `resolvedRow` extends to marshal.

**The bug being fixed.** `resolvedRow` is `rows.find(admin) ?? rows.find(editor)` (`roles.ts:68`). A marshal matches neither, so `orgId` falls through to `null` and every org-scoped page renders `<NoOrgScope />`. Widening the layout gate without this produces an empty console, not a working one.

**The invariant to preserve.** `roles.ts:52-68` documents a fixed security bug: for a user with rows in two orgs, `orgId` came from one and `isOrgAdmin` from another, so the console showed org Y's data with org X's powers. Capabilities must derive from the **same single `resolvedRow`** — never from a scan across all rows.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/queries/roles.test.ts`, inside the existing `describe("getMyRoles")` block, using that file's existing `loadGetMyRoles(rows)` passthrough-mock helper:

```ts
  it("resolves an org and check_in for a marshal-only account", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "marshal", org_id: "org-M" }]);
    const r = await getMyRoles();
    // Both halves matter: without the orgId the console renders NoOrgScope on
    // every page, which is the bug that made the shipped check-in station
    // unreachable rather than merely unlisted.
    expect(r!.orgId).toBe("org-M");
    expect(r!.capabilities).toEqual(["check_in"]);
  });

  it("keeps an editor out of manage_team", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "editor", org_id: "org-E" }]);
    const r = await getMyRoles();
    expect(r!.capabilities).toContain("manage_org");
    expect(r!.capabilities).not.toContain("manage_team");
  });

  it("derives capabilities from the SAME row orgId came from", async () => {
    // admin in X, editor in Y, adversarial order — the same shape as the
    // regression test above this one. Capabilities must describe X (the
    // resolved org), never a union across both rows.
    const getMyRoles = await loadGetMyRoles([
      { role: "editor", org_id: "org-Y" },
      { role: "admin", org_id: "org-X" },
    ]);
    const r = await getMyRoles();
    expect(r!.orgId).toBe("org-X");
    expect(r!.capabilities).toContain("manage_team");
  });

  it("does not let a marshal row in another org add capabilities to the resolved org", async () => {
    const getMyRoles = await loadGetMyRoles([
      { role: "editor", org_id: "org-E" },
      { role: "marshal", org_id: "org-M" },
    ]);
    const r = await getMyRoles();
    expect(r!.orgId).toBe("org-E");
    expect(r!.capabilities).toEqual(expect.arrayContaining(["manage_org", "check_in"]));
    expect(r!.capabilities).not.toContain("manage_team");
  });

  it("gives a bare super admin every capability", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "super_admin", org_id: "" }]);
    const r = await getMyRoles();
    expect(r!.capabilities).toContain("manage_platform");
    expect(r!.capabilities).toContain("manage_team");
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter web test lib/queries/roles.test.ts`
Expected: FAIL — the marshal test returns `orgId: null` and `capabilities` is undefined.

- [ ] **Step 3: Extend the type and the resolution**

In `apps/web/lib/queries/roles.ts`:

Add the import:
```ts
import { capabilitiesFor, type Capability } from "@/lib/capabilities";
```

Add to the `MyRoles` type:
```ts
  /** What this caller may do IN THE RESOLVED ORG. An array, not a Set: MyRoles
   *  is passed as a prop into AppShell and must cross the server→client
   *  boundary, which a Set does not survive. */
  capabilities: Capability[];
```

Extend `resolvedRow` (currently line 68) to fall through to a marshal row:
```ts
  // Marshal last, after admin and editor, so a user holding both keeps the
  // stronger row. Without this a marshal-only account resolves to no row at
  // all, orgId stays null, and every org-scoped page renders <NoOrgScope />.
  const resolvedRow =
    rows.find((r) => r.role === "admin")
    ?? rows.find((r) => r.role === "editor")
    ?? rows.find((r) => r.role === "marshal");
```

Add to the returned object, alongside `isOrgAdmin`:
```ts
    // From resolvedRow's role, NOT from a scan across rows — same reason
    // isOrgAdmin is computed this way. See the resolvedRow comment above.
    capabilities: capabilitiesFor(resolvedRow?.role ?? null, isSuperAdmin),
```

- [ ] **Step 4: Fix the test helper's fixture**

`apps/web/lib/queries/roles.test.ts` has a `roles(overrides)` helper building a `MyRoles` literal for the `requireOrgId` tests. Add `capabilities: []` to its defaults so the literal still satisfies the widened type.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS. `typecheck` will flag any other place constructing a `MyRoles` literal — fix each by adding `capabilities`, changing no assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/queries/roles.ts apps/web/lib/queries/roles.test.ts
git commit -m "feat(admin): resolve capabilities and an org id for marshals"
```

---

### Task 3: Nav derives from capabilities

**Files:**
- Modify: `apps/web/lib/nav-items.ts`
- Create: `apps/web/lib/nav-items.test.ts`

**Interfaces:**
- Consumes: `Capability`, `hasCapability` (Task 1); `MyRoles.capabilities` (Task 2).
- Produces: `NavItem` gains `requires: Capability`. `visibleOrgItems`/`visibleSuperItems` keep their signatures and return types.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/nav-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { visibleOrgItems, visibleSuperItems, primaryMobileItems, moreMobileItems } from "./nav-items";
import type { MyRoles } from "@/lib/queries/roles";
import type { Capability } from "@/lib/capabilities";

const who = (capabilities: Capability[], over: Partial<MyRoles> = {}): MyRoles => ({
  role: null, orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: false,
  capabilities, ...over,
});

const paths = (items: { to: string }[]) => items.map((i) => i.to);

describe("visibleOrgItems", () => {
  it("shows a marshal only check-in", () => {
    expect(paths(visibleOrgItems(who(["check_in"])))).toEqual(["/check-in"]);
  });

  // The privilege-escalation guard, mirrored from capabilities.test.ts: /team
  // is admin-only today and must not become visible to an editor.
  it("hides Team from an editor", () => {
    expect(paths(visibleOrgItems(who(["manage_org", "check_in"])))).not.toContain("/team");
  });

  it("shows Team to an org admin", () => {
    expect(paths(visibleOrgItems(who(["manage_team", "manage_org", "check_in"])))).toContain("/team");
  });

  it("shows every org destination to an org admin", () => {
    const p = paths(visibleOrgItems(who(["manage_team", "manage_org", "check_in"])));
    expect(p).toEqual(expect.arrayContaining(
      ["/dashboard", "/events", "/registrations", "/payments", "/check-in", "/team", "/settings"],
    ));
  });
});

describe("visibleSuperItems", () => {
  it("is empty without manage_platform", () => {
    expect(visibleSuperItems(who(["manage_team", "manage_org", "check_in"]))).toEqual([]);
  });

  it("lists the platform destinations with manage_platform", () => {
    expect(paths(visibleSuperItems(who(["manage_platform"]))))
      .toEqual(["/organizations", "/commission", "/payouts"]);
  });
});

describe("mobile nav", () => {
  it("gives a marshal a bottom bar of just check-in", () => {
    expect(paths(primaryMobileItems(who(["check_in"])))).toEqual(["/check-in"]);
  });

  it("gives a marshal no More groups, since nothing else is reachable", () => {
    expect(moreMobileItems(who(["check_in"]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter web test lib/nav-items.test.ts`
Expected: FAIL — a marshal currently gets every org item, because `visibleOrgItems` only filters `/team`.

- [ ] **Step 3: Add `requires` and filter on it**

In `apps/web/lib/nav-items.ts`:

Import the pure module (value import is safe — `capabilities.ts` has no imports at all):
```ts
import { hasCapability, type Capability } from "@/lib/capabilities";
```

Widen the item type:
```ts
export type NavItem = {
  to: string; label: string; icon: LucideIcon;
  countKey?: keyof NonNullable<NavCounts>;
  /** The capability required to reach this destination. Stated here so the
   *  nav and the route gate read the same list — previously each nav filter
   *  hand-wrote its own predicate and could drift from the page's check. */
  requires: Capability;
};
```

Annotate both lists:
```ts
export const ORG_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, requires: "manage_org" },
  { to: "/events", label: "Events", icon: CalendarDays, countKey: "events", requires: "manage_org" },
  { to: "/registrations", label: "Registrations", icon: ClipboardList, countKey: "registrations", requires: "manage_org" },
  { to: "/payments", label: "Payments", icon: CreditCard, requires: "manage_org" },
  { to: "/check-in", label: "Check-in", icon: QrCode, requires: "check_in" },
  { to: "/team", label: "Team", icon: Users, requires: "manage_team" },
  { to: "/settings", label: "Settings", icon: SettingsIcon, requires: "manage_org" },
];

export const SUPER_ITEMS: NavItem[] = [
  { to: "/organizations", label: "Organizations", icon: Building2, requires: "manage_platform" },
  { to: "/commission", label: "Commission", icon: Percent, requires: "manage_platform" },
  { to: "/payouts", label: "Payouts", icon: Banknote, requires: "manage_platform" },
];
```

Replace both filters:
```ts
/** Org-scoped nav, filtered by capability. Replaces the hand-written
 *  `it.to !== "/team" || roles.isOrgAdmin` predicate — same outcome for an
 *  admin and an editor, and now correct for a marshal too. */
export function visibleOrgItems(roles: MyRoles): NavItem[] {
  return ORG_ITEMS.filter((it) => hasCapability(roles.capabilities, it.requires));
}

/** PLATFORM group — Organizations / Commission / Payouts. */
export function visibleSuperItems(roles: MyRoles): NavItem[] {
  return SUPER_ITEMS.filter((it) => hasCapability(roles.capabilities, it.requires));
}
```

`primaryMobileItems` and `moreMobileItems` need no change — both derive from `visibleOrgItems`/`visibleSuperItems`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS. Any component constructing a `NavItem` literal will now need `requires`; add it, changing no behaviour.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/nav-items.ts apps/web/lib/nav-items.test.ts
git commit -m "feat(admin): derive nav visibility from capabilities"
```

---

### Task 4: The layout gate

**Files:**
- Modify: `apps/web/app/(admin)/layout.tsx:19`

**Interfaces:**
- Consumes: `MyRoles.capabilities` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Change the gate**

Replace line 19:
```ts
  if (!roles?.isAdmin) redirect("/no-access");
```
with:
```ts
  // "Can this person use the console at all", not "are they an admin". A
  // marshal holds only check_in and must get past here to reach the station
  // that was built for them; each route below still asserts its own capability.
  if (!roles || roles.capabilities.length === 0) redirect("/no-access");
```

Leave `isAdmin` on the type for now — Task 5 removes the last consumers, and deleting it here would break pages mid-plan.

- [ ] **Step 2: Verify nothing regressed**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS. This step has no test of its own; Task 5's route-assertion tests are what prove the gate plus the per-route checks compose correctly.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/(admin)/layout.tsx"
git commit -m "feat(admin): gate the console on having any capability"
```

---

### Task 5: Per-route capability assertions

**Files:**
- Modify: `apps/web/lib/queries/roles.ts` — add `requireCapability`
- Modify: `apps/web/lib/queries/roles.test.ts`
- Modify: `apps/web/app/(admin)/team/page.tsx` (the `isOrgAdmin` branch, ~line 43)
- Modify: `apps/web/app/(admin)/organizations/page.tsx:46`
- Modify: `apps/web/app/(admin)/commission/page.tsx`, `apps/web/app/(admin)/payouts/page.tsx` (their `isSuperAdmin` checks)

**Interfaces:**
- Consumes: `hasCapability` (Task 1), `MyRoles.capabilities` (Task 2).
- Produces: `requireCapability(cap: Capability): Promise<MyRoles>` — returns the roles when the capability is held, otherwise `redirect("/no-access")`.

**Preserve two distinct failure modes.** Platform pages use `notFound()` today, deliberately: `organizations/page.tsx:44-46` explains that whether the platform page *exists* is itself information not to disclose. Org-level denials redirect to `/no-access`. Keep both — swap only what is being tested, from a role to a capability.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/queries/roles.test.ts`:

```ts
describe("requireCapability", () => {
  async function load(capabilities: Capability[]) {
    vi.resetModules();
    const redirect = vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`); });
    vi.doMock("next/navigation", () => ({ redirect }));
    vi.doMock("./roles", async (orig) => {
      const actual = await (orig as () => Promise<typeof import("./roles")>)();
      return { ...actual, getMyRoles: async () => ({
        role: null, orgId: "org-1", isSuperAdmin: false, isAdmin: true,
        isOrgAdmin: false, capabilities,
      }) };
    });
    const mod = await import("./roles");
    return { requireCapability: mod.requireCapability, redirect };
  }

  it("returns the roles when the capability is held", async () => {
    const { requireCapability } = await load(["manage_org"]);
    const r = await requireCapability("manage_org");
    expect(r.capabilities).toContain("manage_org");
  });

  it("redirects to /no-access when it is not", async () => {
    const { requireCapability } = await load(["check_in"]);
    await expect(requireCapability("manage_org")).rejects.toThrow("REDIRECT:/no-access");
  });
});
```

If mocking a module against itself proves awkward in this file's setup, restructure `requireCapability` to take the roles as an argument (`requireCapability(roles, cap)`) and test it purely — the pure form is preferable anyway and callers already have `roles` in hand. Say which form you chose in your report.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter web test lib/queries/roles.test.ts`
Expected: FAIL — `requireCapability` is not exported.

- [ ] **Step 3: Add the helper**

In `apps/web/lib/queries/roles.ts`:

```ts
import { redirect } from "next/navigation";
import { hasCapability, type Capability } from "@/lib/capabilities";

/**
 * Assert a capability inside a server component, before anything renders.
 *
 * Hiding a nav link is a convenience; this is the control. A marshal typing
 * /payments is redirected here rather than reaching a page whose emptiness
 * depends on RLS — the difference between an authorization boundary and a
 * data-layer accident.
 *
 * Platform pages (Organizations, Commission, Payouts) deliberately use
 * notFound() instead: whether they exist is itself information. See
 * organizations/page.tsx.
 */
export async function requireCapability(cap: Capability): Promise<MyRoles> {
  const roles = await getMyRoles();
  if (!roles || !hasCapability(roles.capabilities, cap)) redirect("/no-access");
  return roles;
}
```

- [ ] **Step 4: Swap the four existing role checks to capability checks**

`apps/web/app/(admin)/team/page.tsx` — the `if (!roles!.isOrgAdmin)` branch at ~line 43 becomes:
```tsx
  if (!hasCapability(roles!.capabilities, "manage_team")) {
```
Keep whatever that branch already renders; change only the predicate.

`apps/web/app/(admin)/organizations/page.tsx:46`:
```tsx
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();
```

`apps/web/app/(admin)/commission/page.tsx:33` and `apps/web/app/(admin)/payouts/page.tsx:60` both read `if (!roles?.isSuperAdmin) notFound();`. Apply the identical substitution to each, keeping `notFound()`:

```tsx
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) notFound();
```

**Do not** add `requireCapability` calls to the `manage_org` pages (Dashboard, Events, Registrations, Payments, Settings). Every capability that reaches the layout except `check_in` includes `manage_org`, so the layout gate plus the nav already produce today's behaviour for them; adding per-page calls there is churn without a behaviour change. If you disagree after reading them, say so rather than adding them silently.

- [ ] **Step 5: Verify the boundaries**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS, including every pre-existing team/organizations test.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/queries/roles.ts apps/web/lib/queries/roles.test.ts "apps/web/app/(admin)"
git commit -m "feat(admin): assert capabilities per route"
```

---

### Task 6: Stop offering a role that grants nothing

**Files:**
- Modify: `apps/web/lib/team-roles.ts:20`
- Modify: `apps/web/lib/team-roles.test.ts`
- Modify: `supabase/functions/_shared/team.ts:4`

**Interfaces:**
- Consumes: nothing.
- Produces: `ASSIGNABLE_ROLES` becomes `["admin", "editor", "marshal"]`.

`claiming` is assignable and invitable and appears in zero authorization checks. Assigning it today produces a colleague who lands on `/no-access` with no explanation. The **database enum value stays** — the race-kit spec needs it shortly, and dropping it would be a destructive migration for something being reinstated.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/team-roles.test.ts`:

```ts
it("does not offer a role that grants nothing", () => {
  // `claiming` ("Race Kit") has no authorization consumer until the race-kit
  // spec wires it. Offering it means an org admin can hand a colleague a role
  // that lands them on /no-access. The DB enum value stays; only the picker
  // stops listing it.
  expect(ASSIGNABLE_ROLES).not.toContain("claiming");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter web test lib/team-roles.test.ts`
Expected: FAIL — `claiming` is present.

- [ ] **Step 3: Remove it from both copies**

`apps/web/lib/team-roles.ts:20`:
```ts
export const ASSIGNABLE_ROLES = ["admin", "editor", "marshal"] as const;
```

Leave `ROLE_LABELS`' `claiming: "Race Kit"` entry in place — existing rows still need a label to render. Add a comment above `ASSIGNABLE_ROLES` recording that `claiming` returns when the race-kit spec gives it a capability.

Mirror the change in `supabase/functions/_shared/team.ts:4`, which that file's own comment says is kept in sync by hand.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS. If a test asserts the picker offers four roles, update the count — do not re-add `claiming`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/team-roles.ts apps/web/lib/team-roles.test.ts supabase/functions/_shared/team.ts
git commit -m "feat(admin): stop offering the Race Kit role until it grants something"
```

---

### Task 7: `canCheckIn` honours `event_scope`

**Files:**
- Modify: `supabase/functions/_shared/authz.ts:17-20`
- Modify: `supabase/functions/check-in/index.ts`
- Create: `supabase/functions/_shared/authz.test.ts` (if absent; otherwise append)

**Interfaces:**
- Consumes: nothing from earlier tasks — this is independent and could ship alone.
- Produces: `canCheckIn(roles: RoleRow[], orgId: string, eventId: string): boolean`.

`auth_can_check_in_event` in SQL honours `event_scope`; this TS twin does not, despite a comment at `20260806150000_checkin_rpcs.sql:10` claiming they mirror each other. A marshal scoped to event A can currently scan a runner into event B in the same org — the scan succeeds while `checkin_roster(B)` shows them nothing and `checkin_undo` refuses them with `42501`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/authz.test.ts` (root vitest already includes `supabase/**/*.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { canCheckIn } from "./authz.ts";

const row = (over: Partial<{ role: string; org_id: string; event_scope: string | null }> = {}) =>
  ({ role: "marshal", org_id: "org-1", event_scope: null, ...over }) as never;

describe("canCheckIn", () => {
  it("allows an org-wide marshal for any event in their org", () => {
    expect(canCheckIn([row()], "org-1", "event-A")).toBe(true);
  });

  it("allows an event-scoped marshal for their own event", () => {
    expect(canCheckIn([row({ event_scope: "event-A" })], "org-1", "event-A")).toBe(true);
  });

  // The bug: today this returns true, so a marshal scoped to one event can
  // check runners into another. The SQL twin has always refused it.
  it("refuses an event-scoped marshal for a different event in the same org", () => {
    expect(canCheckIn([row({ event_scope: "event-A" })], "org-1", "event-B")).toBe(false);
  });

  it("refuses any role from another org", () => {
    expect(canCheckIn([row({ org_id: "org-2" })], "org-1", "event-A")).toBe(false);
  });

  it("allows a super admin regardless of org or scope", () => {
    expect(canCheckIn([row({ role: "super_admin", org_id: "other" })], "org-1", "event-A")).toBe(true);
  });

  it("refuses a role with no check-in rights", () => {
    expect(canCheckIn([row({ role: "claiming" })], "org-1", "event-A")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run supabase/functions/_shared/authz.test.ts`
Expected: FAIL on the scoped-to-a-different-event case (and a type error on the third argument).

- [ ] **Step 3: Add the scope test**

In `supabase/functions/_shared/authz.ts`, replace `canCheckIn`:

```ts
/** Mirrors auth_can_check_in_event (20260806202000_harden_auth_helper_search_path.sql:44)
 *  including its event_scope narrowing. `eventId` is required, not optional: an
 *  optional parameter lets a future call site skip the scope check silently,
 *  where a required one is a compile error until someone decides. */
export function canCheckIn(roles: RoleRow[], orgId: string, eventId: string): boolean {
  return roles.some((r) =>
    r.role === "super_admin" ||
    (r.org_id === orgId &&
      (r.role === "marshal" || r.role === "editor" || r.role === "admin") &&
      (r.event_scope == null || r.event_scope === eventId)));
}
```

`RoleRow` is currently `{ role: string; org_id: string | null }` (`authz.ts:2`) — it does **not** carry `event_scope`. Widen it:

```ts
export type RoleRow = { role: string; org_id: string | null; event_scope?: string | null };
```

- [ ] **Step 4: Fetch the column, and pass the event at the call site**

**This step is the one that silently undoes the fix if skipped.** `supabase/functions/check-in/index.ts:33` currently reads:

```ts
const { data: roles } = await db.from("user_roles").select("role,org_id").eq("user_id", userRes.user.id);
```

`event_scope` is not selected, so it would arrive `undefined`, `r.event_scope == null` would be true for every row, and every scoped marshal would be treated as org-wide — today's behaviour, restored invisibly, with all six unit tests still green because they construct their own rows. Extend the select:

```ts
const { data: roles } = await db.from("user_roles").select("role,org_id,event_scope").eq("user_id", userRes.user.id);
```

Then pass the event. `reg` already selects `event_id` (`index.ts:29`), so no change is needed there:

```ts
if (!canCheckIn(roles ?? [], reg.org_id, reg.event_id)) { /* existing forbidden branch */ }
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run supabase/functions/_shared/authz.test.ts`
Expected: PASS, 6 tests.

Do **not** deploy the edge function as part of this task. Deployment is a separate decision for whoever ships this.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/authz.ts supabase/functions/_shared/authz.test.ts supabase/functions/check-in/index.ts
git commit -m "fix(functions): honour event_scope when checking in"
```

---

## Final verification

- [ ] **Run everything**

```bash
pnpm --filter web test && pnpm --filter web typecheck && pnpm --filter site test && pnpm vitest run supabase/functions/_shared/authz.test.ts
```

Expected: all green. The backend suite (`pnpm test`) has 33 pre-existing failures from absent seed data — unrelated to this plan and not to be fixed here.

- [ ] **Manual smoke, and it is the point of the whole plan**

Assign a test account the `marshal` role for one org, sign in, and confirm: the console opens rather than redirecting to `/no-access`; the sidebar shows Check-in and nothing else; `/check-in` loads with a roster; and typing `/payments` redirects rather than rendering an empty page.

- [ ] **Confirm nobody lost access**

Sign in as an admin and as an editor. Every destination each reached before is still reachable, and the editor still cannot reach `/team`.
