# Admin console SSR performance

**Date:** 2026-08-08
**Scope:** `apps/web` (admin console), with two config changes touching `apps/site`
**Status:** Approved, ready for planning

## Problem

Every navigation in the admin console takes 2–5 seconds. Clicking a page in the
sidebar, changing the event dropdown, paging a table, or opening a registration
modal all stall. Dropdown and modal interactions show no loading state at all —
the page simply freezes until the server responds.

## Measurements

All figures below were measured on 2026-08-08, not estimated.

### Server render time (dev server log, already-compiled routes)

```
✓ Compiled /registrations in 761ms
GET /registrations                200 in 4550ms
GET /registrations?page=2         200 in 3449ms
GET /registrations?reg=…001344    200 in 3303ms
```

Compilation accounts for ~760ms. The remaining ~3.5s is the server render
itself, so this is not a `next dev` artifact.

### Production (Vercel)

```
x-vercel-id: sin1::iad1::…      enters Singapore edge, EXECUTES in iad1 (Washington DC)
x-vercel-cache: MISS            every request; nothing cached
```

Public site TTFB (no auth chain, real Supabase reads): **2.77s, 1.87s, 1.88s**.

### Network latency from the dev machine (Philippines)

TCP connect, direct to AWS, best of three:

| Region | Connect |
|---|---|
| `ap-northeast-1` (Tokyo) | **82ms** |
| `ap-southeast-1` (Singapore) | 67ms |
| `us-east-1` (N. Virginia) | 230ms |

### Supabase per-call cost

| Call | TTFB |
|---|---|
| `/auth/v1/health` (gateway, no Postgres) | 225–478ms |
| `/rest/v1/organizations?select=id&limit=1` | 327–587ms |

Delta of ~100ms is Postgres + PostgREST. The rest is network and gateway
overhead from the Philippines to Tokyo.

### Environment

- Supabase project `whaqarofxdlzxrelbcrq`, region **ap-northeast-1 (Tokyo)**,
  compute **t3.nano** (0.5 GB RAM, burstable CPU credits).
- Vercel functions default to **`iad1`** — the wrong side of the Pacific from
  the database.

## Root cause

A `/registrations` render issues **~15 Supabase round trips in a chain 8 deep**.
Latency scales with round-trip count, not data size, so the page will feel this
slow regardless of how few registrations an org has.

```
middleware   getUser ─────────────────────────────────┐
layout       getUser ─ getMyRoles(getUser→user_roles) ─┤
                     └ getOrgContext(getUser→user_roles→organizations)
                       └ getOrg ─ [eventCount ‖ regCount]
page         listOrgEventOptions ─ listEventRegistrations ─ emailsRPC
                                  ‖ categories ‖ aggregates ‖ orgPending
```

Cost per round trip: ~225ms in local dev (PH → Tokyo), ~160ms in production
(iad1 ⇄ Tokyo). Eight sequential trips explains the observed 2–3.5s almost
exactly.

Separately, **`loading.tsx` never fires for these interactions**. Next.js shows
it only when the route *segment* changes. The event dropdown, pagination, and
the row modal all navigate to the same route with different `searchParams`, so
the page freezes with no feedback.

## Design

Five sections. Sections 1, 2, 3 and 5 are independent and each ships and
measures on its own. Section 4 must follow Section 1 so profiling runs against
the real instance.

---

### Section 1 — Infrastructure

**Pin Vercel functions to `hnd1` (Tokyo).** Add to `apps/web/vercel.json` and
`apps/site/vercel.json`:

```json
{ "$schema": "https://openapi.vercel.sh/vercel.json", "regions": ["hnd1"] }
```

Rationale: a render makes one user→server round trip but *many* server→DB round
trips. Optimize the multiplied leg.

| Placement | user→function | function→DB (×8) | ≈ total |
|---|---|---|---|
| `iad1` (current) | 230ms | ~160ms | ~1.5s+ |
| **`hnd1`** | 82ms | ~2ms | **~100ms** |
| `sin1` | 67ms | ~70ms | ~630ms |

`sin1` is closer to users but worse overall — it reintroduces a network hop on
the leg that repeats eight times.

Verified against Vercel docs: the Hobby plan permits a single non-default
region, so this works on the current plan.

**Do not move the Supabase project.** Relocating Tokyo → Singapore buys 15ms
(82ms → 67ms) in exchange for a full project migration, one that was already
performed on 2026-08-05.

**Upgrade compute Nano → Small** (~$15/mo), applied *after* the region pin so
each lever's contribution is attributable.

| Tier | RAM | CPU | $/mo | Note |
|---|---|---|---|---|
| Nano (current) | 0.5 GB | burstable | $0 | `shared_buffers` ~128MB; joined-view counts spill |
| Micro | 1 GB | burstable | ~$10 | |
| **Small** | **2 GB** | burstable | **~$15** | 4× Nano's RAM for $5 over Micro |
| Medium | 4 GB | burstable | ~$60 | 4× price for 2× RAM; unjustified at this scale |
| Large | 8 GB | **dedicated** | ~$110 | First tier that cannot exhaust CPU credits |

Small remains burstable, so credit exhaustion is still possible under sustained
load. Current workload is bursty admin browsing. Race-day registration surges
are the sustained case — if throttling appears then, Large is the first tier
that structurally cannot throttle. Do not pre-buy it.

This section's compute change is the least certain lever in the spec. Gateway
overhead could not be cleanly separated from Postgres time by external
measurement. Sections 1 (region) and 3 are certain wins; the upgrade is a
well-founded hypothesis to be verified after the fact.

---

### Section 2 — Auth: stop validating the same JWT five times

One `/registrations` request makes five network calls to GoTrue to validate a
single identical JWT:

| Call site | Note |
|---|---|
| `lib/supabase/middleware.ts:31` | runs at the **edge** — region pinning cannot reach it |
| `app/(admin)/layout.tsx:12` | |
| `lib/queries/roles.ts:20` | inside `getMyRoles` |
| `lib/org-context.ts:36` | inside `getOrgContext` |

Vercel deploys Routing Middleware to all regions regardless of the `regions`
setting, so the middleware call crosses to Tokyo from the user's nearest edge
even after Section 1. Only this section fixes it.

**Change:** migrate the Supabase project to asymmetric JWT signing keys, then
replace `getUser()` with `getClaims()` for read paths. With asymmetric keys,
verification is a local signature check against a cached public key — zero
network calls. Supabase's signing-keys guide states plainly: *"If using
asymmetric signing key, JWT validation is fast and does not involve Auth
server."*

Wrap the remaining session read in React `cache()` so it resolves once per
request rather than once per call site.

**Decision taken: hybrid.**

`getClaims()` is cryptographically sound — it verifies the signature against the
public key. It is **not** the unsafe `getSession()` that existing code comments
correctly warn against. The genuine difference from `getUser()`:

- `getUser()` asks the auth server, so a revoked session dies instantly.
- `getClaims()` trusts a validly-signed token until it expires — a revoked
  session can stay usable for up to the JWT expiry (default 1 hour).

Therefore:

- **`getClaims()`** in middleware and all page renders.
- **Authoritative `getUser()`** retained inside money-moving Server Actions —
  refunds (`refundRegistrationAction`), cancellations. These already require a
  user confirmation, so one network call is immaterial there.

**Migration risks to handle** (from Supabase's signing-keys guide):

- Any code verifying JWTs directly with `jose`/`jsonwebtoken` against the legacy
  secret breaks on rotation. Audit before rotating.
- Edge Functions with "Verify JWT" enabled must have it disabled before
  rotation.
- The JWKS discovery endpoint caches ~10 minutes at the edge plus up to ~10
  minutes client-side, so newly rotated keys have a brief distrust window.
- Rotation requires waiting out token expiry (≥1h15m at 1-hour expiry) before
  revoking the legacy secret.

---

### Section 3 — Collapse the request waterfall

Four independent defects.

**`getOrgContext()` runs for every user.** `app/(admin)/layout.tsx:28` calls it
unconditionally, but `canSwitch = isSuperAdmin && availableOrgs.length > 1`. For
an org admin the switcher renders nothing, so three round trips (`getUser`,
`user_roles`, `organizations`) buy nothing. Gate on `roles.isSuperAdmin`.

**`user_roles` is fetched twice per request** — once in `getMyRoles`, once in
`getOrgContext`. Fetch once and share.

**The emails RPC is needlessly sequential.** `lib/queries/registrations.ts:130`
awaits rows, then awaits `getEventRegistrationEmails`. That RPC takes
`p_event_id` and does not depend on the rows. Move it into the parallel burst.

**Stable data is re-fetched on every render.** `getOrg`, the sidebar nav counts,
and `listOrgEventOptions` change rarely. Wrap in `unstable_cache` keyed by
`orgId` with tags, revalidated on the relevant mutations.

> Cache keys must be scoped by `orgId` only, never by user. Do not cache
> anything whose result varies per-user within an org, or RLS-scoped data will
> leak across users.

**Target shape:**

```
layout       getClaims (local, 0 network) ─ [roles+orgCtx ‖ cached org/counts]
page         [table ‖ emails ‖ categories ‖ aggregates ‖ counts]   ← one parallel burst
```

**~15 round trips → ~6. Chain depth 8 → 2.**

---

### Section 4 — Database

**Measure `count: "exact"` before changing it, then use `estimated` — not
`planned`.**

`lib/queries/registrations.ts:98` and `lib/queries/payments.ts:52` force
Postgres to materialize every matching row of a 4-way-join view under
`security_invoker` RLS, solely to render a result total.

A naive switch to `count: "planned"` would be a **bug, not an optimization**.
`components/data-table/pagination.tsx` derives page count from `total`. A raw
planner estimate on ~5,900 rows could report 6,100, producing phantom pages that
render empty and a "Next" button that leads nowhere.

Use PostgREST's **`estimated`** strategy instead: it returns an exact count when
the planner estimate falls below a configured threshold, and only falls back to
the estimate above it. At current scale (~5,900 registrations) this stays exact,
so pagination is unaffected today; it degrades gracefully rather than
catastrophically once an org's data outgrows a cheap count.

This means the change buys little at present scale. **Measure first**: time the
list query with and without `count` against the Small instance. If exact
counting is not a material share of query time, leave it alone and note the
finding — `estimated` is then a scale-protection change, not a performance one,
and should be sequenced accordingly.

Exact counts are retained unconditionally where correctness depends on them: the
CSV export routes, whose batch paging arithmetic requires a true total.

> If `estimated` ever does fall back to an estimate on a list screen, the
> pagination control must not present estimated totals as exact. Either source
> the true total from the KPI aggregates RPC (which already computes it) or
> render the count as approximate. This is a prerequisite of the change, not a
> follow-up.

**Fix `admin_event_reg_counts_v`.** It runs `count(*) … group by org_id,
event_id` across the entire registrations table with no org filter pushed down,
and executes on every Registrations *and* Payments render — to display `(42)`
beside event names in a dropdown. Filter by `org_id` within the view, or cache
it per Section 3. It is decoration, not primary content.

**Merge the two org-count queries.** `getOrgRegistrationCount` and
`getOrgPendingRegistrationCount` are two separate `count(*)` scans over the same
view feeding one subtitle line. Replace with a single RPC returning both.

**Then profile.** Run `EXPLAIN ANALYZE` against the real Small instance and add
indexes only where the plan proves them necessary. No speculative indexing.

---

### Section 5 — Perceived performance

Independent of every section above; addresses the original complaint directly.

**Keyed Suspense boundaries.** `loading.tsx` fires only on route-segment change,
which is why dropdown, pagination and modal interactions show nothing. Keying a
Suspense boundary on the serialized table params forces it to re-suspend
whenever those params change:

```tsx
<Suspense key={paramsKey} fallback={<DataTableSkeleton />}>
  <RegistrationsTableSection … />
</Suspense>
```

The page shell and KPI row paint immediately; the table streams in behind the
skeleton.

**Give `EventPicker` a pending state.**
`app/(admin)/registrations/event-picker.tsx:20` calls `router.push` bare, with
no transition and no pending indicator — the literal dead click reported. Wrap
in `useTransition` and show a spinner. Apply the same to
`app/(admin)/payments/event-picker.tsx`.

Note `lib/use-table-params.ts` already does this correctly (`useTransition` +
`isPending` dimming the table to `opacity-60`); the pickers are the gap.

**Make the registration modal instant.** `components/RegistrationDetail.tsx`
renders entirely from the `row` object already present in `rows` on the client,
yet opening it costs a full ~3.3s server round trip for zero new data. Open from
client state immediately and sync `?reg=<id>` into the URL in a background
transition.

Bookmarkable/shareable `?reg=` URLs are preserved — the URL still updates, and a
cold load of that URL still resolves server-side. Only the *open* interaction
stops waiting on the server. This is the single largest felt improvement in the
spec.

**Prefetch sidebar navigation** so the next route is warm before the click.

---

## Expected outcome

| Metric | Now | After |
|---|---|---|
| Production page render | ~2–3s | ~50–150ms |
| Local dev page render | ~3.5s | ~700ms |
| Time to first visible content | 2–3s | ~instant (streamed shell) |
| Open a registration modal | 3.3s | 0ms |
| Round trips / chain depth | ~15 / 8 | ~6 / 2 |

## Verification

Each section is measured independently, in order, so every lever's contribution
is attributable rather than guessed:

1. **Baseline** — record `x-vercel-id`, TTFB (best of 5) on `/registrations`,
   and the dev-server `GET … in Nms` line.
2. **After Section 1 region pin** — confirm `x-vercel-id` shows `hnd1`; re-measure
   production TTFB.
3. **After Section 1 compute upgrade** — re-measure. This is the step that
   confirms or refutes the Nano hypothesis.
4. **After Section 2** — count GoTrue calls per request; expect zero on read paths.
5. **After Section 3** — count Supabase round trips per render; expect ~6, depth ~2.
6. **After Section 4** — `EXPLAIN ANALYZE` on the list queries before and after.
7. **After Section 5** — confirm a skeleton appears on event-dropdown change,
   pagination, and that the modal opens with no network wait.

Existing test suites (`vitest`, Playwright e2e) must pass unchanged throughout.
Section 2 and Section 4 alter behaviour that tests assert on (auth call shape,
exact counts) — those tests are updated deliberately, not deleted.

## Out of scope

- Moving the Supabase project to another region (15ms gain, migration cost).
- Upgrading to Large compute (revisit only if throttling is observed).
- Replacing SSR with client-side fetching via React Query. The dependency exists
  but this would not reduce round-trip count, and would forfeit SSR.
- The `apps/site` runner web app beyond its `vercel.json` region pin.
- Node 20 → 22 upgrade, despite the `@supabase/supabase-js` deprecation warning
  in the dev log. Unrelated to latency; track separately.
