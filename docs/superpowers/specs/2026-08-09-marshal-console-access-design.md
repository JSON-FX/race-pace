# Marshal console access

Date: 2026-08-09
Status: approved, ready for planning

This is the first of three specs split out of the race-kit-release work:

1. **Marshal console access** (this document)
2. Bib number assignment
3. Race kit release

It is sequenced first because it is a bug fix, not a feature: the check-in
station that already shipped cannot be opened by the role it was built for.
It has value on its own even if the other two never ship.

## Problem

`/check-in` is built for marshals throughout. `auth_can_check_in_event`
(`supabase/migrations/20260806202000_harden_auth_helper_search_path.sql:44`)
explicitly allows `marshal`. The page's own header comment says it is deliberately
not gated on `requireOrgId` "because `auth_can_check_in_event` honours a marshal's
per-event scope". It sits in the mobile bottom bar
(`apps/web/lib/nav-items.ts:70`) with a comment calling it "the one page used
outdoors and one-handed at a start line".

A marshal cannot open it.

`apps/web/app/(admin)/layout.tsx:18-19` redirects anyone without `roles.isAdmin`
to `/no-access`, and `isAdmin` is computed in `apps/web/lib/queries/roles.ts:68,87`
from a `resolvedRow` that only ever matches `admin` or `editor`. A marshal-only
account gets `isAdmin: false` and never renders the console.

There is a second, quieter half. `orgId` resolves as
`resolvedRow?.org_id ?? orgCtx?.activeOrgId ?? null` (`roles.ts:85`). Because
`resolvedRow` skips marshals, a marshal admitted past the gate today would arrive
with `orgId: null` and every org-scoped page would render `<NoOrgScope />` —
indistinguishable from an org with no data. Widening the gate alone does not
produce a working console.

Nothing in the application has ever exercised the `marshal` branch of
`auth_can_check_in_event`.

## Scope

In scope:

1. A capability model replacing the `isAdmin` boolean, resolving `orgId` for every
   role that has one.
2. Server-side capability assertion on every `(admin)` route, with the nav derived
   from the same source.
3. Marshal access to `/check-in`, which already contains the searchable roster.
4. `canCheckIn()` in the check-in edge function honouring `event_scope`, which every
   SQL counterpart already does.
5. Hiding the `claiming` ("Race Kit") role from the assignable list until spec #3
   gives it a capability.

Out of scope, deliberately:

- Bib numbers and kit release. Specs #2 and #3.
- Any new marshal page. `/check-in` already renders a searchable, category-filtered
  roster split pending/done; that is the "read-only roster" requirement, already built.
- Mobile. `apps/mobile` has no marshal surface and gains none here.
- The `ticket_token` exposure described under Known issues below.
- Offline support. Every scan is a live round trip today and remains so.

## Capability model

`getMyRoles()` in `apps/web/lib/queries/roles.ts` stops answering "is this person an
admin" and starts answering what they may do.

```ts
type Capability = "manage_platform" | "manage_org" | "check_in";
// spec #3 adds "release_kits"

type MyAccess = {
  isSuperAdmin: boolean;
  orgId: string | null;        // the org whose console they are in
  capabilities: Set<Capability>;
  eventScope: string | null;   // null = every event in the org
};
```

Three tiers, because the console already has three. `manage_platform` covers the
pages that show **every** org's data — Organizations, Commission, Payouts — which
`apps/web/app/(admin)/organizations/page.tsx` documents as a deliberate scope band,
warning that reading a platform total as an org total "is how someone pays an
organizer the whole platform's takings". Those are not `manage_org` pages and must
not collapse into it.

| Role | Capabilities | `orgId` source |
| --- | --- | --- |
| `super_admin` | `manage_platform`, `manage_org`, `check_in` | the org switcher |
| `admin` | `manage_org`, `check_in` | their `user_roles` row |
| `editor` | `manage_org`, `check_in` | their `user_roles` row |
| `marshal` | `check_in` | their `user_roles` row |
| `claiming` | none until spec #3 | — |

`orgId` resolves from whichever role row the user actually holds, not from a list
that skips marshals. This is the fix for the second half of the problem.

**One account per org.** The org switcher is super-admin-only today —
`roles.ts:79` reads `const orgCtx = isSuperAdmin ? await getOrgContext() : null`,
and commit `4cef1d0` ("gate org switching on super_admin, one account per org")
made that the product model. So a non-super-admin has exactly one org and
`orgId` comes from their single role row.

That model is not enforced by a database constraint, so the resolution must still
be deterministic if a user somehow holds rows in more than one org: pick one org,
then compute capabilities **for that org alone**. Never union across orgs — a
union would grant someone org A's management screens because of a role they hold
in org B. Today's code already picks deterministically (`admin` before `editor`);
extend that order with `marshal` last, so a marshal-only user resolves to their
marshal row rather than to nothing.

`eventScope` carries the `user_roles.event_scope` value for the resolved org so the
UI can reflect what the RPCs already enforce.

## Route enforcement

The layout gate becomes "has any capability at all":

```ts
// apps/web/app/(admin)/layout.tsx
const access = await getMyAccess();
if (access.capabilities.size === 0) redirect("/no-access");
```

Each route then asserts its own requirement in its server component:

```tsx
// apps/web/app/(admin)/payments/page.tsx
await requireCapability("manage_org");
```

`requireCapability` redirects to `/no-access` when the capability is absent. A
marshal typing `/payments` is redirected by the server before anything renders.

`apps/web/lib/nav-items.ts` gains `requires: Capability` per item, and the nav
filters on the same set the gate reads. One list drives both, so the nav cannot
drift from the enforcement. Hiding a link is a convenience; the server assertion is
the control.

| Capability | Routes |
| --- | --- |
| `manage_platform` | organizations, commission, payouts |
| `manage_org` | dashboard, events, events/new, events/[id]/edit, registrations, payments, team, settings |
| `check_in` | check-in |

The `manage_platform` rows preserve today's gating rather than changing it — the
implementation must read each of those three pages and carry over whatever check it
already performs, rather than trusting this table. Getting one of them wrong in the
loosening direction exposes platform-wide financial data to an org admin.

A user whose only capability is `check_in` lands on `/check-in` rather than the
dashboard.

## The `event_scope` fix

`supabase/functions/_shared/authz.ts:17` cannot honour scope, because it never
receives an event:

```ts
export function canCheckIn(roles: RoleRow[], orgId: string): boolean {
  return roles.some((r) => r.role === "super_admin" ||
    (r.org_id === orgId && (r.role === "marshal" || r.role === "editor" || r.role === "admin")));
}
```

It gains a **required** `eventId` parameter and the scope test its SQL twin
`auth_can_check_in_event` already applies. `supabase/functions/check-in/index.ts`
passes the registration's `event_id`.

Required rather than optional: an optional parameter lets a future call site skip
the check silently, while a required one is a compile error until someone decides.
There is exactly one call site today.

Consequence: a marshal scoped to event A can no longer check a runner into event B
in the same org. Today the scan succeeds while `checkin_roster(B)` shows them
nothing and `checkin_undo` refuses them with `42501` — three components, two
answers. The comment at `20260806150000_checkin_rpcs.sql:10` already claims the TS
and SQL versions mirror each other; this makes that true.

## The `claiming` role

`claiming` is assignable and invitable (`apps/web/lib/team-roles.ts:20`, labelled
"Race Kit") and appears in **zero** authorization checks in either SQL or
TypeScript. Assigning it today produces a colleague who lands on `/no-access` with
no explanation.

Remove it from `ASSIGNABLE_ROLES` until spec #3 gives it `release_kits`. The enum
value stays in the database — dropping it would be a destructive migration for a
value spec #3 needs shortly.

## Error handling

A user with no capabilities goes to `/no-access`, unchanged.

A user with capabilities reaching a route they lack goes to `/no-access` too —
**not** an empty page. The current failure, where `orgId` is null and the page
renders `<NoOrgScope />`, reads as "this org has no data" rather than "you cannot
be here", and that ambiguity is most of why this bug survived.

## Testing

The negative cases carry the weight.

Capability resolution, per role: assert the capability set **and** the resolved
`orgId`. A marshal must return `check_in` and a non-null org — a test asserting
only the capability set would pass against the current bug.

Cross-org: a user holding rows in two orgs resolves to one org and gets that org's
capabilities alone, never the union. This is the case most likely to be got wrong,
and the one with the worst failure mode.

Route enforcement: a marshal is redirected from a `manage_org` route; an org admin
is redirected from a `manage_platform` route; an admin and an editor reach every
route they reach today, proving this is not a regression. That last set is the
regression guard for the whole spec — this change touches the gate on every console
page, so "nobody lost access" needs asserting, not assuming.

Nav: the rendered items equal exactly those whose `requires` the user holds.

`event_scope`: a marshal scoped to event A is refused when scanning a registration
belonging to event B in the same org, and accepted for one belonging to A. This
test fails against current code, which is the point of writing it.

## Known issues, recorded not fixed

**`checkin_roster` returns every runner's `ticket_token`.** That token is the
race-day entry credential; it never expires, has no revocation, and is replayable —
the only barrier to reuse is the `UNIQUE(registration_id)` constraint on `checkins`
(`20260723090200_checkins_table.sql:6`). It is in the roster payload because the
manual check-in button re-submits it (`apps/web/app/(admin)/check-in/scanner.tsx:246`).

This predates this spec and is not introduced by it, but this spec widens who holds
those tokens, which is the reason to write it down. The fix is a definer RPC that
checks in by `registration_id`, letting `checkin_roster` drop the column.

**`TICKET_SIGNING_SECRET` falls back to `"dev-secret"`** when unset
(`supabase/functions/_shared/ticket.ts`). An unset secret in production mints
tickets verifiable under a publicly-known key.

**No offline capability anywhere in `apps/web`.** Every scan is a live round trip;
a lost connection fails every scan with a generic message and nothing is buffered.
Kit pickup — spec #3 — happens in exactly the kind of venue where this bites.

## Migration order

None. This spec changes no schema. It touches `apps/web` application code and one
edge function.
