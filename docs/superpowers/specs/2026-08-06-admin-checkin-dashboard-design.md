# Admin Console — Race-Day Check-in & Dashboard

**Status:** Approved, ready for implementation plan
**Scope:** `apps/web` (admin console) — two of the five `<Placeholder>` routes, plus **two Supabase migrations** (two security-definer RPCs, two security-invoker views). **No `apps/mobile` changes. No Edge Function changes.**
**Branch:** worktree off `main` — one branch, one PR, sequential green commits (§10)

## 1. Goals

Turn `/check-in` and `/dashboard` from stubs into working features.

1. **Check-in works on race morning**, from a phone camera or a hardware QR scanner, by a marshal or an admin, with or without signal.
2. **Marshals can actually reach it.** Today they cannot — see §3. Closing that gap is part of this scope, not a follow-up.
3. **No offline check-in disappears silently.** A scan accepted offline and later rejected by the server surfaces to a human.
4. **The Dashboard answers "how are we doing"** — registrations, revenue, recent signups, per-event breakdown — from data that already exists.

## 2. Non-goals

- **Organizations, Commission, and Payouts stay `<Placeholder>` stubs.** Payouts in particular has no schema at all and moves real money; it gets its own spec.
- **No period-close or commission rollup.** `payments.platform_fee` and `payments.net_to_org` already exist per-payment, so a read-only commission report is nearly free — but it is out of scope here.
- **No service worker, no PWA, no IndexedDB.** See §5.1.
- **No changes to the `check-in` Edge Function or its ticket format.** It is correct and tested; this spec builds a client for it.
- **No new form library or state pattern.** Follows `EventEditor.tsx` / `CategoryEditor.tsx`.
- **No charts.** With zero registrations in the hosted DB, a trend line renders an empty box that reads as breakage.

## 3. Starting state

### What exists

| Piece | State |
|---|---|
| `check-in` Edge Function | Complete. Verifies the HMAC ticket, checks `status = 'paid'`, authorizes via `canCheckIn()`, inserts one `checkins` row. |
| `apps/web/src/lib/checkin.ts` | `bannerFor`, `wrongEventBanner`, `decodeTicketEventId`, `useSubmitCheckIn` — written and tested. `useCheckInEvents` / `useCheckInRoster` / `useCheckInCount` exist but query tables directly. |
| `checkins` table | `unique (registration_id)` — which is what makes replay idempotent. |
| `admin_registrations_v`, `admin_payments_v`, `admin_event_reg_counts_v` | Flattened `security_invoker` read models from `20260804120000_admin_list_views.sql`. |
| `payments.platform_fee`, `payments.net_to_org` | Integer centavos, populated per payment. |
| shadcn primitives | `card`, `table`, `badge`, `skeleton`, `input`, `select`, `sheet`, `sonner`, `button`, `dialog` — everything both routes need. |

### The marshal gap

`canCheckIn()` in `supabase/functions/_shared/authz.ts` permits `marshal | editor | admin | super_admin`. The web app and the database do not agree with it, at three layers:

1. **Route gate.** `RequireAdmin` in `App.tsx` requires `isAdmin`, which `useMyRoles()` computes as `super_admin | admin | editor`. A marshal signing in is redirected to `/no-access`.
2. **RLS.** `auth_can_admin_org(target)` is `super_admin OR (org_id = target AND role IN ('editor','admin'))`. **Marshal is excluded.** So `registrations_read_org_admin`, `profiles_read_org_admin`, `events_read_org_admin`, and `categories_read_org_admin` all deny a marshal. The roster query returns zero rows.
3. **`checkins` read policy** keys on the same helper, so no progress count either.

The Edge Function was built for marshals; the data layer never was. Because the offline design depends on pre-downloading the roster, this is not cosmetic — without it a marshal has no offline path at all.

### Current data

One organization (Race Pace), one event (Apo Sky Ultra 2026), **zero registrations, payments, and check-ins**. `supabase/seed.sql` restores five orgs and five events. Note `db push` does **not** run `seed.sql` against a linked remote.

## 4. Authorization — two RPCs, no new table grants

One migration adds two `security definer` functions. They bypass RLS, so each authorizes internally against `user_roles`, honouring both `org_id` and the existing (currently unused) `event_scope` narrowing.

### Why RPCs and not RLS policies

Adding `auth_can_check_in_org()` plus additive SELECT policies would be fewer moving parts, but **RLS is row-level, not column-level**: a marshal granted SELECT on `registrations` reads `total_amount` and `custom_data` too. An RPC returns exactly the roster fields and nothing else, and confines the privilege expansion to one function instead of widening policy surface on the money tables.

### `checkin_events()`

Returns the events the caller may scan for — `{id, name, event_date, end_date}`. Unblocks the event picker for marshals.

Scoping, in order: a `super_admin` (whose `user_roles.org_id` is `NULL`) sees every org's events; anyone else sees events belonging to an org where they hold `marshal | editor | admin`. If **any** of the caller's qualifying role rows carries an `event_scope`, that row contributes only that one event — it narrows that row, it does not narrow the others. A user holding both an unscoped `admin` row and an event-scoped `marshal` row therefore still sees the whole org.

### `checkin_roster(p_event_id uuid)`

Returns one row per registration:

```
registration_id, ticket_token, runner, bib, category, status, checked_in_at
```

Rows are limited to `status IN ('paid','pending')`. `pending` rows are included deliberately: the offline path must be able to tell "this ticket is real but unpaid" (`not_paid`) apart from "this ticket is not recognised" (`not_found`), matching what the server would say.

**`checked_in_at` is load-bearing.** Progress count, already-checked-in detection, and roster search all derive from this single payload. There is no separate count query, and progress therefore keeps working offline. `useCheckInCount` is **deleted**, not rewritten.

### Contract rules

- Both `revoke all from public`, `grant execute to authenticated`.
- Both `set search_path = public`.
- The allowed role set mirrors `canCheckIn()` exactly — `marshal | editor | admin | super_admin` — so SQL and Edge Function agree by construction rather than coincidence. A change to one is a change to both.
- Neither returns `total_amount`, `custom_data`, or any payment field. This is asserted by test (§9).

### Route layer

`useMyRoles()` currently computes only `isSuperAdmin` / `isAdmin` / `isOrgAdmin` and has no concept of a marshal, so it gains `isMarshal` and `canCheckIn` (`isAdmin || isMarshal`). Its `orgId` is derived from the first `admin | editor` row and is therefore `null` for a marshal — anything needing an org id for a marshal must take it from the selected event, not from `useMyRoles()`.

A second gate, `RequireCheckInAccess`, sits alongside `RequireAdmin`. `/check-in` moves under it; every other route stays admin-only. The sidebar filters to what the role can reach, so a marshal signs in and sees one item.

**The sidebar filter is presentation only.** The RPCs and the Edge Function are the authorization boundary. A hidden nav item is not a permission check.

`/` redirects to `/dashboard` for admins, and to `/check-in` for a marshal, since that is the only route they can reach.

**Roles are additive and a user may hold several**, so precedence is explicit: if `isAdmin` is true the user lands on `/dashboard` regardless of any marshal row they also hold; `/check-in` is the landing only for someone who is *exclusively* a marshal. `RequireCheckInAccess` admits `isAdmin || isMarshal`, so an admin never loses access to check-in by being an admin.

## 5. Check-in — offline model

### 5.1 What "offline" means here

**Warm tab only.** The marshal opens `/check-in` while still on signal, selects the event, pre-downloads the roster, and keeps the tab open. Signal loss from that point is survived.

Explicitly **not** covered: a cold start with no signal. `apps/web` is a plain Vite SPA with no service worker, so a fresh load at a trailhead with no bars yields a blank page. Making that work means a service worker, cache versioning, an update strategy, and a new failure surface — deferred to its own cycle.

This is a real operational constraint, not just an implementation note: **if the phone sleeps hard enough to evict the tab, the marshal must return to signal.** The UI states this plainly rather than hiding it.

### 5.2 Why exact-match, not signature verification

Ticket tokens are HMAC-signed with `TICKET_SIGNING_SECRET`, which lives only on the server. A browser can never verify a signature offline, and shipping the secret to the client is not on the table.

Instead, offline acceptance is an **exact string match against a roster row's `ticket_token`**. Security-wise this is close to equivalent for the offline window: the signature exists to stop forged tokens, and a forged token will not appear in a roster downloaded from the server. The server re-verifies the signature, the paid status, and the scanner's authorization on replay regardless, so an offline accept is always provisional.

### 5.3 Offline decision

A pure function, `offlineDecision(token, roster)`, returns **the same `{ status, body }` shape the Edge Function returns**, so online and offline results render through one code path and the already-tested `bannerFor` mapper.

| Condition | Result |
|---|---|
| `decodeTicketEventId(token)` ≠ selected event | `wrongEventBanner` — caught before anything else |
| Exact `ticket_token` match, row `status = 'paid'`, no `checked_in_at`, not already queued | `{ ok: true }` → enqueue |
| Exact match, but already checked in or already in the local queue | `{ ok: true, already: true }` |
| Exact match, row `status = 'pending'` | `{ error: 'not_paid' }` |
| No match | `{ error: 'not_found' }` |

Scanning the same token twice offline resolves from local state as "already checked in" rather than double-queueing.

### 5.4 Storage and replay

One `localStorage` key per event:

```
race-pace.checkin.v1.<eventId> = {
  rosterFetchedAt, roster, queue, failed
}
```

`queue` entries carry `{ clientId, ticketToken, registrationId, runner, category, scannedAt }`. The selected event id is persisted separately so a reload restores context.

Replay is **safe to repeat**: the `unique (registration_id)` constraint on `checkins` already makes the Edge Function idempotent — a duplicate returns `{ ok: true, already: true }` (HTTP 200) rather than an error. Replay fires on the `online` event and on manual retry, sequentially, oldest first.

### 5.5 Reconciliation

A queued check-in rejected on replay — refunded between roster download and replay, marshal deauthorized, stale roster — moves to `failed` with the runner's name, the reason from `bannerFor`, and the HTTP status.

`failed` is surfaced as a **persistent, non-dismissable count** on the check-in screen with per-row retry, and a navigation guard blocks leaving the screen while anything is unreplayed or failed.

**Accepted limitation:** with no server-side audit row, clearing the tab loses the failed list. This is the deliberate cost of the warm-tab decision, and the reason the navigation guard exists. A durable audit trail is a candidate for the follow-up cycle.

## 6. Check-in — input

Both emitters are always live. `useCheckInSession.submitToken(token)` is the single entry point; neither emitter knows anything about check-in.

### 6.1 Camera

`qr-scanner` (nimiq) — roughly 12 KB gzipped, decodes in a web worker, works on iOS Safari, ships no UI of its own. The only new dependency in this spec. **A new dependency requires restarting the `web` container**; a bind-mount hot reload will not pick it up.

Camera needs a secure context, which `https://admin.racepace.lan` satisfies via mkcert.

- ~1.5 s cooldown after a successful decode, so one QR does not fire repeatedly.
- Torch toggle where `MediaStreamTrack` supports it — trail races commonly start before dawn.
- Permission denied, or no camera present, degrades to roster search with an explanation. Never a dead screen.

### 6.2 Hardware scanner (keyboard wedge)

A USB or Bluetooth QR scanner in HID mode presents as a **keyboard**: it types the decoded token in a burst and usually — not always — sends `Enter`. A phone paired to a Bluetooth scanner is the same code path.

Detection uses **three signals**, because timing alone produces false positives on fast typists:

1. Inter-key intervals under ~30 ms
2. Buffer conforms to the token charset — base64url plus `.`, i.e. `[A-Za-z0-9_.-]` — which name-searching text will not
3. Terminated by `Enter`, or by ~80 ms of silence for scanners configured with no suffix

Modifier combos are ignored so browser shortcuts keep working.

**The focus leak.** A wedge scanner types into whatever has focus, so a marshal who last tapped the roster search box will have the next scan land there as search text. The listener runs in the **capture phase** and snapshots the focused element's value at burst start; once two characters have arrived at machine speed it begins calling `preventDefault`, and on commit it restores the snapshot — so the one or two characters that leak before detection triggers never persist.

This is the most bug-prone part of the feature, so the detector is a **pure reducer** — `feedKey(state, {key, timeStamp}) → {state, emit?}` — testable without a DOM (§9).

## 7. Check-in — UI

One responsive screen. Camera panel and progress stack vertically on a phone; on a desk they sit beside the roster.

- **Event picker** from `checkin_events()`, selection persisted.
- **Roster sync state, prominently.** "Roster synced 8 min ago · 342 runners". The entire offline path silently depends on this having happened before signal is lost, so never-synced or stale is a warning, not fine print.
- **Scan result banner** — large, high-contrast, driven by `bannerFor` tones. Cold hands, bright sun, a queue of runners.
- **Roster search** — name or bib; tapping a runner submits **their stored `ticket_token`** through the same pipeline, so there is no second backend path. Per-row checked-in state.
- **Progress** — "128 / 342 checked in", derived from roster + queue.
- **Queue status** — pending count; failed count as the persistent banner from §5.5.
- **"Ready to scan"** reflects which emitters are actually live, so a desk machine with no camera reads as working rather than broken.

### Component boundaries

| Unit | Responsibility |
|---|---|
| `lib/checkinQueue.ts` | Pure. Storage shape, queue reducer, `offlineDecision`. No React, no network. |
| `lib/keyboardWedge.ts` | Pure. `feedKey` reducer. No DOM. |
| `lib/useKeyboardWedge.ts` | Binds the reducer to capture-phase `keydown`, handles snapshot/restore. |
| `lib/checkin.ts` | Extended: `useCheckInEvents` / `useCheckInRoster` onto the RPCs. `useCheckInCount` deleted. |
| `lib/useCheckInSession.ts` | Wires roster + queue + mutation + online state. Exposes `submitToken`. |
| `routes/CheckIn.tsx` | Layout, event picker, progress. |
| `components/QrScanner.tsx` | Camera only. Emits a token string. |
| `components/CheckInBanner.tsx` | Renders a `CheckInBanner`. |
| `components/CheckInRoster.tsx` | Search, list, tap-to-check-in. |
| `components/CheckInQueueStatus.tsx` | Pending / failed counts, retry. |

## 8. Dashboard

### 8.1 Aggregation stays in Postgres

Summing every payment row client-side does not scale and invites floating-point bugs on money. A second migration adds two views following the `20260804120000_admin_list_views.sql` pattern exactly — **`security_invoker = true`**, so an admin's existing RLS is the only thing granting access and no new privilege appears:

- **`admin_org_totals_v`** — per `org_id`: registration count, paid count, pending count, gross revenue, net to org, platform fee. Money aggregated over `status = 'paid'`.
- **`admin_event_totals_v`** — per `event_id`: registration count and revenue.

### 8.2 Surface

`routes/Dashboard.tsx` + `lib/dashboard.ts`, admin-only under `RequireAdmin`:

- **Stat tiles** — registrations, gross revenue, net to org, paid-vs-pending.
- **Recent signups** — `admin_registrations_v`, newest 8: runner, event, category, payment status.
- **Per-event table** — name, date, status, registration count, revenue.

### 8.3 Money

Integer centavos end to end. `formatPeso` from `@race-pace/shared` appears **only in JSX**, never in a calculation. No floating-point arithmetic on amounts anywhere.

### 8.4 Empty states are the default rendering

With one event and zero registrations in the hosted DB, the empty state is what this screen actually shows today — it is the primary case, not a fallback.

- Zero events → a create-event CTA.
- Events but zero registrations → an explanation, not four zeros implying something broke.
- Loading → existing `Skeleton`.

## 9. Testing

### Unit — `pnpm --filter web test`

**Never a bare `pnpm exec vitest run` at the repo root**: it picks up 8 RLS/integration files under `supabase/tests/` that need a running local stack and fails for reasons unrelated to this work.

- `offlineDecision` — the full §5.3 table: paid match, pending match, no match, already checked in, already queued, wrong event.
- Queue reducer — enqueue, duplicate-scan dedupe, replay success, replay rejection → `failed`, manual retry, progress derivation from roster + queue.
- `feedKey` wedge reducer — machine burst with `Enter`; machine burst with no suffix committing on silence; human typing rejected; a burst interleaved with human typing; a burst arriving while the search field is focused, asserting the snapshot restores.
- Dashboard — aggregation mapping and peso formatting at the render edge.

### RPC authorization — `supabase/tests/` (local stack required)

- A marshal receives exactly their own org's roster.
- An admin of a *different* org receives nothing.
- `event_scope`, when set, narrows to that event.
- A plain `user` receives nothing.
- **`checkin_roster` never returns `total_amount` or `custom_data`** — the reason the RPC was chosen over table policies, so it is asserted rather than assumed.

### Manual

- `https://admin.racepace.lan` via Docker. Use `127.0.0.1` explicitly where a port is involved — another project holds `[::1]` on common ports and macOS resolves IPv6 first — and **check the page title before trusting what you see**.
- Offline exercised via devtools Network → Offline, including: queue while offline, restore connection, confirm replay; and a forced rejection landing in `failed`.
- Camera on a real device or via Chrome camera emulation.
- Wedge with a real scanner if available, otherwise synthetic key bursts.
- Load `supabase/seed.sql` for a Dashboard with real numbers.

## 10. Commit sequence

Each commit green on its own.

1. Migration — `checkin_events()` + `checkin_roster()`, with RPC authorization tests.
2. `RequireCheckInAccess`, sidebar filtering, `/` redirect by role.
3. `lib/checkinQueue.ts` — storage, reducer, `offlineDecision`, with tests.
4. `lib/keyboardWedge.ts` + `useKeyboardWedge` — pure reducer with tests, then the DOM binding.
5. `checkin.ts` onto the RPCs; delete `useCheckInCount`; `useCheckInSession`.
6. Check-in UI — route, scanner, banner, roster, queue status.
7. Migration — `admin_org_totals_v` + `admin_event_totals_v`.
8. Dashboard route and data layer.

### Verification before the PR

- `pnpm --filter web test` green.
- `pnpm exec vitest run supabase/functions packages` green.
- Typecheck and build clean.
- `grep -rn "var(--" apps/web/src/components/ui/` — every hit is `var(--color-*)`. No shadcn components are expected to be added, but the check is cheap and the failure mode is silent.
- Both migrations applied to `whaqarofxdlzxrelbcrq` via `db push`, and a marshal login verified end to end against the hosted project.

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Wedge detector misfires on human typing** and hijacks the search box | Three independent signals (§6.2), not timing alone; pure reducer with adversarial tests including interleaved input |
| **Warm-tab assumption fails** — phone sleeps, tab evicted, marshal is offline with nothing | Stated plainly in the UI, not hidden; roster sync state is prominent; navigation guard on unreplayed items. Residual risk accepted for this cycle |
| **Failed queue lost with the tab** | Persistent banner and navigation guard; accepted limitation (§5.5) |
| **RPC and `canCheckIn()` drift apart** | Role set mirrored deliberately, documented in §4, asserted by the authorization tests |
| **Roster grows large enough to strain `localStorage`** | Current events are in the hundreds. If a roster approaches the ~5 MB quota, the failure is a write throw — caught and surfaced as a sync failure rather than silently losing the roster |
| **CLI logged into the wrong Google account** — `supabase link` fails confusingly and the retired `ytwdrsmclwghwktpupqd` is visible instead | `pnpm exec supabase projects list` before any database work |
| **Dashboard shows zeros and reads as broken** | Empty states treated as the primary rendering (§8.4) |

## 12. Assumptions to revisit

- **Both the desk scanner and the trailhead phone get the full offline treatment.** Whether the registration desk actually has reliable connectivity is unknown until a real race has been run; if it does, its path could be simplified later.
- **Warm-tab is sufficient.** Revisit after the first race — if marshals lose tabs in practice, the service-worker cycle becomes urgent rather than optional.

## 13. Deferred

- **Payouts** — no schema, moves real money. Its own spec.
- **Commission** — a read-only report over existing `platform_fee` / `net_to_org` is cheap; period-close and rollup are not.
- **Organizations** — cross-org super-admin surface.
- **Service worker / PWA** — cold-start offline.
- **Server-side audit of rejected replays.**
- **Per-event dashboard drill-down** — fill rate per category, check-in progress. Shape it against real registration data.
