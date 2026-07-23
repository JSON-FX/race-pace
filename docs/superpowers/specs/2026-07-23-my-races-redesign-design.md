# My Races Tab Redesign (Mobile)

**Status:** Approved, ready for implementation plan
**Scope:** `apps/mobile` — the My Races tab (`app/(tabs)/races.tsx`), a new receipt route, and one Postgres RLS migration to allow cancelling an unpaid registration
**Branch:** `worktree-my-races-redesign` (isolated worktree at `.claude/worktrees/my-races-redesign`)

## 1. Goals

Restructure My Races from a single flat list (today it only forks `paid` → ticket, everything else → pay) into three clearly separated groups, all confirmed with the user:

1. **Registered** — paid entries for races that haven't happened yet.
2. **Completed** — paid entries for races that have already happened; tapping one opens a receipt showing the payment record and (deferred) check-in.
3. **Unpaid** — pending entries that still need payment, each cancellable (cancel = permanently remove).

Secondary goal, per the request: **maximize reuse of the existing `components/ui/` library** (RNR + NativeWind) rather than one-off styling.

## 2. Non-goals

- **No real check-in tracking.** There is no `check_ins` table (or any check-in column) anywhere in the schema — the ticket QR is shown at the start line but scans are not recorded. The receipt shows a "Check-in" row reading "Not recorded yet"; recording actual check-ins (a table + an organizer-side scan flow) is a separate future project. Confirmed with the user.
- **No cancel/refund of paid registrations.** Cancel applies only to `pending` rows and is a hard delete. Refunding a paid registration is a different, money-touching flow already handled admin-side by `supabase/functions/admin-refund` and is out of scope here.
- **No slot bookkeeping on cancel.** A `pending` registration never took a category slot — `increment_slot` only runs on payment confirmation (`supabase/functions/_shared/confirm.ts`). So deleting a pending registration must **not** call `decrement_slot`; there is nothing to release. (Slot release stays exclusive to the paid→refunded path in `_shared/refund.ts`.)
- **No changes to the pay or ticket screens** beyond the receipt linking into the existing `/ticket/[registrationId]` pass.
- **No new dependency** — no bottom-sheet library, no new component kit. Everything is built from primitives already in `apps/mobile/components/ui/`.
- **No surfacing of `payments.raw`** (the raw PayMongo JSON) — only the summarized, human-meaningful fields (§4.3).

## 3. Final visual design

Confirmed through the visual brainstorming session (segmented layout + pushed receipt chosen over sectioned-scroll / hybrid and over bottom-sheet / inline-expand). Mockups discarded; decisions captured here.

- **Header + segmented control:** the "My races" title with a `ToggleGroup` segmented control beneath it — three segments **Registered · Completed · Unpaid**, each showing a live count. One `FlatList` renders below for the active segment. The Unpaid count is tinted amber (warning) even when another segment is active, because it is the only group that needs action.
- **Default segment:** Registered. Heuristic exception: if Registered is empty **and** Unpaid is non-empty, open on Unpaid (the segment with something to do).
- **Race card** (shared `RaceCard`, one component for all three segments): a distance chip on the left (e.g. `21 / KM`), event name + a meta line (category · date), and a status `Badge` on the right.
  - **Registered** card → green (paid-tint) badge "Registered", taps to `/ticket/[id]`. No chevron.
  - **Completed** card → muted badge "Completed" (or blue "Refunded"), a trailing chevron to signal it drills in, taps to the new receipt route. The distance chip is de-emphasized (neutral, not green) to read as history.
  - **Unpaid** card → amber badge "Unpaid", the meta line shows the amount due, and the card carries two inline actions: a primary **Complete payment** button (→ `/pay/[id]`) and a secondary **Cancel** button. No chevron (the whole-card tap also routes to `/pay/[id]`).
- **Cancel confirmation:** the inline Cancel button only opens a `Dialog`. The dialog has a destructive-filled **"Cancel registration"** (the only control that deletes) and a **"Keep it"** safe default. Deleting cannot be undone and the copy says so.
- **Receipt screen** (pushed route): back link → "My races"; event name + category + a Completed/Refunded badge; a **Payment** group (Paid on / Method / Amount / Platform fee / Reference); a **Race day** group with the deferred **Check-in** row ("Not recorded yet"); and a "View race pass" button → `/ticket/[id]`.
- **Empty states:** per segment, with copy specific to that group (e.g. Completed: "Finished races land here with your receipt."), and a "Browse events" action where appropriate (reusing the existing empty-state pattern already in `races.tsx`).
- **Loading:** `Skeleton` card rows in the active segment (replacing today's centered spinner). Offline behavior below is preserved.

## 4. Data & grouping model

### 4.1 Grouping (pure, client-side)

A new pure module `lib/myRacesGroups.ts` exposes `groupMyRaces(rows, todayIso)` returning `{ registered, completed, unpaid }` plus counts. No Supabase, no React — plain functions over the mapped `RegistrationRow` values (so the rules below reference the camelCase mapped fields `status`, `eventDate`, `eventStatus`, not the raw DB columns), unit-testable with a pinned date.

Classification, applied in order:

| Group | Rule |
|---|---|
| Unpaid | `status === 'pending'` |
| Completed | `status === 'paid'` **and** (`eventDate < todayIso` **or** `eventStatus === 'completed'`); **also** every `status === 'refunded'` row |
| Registered | `status === 'paid'` **and** `eventDate >= todayIso` (and not already Completed) |

Excluded from all groups: `status === 'cancelled'` (cancel hard-deletes, so these should not normally exist; excluded defensively).

Edge cases (explicit):
- **`eventDate` is null** for a paid row → treat as **Registered** (we can't prove it's past). Dates compare lexically as ISO `YYYY-MM-DD` strings, so no `Date` parsing is needed for the split.
- **`pending` on a past-dated event** → stays in **Unpaid** (it is still unpaid); no special "expired" handling in this iteration.
- **`refunded`** → **Completed**, rendered with a blue "Refunded" badge, still tappable to its receipt.
- Because the Registered/Completed split depends on *today*, all tests that exercise it **must pin the system clock** — the same requirement the `marketplace-search` suite already handles (see §7).

### 4.2 Ordering

Within each group, preserve the existing `fetchMyRegistrations` order (`created_at desc`). Completed may additionally be presented most-recent-first by event date — decided in the plan; not load-bearing.

### 4.3 Query expansion (`lib/registration.ts`)

`REG_SELECT` today embeds only `payments(checkout_url)`. Expand that embed to also pull the receipt fields, and surface them on `RegistrationRow` as a nested `payment` object:

```
payments(checkout_url, created_at, method, amount, platform_fee, net_to_org, provider, provider_ref, status)
```

- `RegistrationRow` gains `payment: { createdAt, method, amount, platformFee, netToOrg, provider, providerRef, status } | null` (mapped in `mapReg`, still taking `payments[0]`).
- This one change feeds **both** the grouping/list (which needs nothing new beyond what it has) and the receipt screen (which needs all of it). `useMyRegistrations` and `useRegistration` are otherwise unchanged; the receipt reuses `useRegistration(rid)`.
- All fields already exist on the `payments` table (`supabase/migrations/20260718183018_registrations_payments.sql`): `provider`, `provider_ref`, `method`, `amount`, `platform_fee`, `net_to_org`, `status`, `created_at`. `payments.read_own` RLS already lets the owner read them.
- **Reference** on the receipt renders `provider_ref` when present, else the existing `registrationId.slice(0,8).toUpperCase()` fallback used elsewhere.
- **Method** renders via a new `paymentMethodLabel(method)` helper in `lib/format.ts` mapping `card → "Card"`, `gcash → "GCash"`, `maya → "Maya"` (fallback: the raw value or "—").
- **Amount / Platform fee** render via the existing `formatPeso` from `@race-pace/shared`.
- **Paid on** renders `payments.created_at` via the existing `longDate` (date-only) formatter.

### 4.4 Offline cache

The existing `ticketCache` (`cacheMyRaces` / `getCachedMyRaces`) fallback in `races.tsx` is preserved so the list still renders offline. Cached rows carry only `status` (no `event_date`), so when rendering purely from cache the split degrades gracefully: cached `paid` rows show under Registered, cached `pending` under Unpaid, and Completed may be empty until the live query returns. This matches today's already-limited offline fidelity and is acceptable.

## 5. Component architecture

| Component | File | Notes |
|---|---|---|
| `MyRaces` screen | `app/(tabs)/races.tsx` (rewrite) | Holds the active-segment state, runs `groupMyRaces`, renders the `ToggleGroup` + the active segment's `FlatList`. Keeps `useMyRegistrations`, `useGlobalRefresh` pull-to-refresh, the `ticketCache` fallback, and the existing empty/error patterns. |
| `lib/myRacesGroups.ts` | new, pure | `groupMyRaces(rows, todayIso)` → `{ registered, completed, unpaid, counts }`. No Supabase/React. The bulk of the real logic and the easiest to test thoroughly. |
| `RaceCard` | `components/RaceCard.tsx` (new) | One card, a `variant` prop (`registered` / `completed` / `unpaid`) driving badge, chevron, and the Unpaid action row. Built on `Card`, `Badge`, `Button`, `Text`, `Icon`. Used by all three segments. |
| Receipt screen | `app/registration/[registrationId].tsx` (new) | Pushed detail. Reuses `useRegistration(rid)`, renders the Payment group, the Race-day/Check-in row, and "View race pass" → `/ticket/[id]`. Mirrors the layout/navigation pattern of the existing `app/ticket/[registrationId].tsx`. |
| `lib/registration.ts` | updated | `REG_SELECT` gains the payment fields (§4.3); `RegistrationRow` gains `payment`; new `cancelRegistration(rid)` (§6). |
| `lib/format.ts` | updated | new `paymentMethodLabel(method)` helper. |
| `components/ui/badge.tsx` | updated | add two variants: `unpaid` (`bg-amber-tint` / `text-amber`) and `refunded` (`bg-info-tint` / `text-info`). Registered reuses the existing `paid` variant (green) with a "Registered" label; Completed reuses the existing `completed` variant (muted). |
| Migration | `supabase/migrations/20260723120000_registrations_cancel_own_pending.sql` (new) | RLS delete policy + grant (§6). Timestamp only needs to sort after `20260722154132`. |

### Reusable component library usage (maximized per the request)

- `ToggleGroup` / `ToggleGroupItem` — the segment control (its first real use in the app alongside the marketplace redesign's date segment).
- `Card` — the `RaceCard` shell and the receipt's grouped panels.
- `Badge` — status pills across all segments, using existing `paid`/`completed` variants plus the two new `unpaid`/`refunded` variants, keeping status styling centralized in the library.
- `Button` — the Unpaid card's "Complete payment" / "Cancel" actions and the receipt's "View race pass".
- `Dialog` — the cancel confirmation (reused as-is, centered; no bottom-sheet dependency).
- `Skeleton` — loading rows.
- `Separator` — row dividers in the receipt panels (or hairline borders matching the existing ticket screen's `Info` tiles).
- `Text`, `Icon` — throughout, unchanged.

## 6. Cancel flow (delete an unpaid registration)

**Backend (one migration).** Users currently have only `select` on `registrations` (`registrations_read_own`) and no `delete` grant. Add a narrowly-scoped delete path:

```sql
-- 20260723120000_registrations_cancel_own_pending.sql
grant delete on registrations to authenticated;
create policy "registrations_delete_own_pending" on registrations
  for delete using (auth.uid() = user_id and status = 'pending');
```

- The `status = 'pending'` predicate in the policy makes it impossible to delete a `paid`/`refunded`/`cancelled` row through this path, even though the grant is table-wide — RLS is the gate.
- Deleting the registration **cascades** to its dependent rows: `payments` and `registration_addons` both declare `on delete cascade` on `registration_id`, so the pending payment and any addons are removed automatically by the database (cascades are not themselves subject to the caller's RLS).
- No slot math (see §2 non-goals) — pending never incremented a slot.

**Frontend.** `lib/registration.ts` adds:

```
export async function cancelRegistration(rid: string): Promise<void>
```

which runs `supabase.from('registrations').delete().eq('id', rid)` and throws on error. In `races.tsx`, the Unpaid card's Cancel opens the `Dialog`; confirming calls `cancelRegistration`, then invalidates the `['my-registrations']` query (and best-effort prunes the row from `ticketCache`) so the card disappears. Errors surface inline in the dialog ("Couldn't cancel. Try again.") without closing it.

## 7. Error handling & empty states

- **Query error:** preserve the existing `isError` → tap-to-retry pattern from today's `races.tsx`.
- **Empty per segment:** each segment renders its own empty copy (Registered / Completed / Unpaid), reusing the existing empty-state visual (icon bubble + title + subtitle + optional "Browse events" CTA to `/(tabs)/events`).
- **Cancel failure:** dialog stays open, inline error, registration remains.
- **Offline:** cache fallback renders what it can (§4.4); pull-to-refresh re-attempts the live query.

## 8. Testing

Extend existing coverage; pin the clock wherever the date split is involved.

- **New — `__tests__/my-races-groups.test.ts`:** pure unit tests for `groupMyRaces` against a fixed `todayIso` — registered vs completed split by date, `eventStatus='completed'` forcing Completed, refunded → Completed, null `event_date` → Registered, cancelled excluded, and the counts. No mocking.
- **Update — `__tests__/my-races.test.tsx`:** segment switching + counts, default-segment heuristic, Registered→`/ticket`, Completed→`/registration`, Unpaid→`/pay`, and the cancel path (open dialog → confirm → `cancelRegistration` called → row gone), plus a per-segment empty state. Uses Jest fake timers / `setSystemTime` to pin "today" (the `marketplace-search` suite is the reference for this project's fixed-time setup).
- **New — receipt screen test:** renders the payment fields from a mocked `useRegistration`, shows the "Not recorded yet" check-in row, and "View race pass" routes to `/ticket/[id]`.
- **Cancel unit:** `cancelRegistration` issues the expected `delete().eq('id', rid)` against the mocked Supabase client and propagates errors.

## 9. Rollout

Single branch, no feature flag — implemented directly in the isolated worktree (`worktree-my-races-redesign`) and merged when ready, consistent with this project's solo-dev / speed-to-MVP workflow. The migration ships with the branch and is applied to the hosted Supabase project (ref `ytwdrsmclwghwktpupqd`) as part of the merge.
