# Admin web — race-day check-in

**Date:** 2026-08-05
**Status:** Approved, ready for planning
**Surface:** `apps/web` (admin console), plus one database migration

## Problem

The check-in backend is complete and unused. [`supabase/functions/check-in/index.ts`](../../../supabase/functions/check-in/index.ts)
verifies a signed ticket token, rejects registrations that are not `paid`, authorizes the
scanner via `canCheckIn`, and inserts one row per registration into `checkins` (a unique
violation is translated into `{ok: true, already: true}`).

Nothing calls it. The admin web reserves `/check-in` but renders `<Placeholder title="Check-in" />`,
and the marshal — the persona the product overview defines for this exact job — cannot sign
in to the web console at all.

Target throughput from the product overview: **≥ 6 runners/min per scanner**.

## Decisions

| Question | Decision |
| --- | --- |
| Who can use it | Marshals, plus editor/admin/super_admin |
| How they check in | Camera QR scan, with search-by-name/bib as fallback |
| Event scoping | Marshal picks an event; wrong-event scans are refused client-side |

## 1. Access

Two independent layers exclude marshals today. Both change.

### Web gate

`useMyRoles` computes `isAdmin = isSuperAdmin || (admin || editor)`; `RequireAdmin` bounces
everyone else to `/no-access`.

- Add `isMarshal` to `MyRoles`.
- Rename `RequireAdmin` → `RequireWebAccess`, admitting `isAdmin || isMarshal`.
- A marshal requesting any route other than `/check-in` is redirected to `/check-in`.
- `AppShell` renders only the Check-in nav item for a marshal — no events, registrations,
  payments, team, or settings.

A marshal must see nothing financial. That is a UI concern *and* an RLS concern; the
policies below grant reads on `registrations` and `checkins` only, never `payments`.

### Database migration

`auth_can_admin_org` resolves to `editor`/`admin` only, so a marshal can read neither
`registrations` nor `checkins`. That helper also guards writes to events, refunds and staff,
so it must **not** be widened. Add a sibling helper instead:

```sql
create or replace function auth_can_check_in_org(target uuid) returns boolean
  language sql stable security definer set search_path to 'public'
as $$
  select auth_is_super_admin()
      or exists (select 1 from user_roles
                 where user_id = auth.uid() and org_id = target
                   and role in ('editor','admin','marshal'));
$$;
```

Then two read-only policies:

- `registrations_read_org_checkin` — `SELECT` on `registrations` where `auth_can_check_in_org(org_id)`
- `checkins_read_org_checkin` — `SELECT` on `checkins` where `auth_can_check_in_org(org_id)`

No new write policies. Check-ins are still written exclusively by the edge function using the
service client, which keeps ticket-signature verification on the server.

## 2. Screen

One route, `/check-in`, three regions.

```
[ Event: Apo Summit Ultra 100 ▾ ]          Checked in: 42 / 138

┌── camera viewfinder ──┐   default view, scans continuously
│                       │
└───────────────────────┘

  GREEN  Checked in — Juan Dela Cruz · 100K Ultra
  AMBER  Wrong event — this ticket is for Kitanglad Skyrace
  RED    Not paid  /  Invalid ticket  /  Not authorized
  GREY   Already checked in (12:04)

[ Search name or bib ]      fallback, collapsed by default
  Juan Dela Cruz   100K   paid      [ Check in ]
  Maria Santos     50K    pending   (disabled)
```

- The event picker lists the org's non-draft events, defaulting to the one whose date range
  covers today, else the nearest upcoming.
- The result banner is large and colour-coded to be read at arm's length, and auto-clears
  after ~3 seconds so the next runner can scan without interaction.
- The counter is `count(checkins)` over `count(registrations where status='paid')` for the
  selected event.
- The manual list shows paid and pending rows; only paid rows have an enabled button. Showing
  pending rows is deliberate — it explains *why* a runner cannot be checked in.

## 3. Data flow

```
camera → decode QR → ticket_token
                   → client compares ticket's event vs selected event
                       mismatch → AMBER, nothing sent
                       match    → POST /functions/v1/check-in { ticket_token }
                                → banner from response
```

The manual path reads `ticket_token` off the registration row and posts the **same** request.
Paid rows always have a token — it is set atomically alongside `status='paid'` in
[`money_txn_rpcs.sql`](../../../supabase/migrations/20260723100000_money_txn_rpcs.sql). One
check-in code path, not two.

Response → banner mapping, straight from the existing function:

| Response | Banner |
| --- | --- |
| `{ok: true}` | GREEN Checked in |
| `{ok: true, already: true}` | GREY Already checked in |
| `409 not_paid` | RED Not paid |
| `400 invalid_ticket` / `400 ticket_token_required` | RED Invalid ticket |
| `403 forbidden` | RED Not authorized — ticket belongs to another organization |
| `404 not_found` | RED Ticket not recognised |
| network/5xx | RED Could not reach the server — retry |

Wrong-event detection is advisory, not enforced server-side. The `checkins` row always
records the event from the registration, so stored data is correct either way; the guard
exists to stop operational mix-ups, not to defend against a hostile marshal.

## 4. Dependency

`@zxing/browser` for camera QR decoding — maintained, handles device enumeration and
continuous scanning. Camera access requires a secure context, satisfied by
`https://admin.racepace.lan` (mkcert).

## 5. Seed data

Check-in is not exercisable end-to-end today: the database has zero registrations, and
check-in requires `status='paid'` with a `ticket_token`.

Extend `supabase/seed.sql` with roughly 15 paid registrations spread across two Muspo events,
plus 3–4 pending ones. Paid rows need a `ticket_token` whose signature matches
`TICKET_SIGNING_SECRET`, so the seed must generate them the same way the RPC does. Add one
user with the `marshal` role scoped to Muspo, so the marshal-only view can actually be tested.

## 6. Testing

- **RLS (`supabase/tests/`)** — a marshal can read own-org `registrations` and `checkins`;
  cannot read another org's; cannot read `payments`; cannot update events.
- **Edge function** — existing coverage stands; add a case asserting a marshal is accepted
  by `canCheckIn` while a runner is rejected.
- **Web (vitest)** — response→banner mapping for every row in the table above; wrong-event
  guard blocks submission; manual list disables non-paid rows; marshal sees only the
  Check-in nav item.

## Out of scope

Offline or queued check-in, bib assignment, check-in reports and export, and any mobile
marshal UI.
