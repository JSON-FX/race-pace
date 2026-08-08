# Registration deadlines, post-payment kit edits, and the registration audit log

Date: 2026-08-08
Status: approved, ready for planning

## Problem

Organizers cannot close registration by date. The only way to stop entries today is to
manually flip `events.status` to `closed` — a human action someone has to remember to take
at 11:59pm. `isRegistrationClosed()` in `apps/site/lib/eventStatus.ts:5` is a pure status
check; no date is consulted anywhere in the codebase.

This matters because organizers need lead time before race day: printing bibs, ordering and
packing shirts, assembling kits. Registration has to stop well before the event so that work
can start against a frozen roster.

Shirt sizes need a related but *later* cutoff. A runner who picked the wrong size at checkout
should be able to correct it after paying — right up until the point where the shirts are
actually ordered. Today they cannot: there is no UPDATE grant and no UPDATE policy on
`registrations` (`supabase/migrations/20260718183018_registrations_payments.sql:63`), so a
paid registration is immutable to its owner. The only recourse is contacting the organizer,
who also has no UI for it.

And once runners can change their own paid registration, those changes need a record. The
codebase has no audit-log table of any kind. Refund audit data is merged into `payments.raw`
by `refund_registration_tx` (`supabase/migrations/20260723100000_money_txn_rpcs.sql:62-69`)
and no UI ever reads it.

## Scope

In scope:

1. Two optional deadline columns on `events`, set from the admin event editor.
2. Registration close enforced on the runner site and in the checkout edge function.
3. Runner self-service editing of kit and safety fields on a paid or pending registration,
   through a new security-definer RPC.
4. An append-only `registration_audit` table, written by that RPC and by the existing money
   RPCs, rendered as a history section in the admin registration drawer.

Out of scope, deliberately:

- Mobile (`apps/mobile`) edit UI. The rule lives in the RPC, so mobile calls the same
  function when it gets there; no logic is duplicated in the meantime.
- Notifying organizers when a size changes after kit prep has started.
- Backfilling audit rows for existing registrations. The timeline starts at deploy.
- Race kit release, QR scanning at pickup, and the marshal admin-console access blocker.
  These are a separate spec, to be written next.
- An admin UI for defining `form_fields`. None exists today; this spec does not add one.

## Approach

Deadlines are dates on the event, derived at read time and enforced server-side on write.
No scheduled job flips `status`.

The alternative considered was a `pg_cron` job that sets `status = 'closed'` when the
deadline passes, which would give every existing status reader deadline behaviour for free.
It was rejected because the deadline would only be as punctual as the job, a failed job fails
*open* (selling slots the organizer believes are closed), the date is still needed at read
time to render a countdown, and re-opening an event means fighting a date that keeps
re-closing it.

`status` keeps its current meaning: the organizer's manual override for closing early or
cancelling. A closed status always wins regardless of dates.

## Schema

```sql
alter table events
  add column registration_closes_at timestamptz,
  add column kit_edit_closes_at     timestamptz;

alter table events add constraint events_kit_edit_after_reg_close check (
  kit_edit_closes_at is null or registration_closes_at is null
  or kit_edit_closes_at >= registration_closes_at
);
```

Both nullable. NULL means "no deadline", so every existing event keeps its current
behaviour with no backfill.

The constraint exists because a kit cutoff earlier than the registration close creates a
runner who can never edit: they register on the final day into an already-frozen kit list.
That state is made unrepresentable rather than merely validated in the form.

Neither column is constrained relative to `event_date`. Same-day registration is legitimate
and the DB should not forbid it.

### Timezone

`timestamptz` stores an absolute instant. The admin form converts from the browser's local
timezone, which for a Philippine organizer is Asia/Manila. The resolved zone is displayed in
the form's helper text so the behaviour is visible rather than silent.

Known limitation: an organizer administering a Philippine race from another timezone would
set the deadline in their own local time. There is no `events.timezone` column and this spec
does not add one. Revisit if it becomes a real case.

### Audit table

```sql
create table registration_audit (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  event_id   uuid not null references events(id) on delete cascade,
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  actor_id   uuid references auth.users(id),
  actor_role text,
  created_at timestamptz not null default now()
);

create index registration_audit_reg_idx
  on registration_audit (registration_id, created_at desc);
```

`action` values used by this spec: `field_changed`, `paid`, `refunded`. Spec #2 will add
`kit_released`. The column is `text` rather than an enum specifically so that addition needs
no type migration.

`detail` for `field_changed` is `{"field": "shirt_size", "from": "M", "to": "L"}`. A `from`
of `null` means the field had no previous value.

`actor_role` is one of `runner`, `admin`, `system`.

RLS mirrors `registrations`: read-own (`auth.uid()` owns the parent registration) and
org-admin read via `auth_can_admin_org(org_id)`. `grant select` to `authenticated`,
`grant all` to `service_role`, and **no insert, update, or delete grant to anyone**. Rows
arrive only through security-definer functions — the same discipline as `notifications`
(`supabase/migrations/20260723090000_notifications_table.sql`).

## Field classification

Three categories, defined as lists in `packages/shared/src/index.ts` next to the existing
`PROFILE_KEYS` / `isProfileKey()` at line 43:

| Category | Keys | Editable until |
| --- | --- | --- |
| Kit | `shirt_size` | `kit_edit_closes_at` |
| Safety | `blood_type`, `emergency_contact` | no deadline |

| Immutable | everything else | never |

Kit fields freeze so shirts can be printed and packed. Safety fields never lock: stale
emergency-contact data is worse than none, and there is no operational benefit to freezing
it. This removes a date computation entirely — `events.event_date` is a `date` and
`events.flag_off` is a nullable `time`, so "until flag-off" would have required assembling
and casting a timestamp with ambiguous timezone semantics for no gain.

Everything not named above is immutable through this path, including `category_id`,
`total_amount`, and `status`. Organizer-defined non-profile fields (for example
`running_club`) are immutable in this spec.

`emergency_contact` means the profile key of that name
(`supabase/migrations/20260718182546_init_orgs_profiles.sql:28`). Organizer-defined companion
questions such as the emergency-contact relationship seen in seeded events are separate
`form_fields` rows and remain immutable.

The RPC repeats these lists in SQL. This mirrors an existing deliberate convention in the
codebase — `canCheckIn()` in `supabase/functions/_shared/authz.ts:17` and
`auth_can_check_in_event()` in `supabase/migrations/20260806150000_checkin_rpcs.sql:22` are
kept in sync by hand, as the migration header states. The duplication is safe here because
only the SQL list is load-bearing: the TypeScript list decides what renders as editable, and
if the two drift, the UI offers an edit that the RPC refuses with a clear error. No write
is ever granted by the client-side list alone.

## The edit RPC

```sql
create function public.update_registration_fields_tx(
  p_registration_id uuid,
  p_changes         jsonb
) returns text
language plpgsql
security definer
set search_path = ''
```

The function takes **no actor parameter**. It reads the caller's identity from `auth.uid()`
internally. An actor parameter would be a privilege-escalation hole: the function is granted
to `authenticated` and called directly from the browser, so any signed-in user could pass
another runner's uid and edit that runner's registration. The caller's identity must come
from the JWT, never from an argument.

Return values: `ok`, `not_found`, `forbidden`, `not_editable`, `locked`, `invalid_value`,
`no_change`.

Behaviour, all inside one transaction:

1. `select ... from public.registrations where id = p_registration_id for update` — the same
   row-lock discipline as `confirm_payment_tx`
   (`supabase/migrations/20260723100000_money_txn_rpcs.sql:18`).
2. Load the parent event's `kit_edit_closes_at`.
3. Authorize: `auth.uid()` owns the registration, or `public.auth_can_admin_org(org_id)` is
   true. Otherwise `forbidden`. A null `auth.uid()` (unauthenticated call) is `forbidden`.
4. Reject unless `registrations.status` is `pending` or `paid`. A refunded or cancelled
   registration returns `not_editable`.
5. For each key in `p_changes`:
   - Immutable key → `invalid_value`.
   - Kit key, actor is not an org admin, `kit_edit_closes_at` is non-null and in the past
     → `locked`.
   - Value not in the canonical list for that key (`SHIRT_SIZES`, `BLOOD_TYPES`) →
     `invalid_value`.
6. Merge accepted changes into `registrations.custom_data`.
7. Insert one `registration_audit` row per changed field, with `actor_role` set to `admin`
   when the actor is an org admin and `runner` otherwise.
8. Return `no_change` if every submitted value already equals the stored value. No audit
   rows are written in that case.

Any rejection aborts the whole call — a `p_changes` containing one valid and one invalid key
writes nothing.

Grants: `revoke all from public`, `grant execute to authenticated`. The site calls this
directly; no new edge function is needed. Authorization lives inside the function because
RLS is row-level and cannot express "you may write this JSONB key but not `total_amount`" —
the same reasoning documented at `supabase/migrations/20260806150000_checkin_rpcs.sql:3-7`.

Org admins are never deadline-bound. Every admin edit is recorded with the admin as actor,
which is what makes the override safe to grant.

### Existing RPCs

`confirm_payment_tx` and `refund_registration_tx` each gain one `insert into
registration_audit` writing a `paid` / `refunded` row with `actor_role = 'system'` and
`actor_id` set to the refunding admin where known. This is what turns the table from a
field-change log into a usable timeline, and it surfaces refund audit data that has been
written to `payments.raw` and rendered nowhere.

## Registration close enforcement

`isRegistrationClosed()` in `apps/site/lib/eventStatus.ts:5` changes from taking a status to
taking the event, and returns true when the status is one of `cancelled`, `closed`,
`completed` **or** `registration_closes_at` is non-null and in the past. Every caller already
routes through this function.

`registrations-checkout` re-checks the same condition server-side before creating a
registration. The client's opinion about the current time decides only what to render.

## UI

### Admin event editor

`apps/web/src/routes/EventEditor.tsx`, alongside the existing Date / End date / Flag-off /
Status / Cutoff-hours inputs: two optional `datetime-local` fields, "Registration closes" and
"Kit edits close". Helper text states that empty means no deadline, and names the resolved
timezone. Client-side validation mirrors the DB constraint, with the message rendered below
the second field rather than at the top of the form.

### Runner: race kit card

Lives on the ticket page, `apps/site/app/ticket/[registrationId]/TicketPanel.tsx` — the
per-registration screen, which places kit contents directly beneath the QR code the runner
presents at pickup. This is the pairing spec #2 builds on.

Open state: card titled "Race kit", current shirt size rendered large, a "Change" button, a
days-remaining chip, and the cutoff spelled out ("Sizes lock Aug 25, 11:59pm"). Existing
add-ons list below.

Locked state: same card, a "Locked" chip, the size shown without a change affordance, and a
lock icon. The locked state is never signalled by dimming alone — colour-only state fails
low-vision users and reads as broken rather than closed.

Change sheet: reuses the `SHIRT_SIZES` pill selector from
`apps/site/app/register/[categoryId]/RegisterWizard.tsx:223`, at a minimum 44px target
height.

Editing a registration does not write back to `profiles`. `custom_data` is deliberately a
snapshot taken at checkout (`supabase/functions/registrations-checkout/index.ts:49-53`), and
this spec preserves that.

### Runner: event page

The closed state already renders correctly through `isRegistrationClosed()`. What is new is
the pre-deadline state: a line near the register CTA reading "Registration closes Aug 20",
switching to relative form ("Closes in 3 days") within the final seven days.

### Admin: history section

`apps/web/src/components/RegistrationDetail.tsx`, inserted after the registration-fields
block at line 56 and above the `mt-auto` refund footer.

Entries are grouped by date. A `field_changed` entry shows the field label, then the old
value struck through, an arrow, and the new value highlighted, then actor and time. An
absent previous value renders as "empty". `paid` and `refunded` entries collapse to a single
line so the section does not grow tall.

Showing the previous value is the point of the section: when an organizer reconciles printed
shirts against a roster, `M → L` is the answer and "shirt size changed" is not.

Adjacent fix, in the same file: the fields block currently renders raw JSONB keys as labels
(`shirt_size`) at line 54. A label map for the profile keys plus a snake_case prettifier
gives both the fields block and the history section human labels.

## Error handling

The boundary race is the case that matters. A runner opens the ticket page at 11:58pm and
taps save at 12:01am; the RPC returns `locked`, and the UI swaps to the locked state and
refetches rather than showing a generic failure. The same shape applies at checkout: if the
deadline passes between page load and submit, the checkout function rejects and the wizard
renders the closed state.

Return-value mapping on the site:

| RPC result | Runner sees |
| --- | --- |
| `locked` | "Shirt sizes closed on Aug 25. Contact the organizer." Card re-renders locked. |
| `not_editable` | "This registration can no longer be changed." |
| `forbidden`, `not_found` | Generic failure; refetch the registration. |
| `invalid_value` | Generic failure. Not reachable from the UI; indicates client/server list drift. |
| `no_change` | Sheet closes silently. |

## Testing

Following the existing vitest setup in `apps/web/src/__tests__/checkin-result.test.ts`.

Unit:

- `isRegistrationClosed` across the matrix: no deadline, deadline in the future, deadline in
  the past, and a closed status with a future deadline (status must still win).
- Field classification: each key resolves to the expected category; an unknown key is
  immutable.
- Return-value to message mapping.

Database / integration:

- Owner edits a kit field before the cutoff → `ok`, one audit row.
- Owner edits a kit field after the cutoff → `locked`, no audit row, `custom_data` unchanged.
- Org admin edits a kit field after the cutoff → `ok`, audit row with `actor_role = 'admin'`.
- Non-owner, non-admin → `forbidden`, nothing written. This is the privilege-escalation
  test: a signed-in runner calling the RPC against another runner's registration id.
- Invalid shirt size → `invalid_value`.
- Safety field edited after the kit cutoff → `ok`.
- Immutable key in `p_changes` → `invalid_value`, nothing written.
- Mixed valid and invalid keys → nothing written.
- Two changed fields in one call → exactly two audit rows.
- Submitting the current value → `no_change`, zero audit rows.
- Refunded registration → `not_editable`.
- `events_kit_edit_after_reg_close` rejects a kit cutoff earlier than the registration close.
- `confirm_payment_tx` and `refund_registration_tx` each write their audit row.

## Migration order

1. `events` columns and constraint.
2. `registration_audit` table, indexes, RLS, grants.
3. `update_registration_fields_tx`.
4. Audit inserts added to `confirm_payment_tx` and `refund_registration_tx`.

Each is additive. Nothing in steps 1–4 changes existing behaviour until the UI ships.
