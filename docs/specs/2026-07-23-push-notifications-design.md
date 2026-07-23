# Push notifications — design

- **Product:** Race Pace — runner app (`apps/mobile`) + admin web (`apps/web`) + hosted Supabase backend
- **Status:** Draft v0.1 (approved to plan)
- **Last updated:** 2026-07-23
- **Owner:** Product (jayson@voltcontent.com)
- **Related:** [00 · Product overview](./../00-product-overview.md) · [01 · Mobile (iOS) MVP](./../01-mobile-ios-mvp.md) · [Roadmap · Plan 14 check-in](./../README.md) · [Registrations & payments design](./2026-07-22-registrations-payments-design.md)

---

## 1. Summary

Add a **Facebook-style notification system** to Race Pace: a persisted, in-app
notification center (bell + unread badge + a scrollable inbox, each item read/unread,
"mark all read", tap-to-deep-link) **plus** real device push to the lock screen via Expo
when the app is closed. The inbox is the source of truth; device push is a delivery
channel layered on top.

Notifications are **created by Postgres triggers** so they fire regardless of which code
path caused the change — including the web-admin event edits that today are plain `UPDATE`s
with no server hook — and each notification is written **in the same transaction** as its
state change. Two channels read off one `notifications` table: **Supabase Realtime** powers
the live in-app inbox, and a **`pg_cron`-drained `send-push` Edge Function** delivers Expo
push (~60 s cadence).

The feature covers seven triggers (§3). Two required backend pieces do not exist yet and
are built here as **minimal, self-contained** additions: a `checkins` table + scan endpoint
(for "attendance scanned"), and an event-status→`completed` hook (for "completed an event").
There is currently **zero** notification/push infrastructure in the repo, so this is a
greenfield feature with clean integration points (the bell in `BrandHeader.tsx` is already
present but wired to a no-op).

## 2. Goals & non-goals

### 2.1 Goals

- A persisted `notifications` inbox with **read/unread per item** and **mark-all-read** (req #7).
- **In-app live updates** via the app's first Supabase Realtime subscription (bell badge + list update while the app is open).
- **Device push** (Expo → APNs) for lock-screen delivery when the app is backgrounded/closed.
- **DB-trigger-driven creation** of notifications for all seven triggers, atomic with each state change.
- A **minimal check-in** path (`checkins` table + `check-in` Edge Function) so "attendance scanned" has a real, testable trigger without building Plan 14's full web scanner UI.
- Stay **runnable and test-green** throughout; ship behind the existing app shell with no regressions to the register → pay → ticket money path.

### 2.2 Non-goals (future work)

- Per-type notification **preference toggles** (v1 = all on; the OS controls device-push opt-in).
- An **org-follow / subscribe** concept (the new-event broadcast goes to *all* users for now).
- A real **finisher / results / timing** concept ("completed" is derived from the event-level status).
- The full **Plan 14 web QR scanner UI** (this spec builds only the scan *endpoint* it will call).
- Push **receipt reconciliation** beyond immediate `DeviceNotRegistered` token pruning.
- Email / SMS channels.

## 3. Scope — the seven triggers

| # | Requirement | Trigger source | Fires when | Recipients | Deep-link |
|---|---|---|---|---|---|
| 2 | Registered | `registrations` INSERT | new registration row (status `pending`) | the runner | `/pay/[registration_id]` |
| 1 | Paid | `registrations` UPDATE | `status` → `paid` (the transition `confirm.ts` performs) | the runner | `/ticket/[registration_id]` |
| 4a | Cancelled | `events` UPDATE | `status` → `cancelled` | that event's registrants (`pending` + `paid`) | `/event/[event_id]` |
| 4b | Rescheduled | `events` UPDATE | `original_date` set (the app's reschedule signal) | that event's registrants | `/event/[event_id]` |
| 4c | Newly created | `events` INSERT/UPDATE | `status` becomes `open` (**published**, not draft-save) | **broadcast: all users** | `/event/[event_id]` |
| 5 | Completed | `events` UPDATE | `status` → `completed` | `paid` registrants | `/event/[event_id]` |
| 6 | Attendance scanned | `checkins` INSERT | staff scans the QR ticket | the runner | `/ticket/[registration_id]` |
| 3 | Event N days away | `pg_cron` daily | event is **7** or **1** days away | `paid` registrants | `/event/[event_id]` |
| 7 | Read/unread + mark all | (client) | user reads / marks | self | — |

**Resolved decisions (from brainstorming):**

- **#1 vs #2** are two distinct messages at two funnel stages (register → then pay). For **free / zero-amount** events where a registration is created already-`paid`, we collapse to a single "paid" notification (§6.1).
- **#4 "newly created" = newly *published*.** The broadcast fires when an event's `status`
  becomes `open` (visible in the marketplace), **not** when a draft is first saved —
  otherwise every draft save would spam all users. A `dedup_key` prevents re-broadcast on
  republish/toggle.
- **#4 new-event audience = all users** (broadcast). Accepted trade-off: potentially spammy
  as the catalog grows; the future org-follow feature (non-goal) is the intended replacement.
- **#5 "completed" = event-level.** When an organizer sets the event `status` to `completed`,
  each `paid` registrant is notified. No per-runner finish record is introduced.
- **#3 reminder schedule = 7 days + 1 day** before `event_date`, defined as a constant.
- **Device-push latency ≈ 60 s** (cron-drain cadence) is accepted; the in-app inbox is instant
  via realtime, so the moment-of-payment case is already covered live.

## 4. Architecture

### 4.1 Overview

```
State change  (register / pay / event publish|cancel|reschedule|complete / check-in / cron)
      │
      ▼
 Postgres TRIGGER  ── inserts (same txn) ──►  notifications   (single source of truth)
      │                                            │
      │                                            ├─► Supabase Realtime ─► Mobile inbox (app open, instant)
      │                                            │        bell badge · list · read/unread
      │                                            │
      │                                            └─► pg_cron drain (~60 s) ─► send-push Edge Fn
      ▼                                                       • join device_tokens
 (atomic with state change)                                   • Expo Push API (batch ≤100)
                                                              • prune dead tokens · set push_sent_at
                                                                        │
                                                                        ▼
                                                              APNs ─► iPhone lock screen (app closed)
```

### 4.2 Why DB triggers (approach chosen)

The alternative — having each code path (`confirm.ts`, `registrations-checkout`, `refund.ts`,
the new check-in fn, **and the `apps/web` event screens**) call a shared TypeScript helper —
was rejected because it would require editing the web admin app, is non-transactional (a
notification could desync from its state change, the same caveat the money writes carry), and
spreads the logic across more call sites. DB triggers give us: **one source of truth**, firing
**regardless of caller** (the web-admin `UPDATE` on `events` "just works" with no web changes),
and **atomicity** with the state change. Device push is deliberately kept **async** (cron) so a
push outage can never block or roll back a payment.

Trade-off accepted: notification-creation logic lives in PL/pgSQL rather than TypeScript, and
we take on `pg_cron` + `pg_net` as operational dependencies (both are standard Supabase
extensions).

## 5. Data model

One migration set under `supabase/migrations/`. All new tables follow the repo's established
conventions: RLS enabled, **explicit** `grant`s to `anon`/`authenticated`/`service_role` (the
project notes that new tables are *not* auto-exposed), owner-scoped read via `auth.uid()`, and
an org-admin overlay via the existing `auth_can_admin_org(org_id)` helper where relevant.

### 5.1 `notification_type` enum

```
registered | paid | event_reminder | event_cancelled |
event_rescheduled | event_created | checked_in | event_completed
```

Also exported from `packages/shared/src/index.ts` (`NOTIFICATION_TYPE`) for web reuse, mirroring
how `REGISTRATION_STATUS` / `ROLES` are shared.

### 5.2 `notifications` — the inbox

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid | FK `auth.users`, **recipient**, cascade delete, indexed |
| `type` | `notification_type` | |
| `title` | text | short headline |
| `body` | text | one-line detail |
| `data` | jsonb | deep-link params: `{ event_id, registration_id? }` |
| `read_at` | timestamptz null | **null = unread** |
| `push_sent_at` | timestamptz null | **null = push pending**; drained by cron |
| `dedup_key` | text null | **unique** partial index; stops duplicate reminders/broadcasts |
| `created_at` | timestamptz default now() | |

- Index `(user_id, created_at desc)` for the inbox query; partial index `(user_id) where read_at is null` for the unread count.
- **RLS:** `notifications_read_own` (`user_id = auth.uid()`), `notifications_update_own`
  (`user_id = auth.uid()` — the only client write, used to set/clear `read_at`). **No client
  insert policy** — trigger functions insert as the table owner / service role.
- Added to the `supabase_realtime` publication (`alter publication supabase_realtime add table notifications`) — the app's first realtime consumer.

### 5.3 `device_tokens` — push destinations

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid | FK `auth.users`, cascade, indexed |
| `token` | text | Expo push token, **unique** |
| `platform` | text | `ios` / `android` |
| `created_at` / `updated_at` | timestamptz | |

- **RLS:** owner-scoped read/insert/update/delete (`user_id = auth.uid()`); mobile upserts its
  own token on login. `service_role` full access (the `send-push` fn reads tokens + prunes dead ones).

### 5.4 `checkins` — minimal, matches planned Plan-14 shape

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid | FK `organizations` |
| `registration_id` | uuid | FK `registrations`, **unique** (one scan per registration) |
| `event_id` | uuid | FK `events` |
| `checked_in_at` | timestamptz default now() | |
| `checked_in_by` | uuid | FK `auth.users` — the staff member who scanned |

- **RLS:** read via registration ownership (`exists (select 1 from registrations r where r.id = registration_id and r.user_id = auth.uid())`) **or** `auth_can_admin_org(org_id)`; **insert via `service_role` only** (the `check-in` Edge Fn) — mirrors how money writes are gated in-code because service-role bypasses RLS.

## 6. Triggers & fan-out logic

Three trigger functions + one scheduled function. Recipients come from `registrations`
(join on `event_id`) for event-scoped notifications and from `profiles` (1:1 with users) for
the broadcast.

### 6.1 `fn_notify_on_registration()` — AFTER INSERT OR UPDATE ON `registrations`

- **INSERT**: if `NEW.status = 'paid'` → emit **paid** only (free-event collapse); else emit **registered**.
- **UPDATE**: if `OLD.status <> 'paid' AND NEW.status = 'paid'` → emit **paid**.
- Inserts one `notifications` row for `NEW.user_id` with `data = {event_id, registration_id}`.
- Idempotency for "registered" is inherited from the table's `unique (user_id, idempotency_key)` (a checkout retry updates rather than re-inserts, so no duplicate).

### 6.2 `fn_notify_on_event_change()` — AFTER INSERT OR UPDATE ON `events`

Emits, based on the transition, a fan-out `insert … select` over the relevant audience:

- **cancelled**: `OLD.status <> 'cancelled' AND NEW.status = 'cancelled'` → registrants where `status in ('pending','paid')`.
- **rescheduled**: `NEW.original_date IS DISTINCT FROM OLD.original_date AND NEW.original_date IS NOT NULL` → registrants where `status in ('pending','paid')`.
- **completed**: `OLD.status <> 'completed' AND NEW.status = 'completed'` → registrants where `status = 'paid'`.
- **created/published (broadcast)**: `(TG_OP='INSERT' AND NEW.status='open')` **or** `(TG_OP='UPDATE' AND OLD.status IS DISTINCT FROM 'open' AND NEW.status='open')` → all `profiles`, with `dedup_key = 'event_created:'||NEW.id||':'||profile.id` and `ON CONFLICT (dedup_key) DO NOTHING` so republish/toggle never re-broadcasts.

### 6.3 `fn_notify_on_checkin()` — AFTER INSERT ON `checkins`

- Notifies the registration's owner: **checked_in**, `data = {event_id, registration_id}`.

### 6.4 `fn_enqueue_event_reminders()` — `pg_cron` daily

- Constant `reminder_days int[] := '{7,1}'`.
- For each `open` event with `event_date - current_date = any(reminder_days)`, insert an
  **event_reminder** per `paid` registrant with
  `dedup_key = 'reminder:'||event_id||':'||user_id||':'||days_out` and `ON CONFLICT DO NOTHING`
  — so the daily job is safe to re-run and never double-sends.

## 7. Delivery pipeline

### 7.1 In-app inbox (realtime)

Mobile opens a single Realtime channel: `postgres_changes` on `notifications` filtered to
`user_id = <me>`. On `INSERT`/`UPDATE` it invalidates the react-query `notifications` and
`unread-count` keys, so the bell badge and list update live. This is the app's first realtime
subscription (server-side realtime is already enabled; the table is added to the publication in §5.2).

### 7.2 Device push (cron-drain → Edge Function)

- **`pg_cron` job** `drain-push` runs every minute: `net.http_post(...)` (pg_net) pings the
  `send-push` Edge Function with the service-role key.
- **`send-push` Edge Function** (Deno): selects `notifications where push_sent_at is null`
  (limit ~200, oldest first), joins `device_tokens` by `user_id`, builds Expo messages
  (`title`, `body`, `data`), and POSTs to `https://exp.host/--/api/v2/push/send` in **batches of ≤100**.
  It then sets `push_sent_at = now()` for **every** selected row (including users with no token —
  best-effort, so the queue never clogs), and **deletes** any token the Expo response reports as
  `DeviceNotRegistered`.
- Rationale for cron-drain over per-row `pg_net`: avoids an HTTP call per row (critical for the
  all-users broadcast) and is self-healing (a failed tick simply retries next minute). Optional
  future enhancement: an immediate `pg_net` push for latency-critical types.

## 8. Minimal check-in endpoint (#6)

New **`check-in` Edge Function** (JWT, staff-only), modelled on `admin-refund` (which
re-implements org authority in code because `service_role` bypasses RLS):

1. Accept `{ ticket_token }` (from the scanned QR).
2. `verifyTicketToken()` (existing HMAC-SHA256 in `_shared/ticket.ts`) → `{ rid, eid }`.
3. Load the registration; confirm it's `paid`.
4. Authorize the caller: `super_admin`, or `marshal`/`editor`/`admin` for that event's org via `user_roles`.
5. `insert into checkins … on conflict (registration_id) do nothing` → return `already_checked_in` if no row was inserted.
6. The INSERT fires `fn_notify_on_checkin()` → the runner gets **checked_in**.

Plan 14's web scanner UI (non-goal here) will later call this same endpoint. No mobile scanning
in this feature.

## 9. Mobile app changes (`apps/mobile`)

- **Dependencies:** add `expo-notifications` + `expo-device`; add the `expo-notifications`
  plugin (icon/color) to `app.json`. Add `__mocks__/expo-notifications.js` for Jest.
- **`lib/push.ts` (new):** `registerForPushNotificationsAsync()` — guard on `Device.isDevice`
  (simulator has no APNs token → no-op, inbox still works), request permission,
  `getExpoPushTokenAsync({ projectId })`, upsert into `device_tokens`. Set
  `Notifications.setNotificationHandler` for foreground display. Called from `AuthProvider`
  (`lib/auth.tsx`) once a session exists.
- **`lib/notifications.ts` (new):** react-query hooks — `useNotifications` (list, newest first),
  `useUnreadCount`, `useMarkRead(id)`, `useMarkUnread(id)`, `useMarkAllRead()` — writing via
  supabase `update` under the update-own RLS policy. Plus `useNotificationsRealtime()` (§7.1),
  mounted once in the root layout.
- **`app/notifications.tsx` (new):** the inbox — a `FlatList` (mirrors `races.tsx`), sectioned
  **Today / Earlier**, each row = type icon (lucide) + `title` + `body` + relative time +
  unread highlight; header **"Mark all read"** action; pull-to-refresh via the existing
  `useGlobalRefresh`; empty state. Registered as a top-level Stack route (the root `<Stack>`
  renders it headerless).
- **Bell + badge:** wire [`BrandHeader.tsx`](../../apps/mobile/components/BrandHeader.tsx) `onPress`
  → `router.push('/notifications')`; overlay a `destructive` unread-count badge from `useUnreadCount`.
- **Tap → deep link:** `addNotificationResponseReceivedListener` (+ cold-start
  `getLastNotificationResponseAsync`) routes by `type`/`data` per the table in §3. Opening a
  notification also marks it read.
- **Icon mapping (suggested):** registered `ClipboardCheck` · paid `Ticket` · event_reminder
  `CalendarClock` · event_cancelled `XCircle` · event_rescheduled `CalendarClock` · event_created
  `Sparkles` · checked_in `QrCode` · event_completed `Trophy`. Unread accent uses the existing
  destructive/`notification` red; brand accent trail-green `#159A55`.
- **Profile "Notifications" row** ([`profile.tsx:23`](../../apps/mobile/app/(tabs)/profile.tsx))
  → routes to `/notifications` (replacing the "Coming soon" alert); a preferences screen is a non-goal.

## 10. Read/unread model (#7)

`read_at` is the entire model: unread = `null`.

- **Mark read** → `read_at = now()`; **mark unread** → `read_at = null`;
  **mark all read** → update all my rows where `read_at is null`.
- All writes go through the update-own RLS policy — a user can only touch their **own** rows.
- **Unread count** = `count(*) where read_at is null` (served by the partial index).
- Tapping a notification marks it read; the realtime subscription reflects the change on any
  other signed-in device.

## 11. Security & RLS

- `notifications`: read-own + update-own; no client insert. A malicious client can at most
  toggle its own `read_at`.
- `device_tokens`: owner-scoped; `token` unique so re-registration upserts.
- `checkins`: read own-or-org-admin; insert only via the service-role `check-in` fn, which
  enforces staff authority in code.
- `send-push` is authenticated by the service-role key passed from the `pg_cron`/`pg_net` call;
  it is not publicly invocable without it.
- Deep-link `data` carries only ids the recipient already owns; no sensitive payload in push bodies.

## 12. Error handling & edge cases

- **Push failure / no token:** cron marks `push_sent_at` best-effort and retries are unnecessary;
  `DeviceNotRegistered` prunes the token. A user with notifications OFF at the OS level simply
  gets no push — the inbox is unaffected.
- **Atomicity:** notification rows are created in the same transaction as their state change, so
  they never desync (unlike the async money writes). If a payment confirm's later non-transactional
  writes partially fail, the `status → paid` transition that fires the notification is the same one
  that gates the ticket, so the notification and the ticket stay consistent.
- **Broadcast scale:** new-event fan-out inserts one row per user and batches Expo sends by 100.
  Acceptable at current scale; the row-count and cron drain time are the metrics to watch, and
  org-follow (non-goal) is the eventual mitigation.
- **Duplicate suppression:** `dedup_key` guards reminders (per event/user/day) and the new-event
  broadcast (per event/user).
- **Reschedule detection** relies on the app setting `original_date`; if a reschedule ever changes
  `event_date` without setting `original_date`, no rescheduled notice fires (documented assumption,
  matches the web admin's current behavior).

## 13. Testing strategy

- **Backend (Vitest + a Supabase DB):** integration tests that drive rows through the service
  client and assert notifications appear — INSERT a registration → `registered`; flip
  `status → paid` → `paid`; publish an event → broadcast; cancel/reschedule/complete → correct
  fan-out; run `fn_enqueue_event_reminders()` **twice** → assert dedup; insert a check-in →
  `checked_in`. Unit tests for `send-push` (mock the Expo API + assert token pruning) and
  `check-in` (authority + `verifyTicketToken`, alongside the existing `ticket.test.ts`). Preferred
  runner is a local `supabase start` DB; the linked project is the fallback.
- **Mobile (Jest + jest-expo + RNTL):** hook tests for `useNotifications` / `useUnreadCount` /
  mark read / mark-all (fresh `QueryClientProvider`, per existing patterns); inbox screen render +
  mark-all + tap-deep-link; push registration with the `expo-notifications` mock (incl. the
  `Device.isDevice === false` no-op path). New tests live under `apps/mobile/__tests__/`.
- The suite stays green at every step; the money path keeps its existing coverage.

## 14. Migrations & file inventory

**New migrations (`supabase/migrations/`):**
1. `notification_type` enum + `notifications` table + RLS + grants + realtime publication + indexes.
2. `device_tokens` table + RLS + grants.
3. `checkins` table + RLS + grants.
4. Trigger functions `fn_notify_on_registration` / `fn_notify_on_event_change` /
   `fn_notify_on_checkin` + their triggers.
5. `fn_enqueue_event_reminders` + `pg_cron` reminder job + `pg_cron`/`pg_net` push-drain job
   (extensions enabled if not already).

**New Edge Functions (`supabase/functions/`):** `send-push/`, `check-in/`.

**New mobile files:** `app/notifications.tsx`, `lib/push.ts`, `lib/notifications.ts`,
`__mocks__/expo-notifications.js`, `__tests__/notifications-*.test.tsx`.

**Edited mobile files:** `components/BrandHeader.tsx` (bell), `lib/auth.tsx` (register push),
`app/_layout.tsx` (mount realtime), `app/(tabs)/profile.tsx` (route the row), `app.json` (plugin),
`package.json` (deps).

**Shared:** `packages/shared/src/index.ts` (`NOTIFICATION_TYPE`).

**Notably unchanged:** `confirm.ts`, `registrations-checkout`, `refund.ts`, and the entire
`apps/web` event flow — the DB triggers cover them.

## 15. Operational prerequisites

- **APNs / EAS:** device push requires an Apple APNs key configured via EAS credentials and an
  EAS `projectId` in `app.json` for `getExpoPushTokenAsync`. Until that's set, the **in-app inbox
  works everywhere (incl. simulator)**; only lock-screen push needs a physical device + credentials.
- **Extensions:** ensure `pg_cron` and `pg_net` are enabled on the hosted project
  (ref `ytwdrsmclwghwktpupqd`, PG17).
- **Secrets:** `send-push` uses the existing service-role key; no new third-party secret (the Expo
  push endpoint needs none for basic sends).
- **Timezone:** the reminder cron is scheduled in UTC; the constant is chosen to land at a sensible
  PH-morning local time.

## 16. Assumptions

- Every signed-up user has a `profiles` row (used as the broadcast audience).
- `registrations-checkout` continues to create registrations as `pending` then transition to
  `paid` via `confirm.ts`; free/zero-amount events may arrive already-`paid` (handled by §6.1).
- The web admin sets `original_date` when rescheduling (the app's documented reschedule semantic).
