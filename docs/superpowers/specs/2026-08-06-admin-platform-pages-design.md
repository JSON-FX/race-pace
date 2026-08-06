# Five admin console pages — Dashboard, Check-in, Organizations, Commission, Payouts

**Date:** 2026-08-06
**Status:** approved, ready for planning
**Design direction:** B — Context-Shifted
**Mockups:**
`2026-08-06-platform-pages-design-directions.html` ·
`2026-08-06-checkin-scanner-first.html` ·
`2026-08-06-commission-payouts-money-flow.html`

---

## 1. Why

`apps/web` ships seven working admin pages. Five more exist only as 12-line `ComingSoon`
stubs: check-in, dashboard, organizations, commission, payouts. The backend for most of
them landed during the Next.js migration and is already applied to the hosted database —
what never landed is the UI.

This spec covers all five, plus two defects found while scoping them.

### Starting point

| Page | Backend today | Gap |
| --- | --- | --- |
| Dashboard | `admin_org_totals_v`, `admin_event_totals_v` | no sign-ups time series |
| Check-in | `checkin_events()`, `checkin_roster()`, `check-in` Edge Function | undo; roster is unused |
| Organizations | `organizations` table | provisioning needs a service-role Edge Function |
| Commission | `commission_rate`, applied in `_shared/confirm.ts:25` | no super-admin UPDATE policy |
| Payouts | — | `payout_statements` does not exist |

> **Branch note.** The worktree this was designed in
> (`.claude/worktrees/event-registration-web-fff722`) is 56 commits behind `main` and still
> contains the pre-migration Vite `apps/web`. All work branches from `main`.

---

## 2. Design direction: B — Context-Shifted

Three directions were mocked. B was chosen.

The console keeps one visual language for everything read at a desk. Two contexts get a
deliberate shift, because they genuinely differ:

**Check-in goes dark and full-bleed.** It is the only console screen used outdoors, before
sunrise, one-handed. The dark surface stops the screen blinding the marshal, the scan
result is the largest element, and the running count is legible at arm's length. It reuses
`--forest`, already in the token set — no new colour is introduced.

**Platform pages wear a scope band.** Organizations, Commission and Payouts show every
org's data; every other page shows one org's. Without a marker, ₱2.18M on Organizations and
₱1.41M on Dashboard look like the same kind of number in the same kind of table. The band
is the cheapest available guard against reading a platform total as an org total.

Everything else — KPI row, `rounded-xl` cards, `shadow-card`, 21px page titles, tabular
numerals — follows Registrations and Payments exactly.

### Rejected

- **A (One Console)** — safe, but gives race-day check-in the same white desktop treatment
  as a finance table. That is a usability failure, not a stylistic preference.
- **C (Bento Ops)** — best-looking dashboard of the three, but introduces a second layout
  language for a page users glance at rather than live in, and its live feed needs a
  Realtime subscription nothing else in the admin uses.
- **`ui-ux-pro-max`'s recommended palette** (blue `#1E40AF`) — rejected in favour of the
  established trail-green system, per that skill's own §4 `consistency` rule. Its
  structural guidance was taken: dense grid, line chart for trends, bullet bars for fill
  rate (the one KPI with a real target).

---

## 3. Dashboard

Org-scoped. A super admin sees whichever org the switcher has selected — one page, one
query shape, consistent with every other org-scoped page. Platform-wide numbers live on
Organizations and Commission.

**Layout:** KPI row (4) → sign-ups chart + fill-rate panel (2 col) → upcoming events table.

| KPI | Source |
| --- | --- |
| Registrations | `admin_org_totals_v.reg_count` |
| Gross revenue | `admin_org_totals_v.gross_revenue` |
| Net to org | `admin_org_totals_v.net_to_org` |
| Awaiting payment | `admin_org_totals_v.pending_count` |

**Sign-ups over time** — daily counts for 30 days. Needs a new aggregate (§9.2). Rendered
as hand-rolled SVG (~30 lines, as in the mockup), not a chart library: one series, no
zoom, no legend. Recharts is ~90 KB for a sparkline. Revisit if a second chart appears.

**Fill rate** — bullet bars per open event. Capacity is `sum(categories.slots_total)` for
the event; taken is `sum(slots_taken)`. Events with no `slots_total` are omitted rather
than shown at 0%.

**Empty state** — a new org with no events gets a create-first-event prompt, not four zeros.

---

## 4. Check-in

### Input ladder

Three inputs, always present, not modes to switch between:

1. **Hardware 2D imager (primary).** A USB/Bluetooth scanner is a keyboard wedge: it types
   the token and presses Enter into a permanently-focused hidden field. No driver, no
   decode library, no camera permission, no HTTPS prompt.
2. **Device camera (fallback).** `getUserMedia` + jsQR. Works with a phone rear camera,
   laptop webcam or USB webcam. Fixed-focus webcams struggle at 10–20 cm against screen
   glare — usable, but the weakest input.
3. **Manual tap in roster (always available).** The only path that needs no hardware, and
   the only one that works for a dead phone or a cracked screen.

**Scanner requirements to document for the operator:** must be a 2D imager — a 1D laser
physically cannot read a QR. The ticket token is 188 chars of base64url
(`_shared/ticket.ts`), well within QR capacity; a wedge types it in ~0.2–2 s.

**Keyboard-layout hazard.** On a non-US layout a wedge can mistranslate the `-` and `_`
that base64url uses. Input is validated against `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` before
submission, and a failure shows "scanner layout may be wrong" rather than "invalid ticket".

### Verification stays server-side

Every scan posts to the existing `check-in` Edge Function. `checkin_roster()` returns each
runner's `ticket_token`, so matching client-side would be faster — but the function is the
only thing that verifies the HMAC signature, and client-side matching would accept a
screenshot of someone else's QR. ~200 ms is the right price.

### Roster

One `checkin_roster(event_id)` call feeds both tables, split on whether `checked_in_at` is
null. Search and category filters run client-side over rows already in memory — instant, no
round trip. This also makes the roster an offline safety net for free: rows are already
local, so a dropped connection degrades to a failed write, not a dead page.

| Table | Contents |
| --- | --- |
| Not yet checked in | runner, bib, category, payment status, **Check in** button |
| Recently checked in | runner, category, time, input source, **Undo** button |

### Rules

- **Unpaid entries render as Blocked, not checkable.** The Edge Function already returns
  `not_paid` (409); the row reflects a rule the server enforces rather than inventing one.
- **A re-scan shows amber, not green.** The function returns `already: true` on a duplicate
  (unique-violation branch). Surfaced as "already checked in at 08:14" so a double-scan
  never reads as a fresh success.
- **Undo** deletes the `checkins` row. Needs a new RPC (§9.2) — there is no delete path today.

### Deferred

Offline queue (IndexedDB + flush on reconnect) is **not** in this pass. The roster fallback
covers the common failure. The left column is laid out so a queue-status strip drops in
without rework.

---

## 5. Money model

Race Pace is the merchant of record. This drives Commission and Payouts.

```
Runner pays ₱2,000 for ONE registration
  → PayMongo → Race Pace's account (one platform account; the org never touches funds)
  → at confirmation, the org's fee is struck ON THAT REGISTRATION and FROZEN onto the payment row
      payments.platform_fee = ₱200,  payments.net_to_org = ₱1,800
  → super admin later transfers ₱1,800 to the org, per event, off-platform
  → the console records that transfer
```

**Commission is charged per registration.** This is already the behaviour —
`_shared/confirm.ts:26` computes the fee against a single registration's `total_amount`.
No change needed to *when* the fee is struck.

**A fee may be a percentage or a flat amount.** This *is* a change. Today
`organizations.commission_rate` is a lone `numeric default 0.10`, so a fixed peso fee per
entry cannot be expressed. See §9.5.

**Commission is never retroactive.** The fee is written onto the payment row at
confirmation, so changing an organization's commission applies from the next registration
onward. Correct for money, but must be stated on the page — an operator changing a rate
will otherwise assume it applies to existing payments.

**The payout unit is an event, not a calendar month.** This supersedes the earlier
"monthly periods" decision. A month boundary would split one race weekend's money across
two statements.

---

## 6. Organizations

Super-admin only. Scope band, KPI row, table of every org: events, registrations, GMV,
rate, status.

**Provisioning** creates the organization *and* invites its first admin, via a new
`org-provision` Edge Function (service role). An org row nobody can log into is inert, and
`/team` is unreachable until someone can.

The invite reuses `auth.admin.inviteUserByEmail`, exactly as `org-members/index.ts:87`
already does. That call sends through whatever SMTP Supabase is configured with — so the
email path is **ready now and starts working the moment SMTP is configured, with no code
change**. Until then the response includes the action link for manual delivery.

Slug uniqueness is enforced by the existing constraint; the form checks availability on
blur rather than failing on submit.

Deactivate / reactivate / ownership transfer are **out of scope** — they interact with
in-flight registrations and open statements in ways needing their own design.

---

## 7. Commission

Super-admin only. Scope band, KPI row (commission earned, GMV, effective rate, passed to
orgs), then two tables.

**Fee per organization** — each row carries a **type toggle (% / ₱)** and a value, saved per
row. The fee applies to every single registration, so the row also shows the other form as
a reference (`≈ ₱110 on a ₱1,100 average entry`, or `≈ 6.9% of a ₱1,094 average entry`),
which is how an operator compares an offer to the org's existing terms.

Below it, a persistent amber strip naming the consequence concretely: *"Switching
RunWithPoint to a flat ₱75 per registration affects entries paid from now on. Their 702
existing payments keep the 10.0% they were charged at."*

**Commission by event** — where the fee actually came from: event, org, paid count, gross,
fee charged (`10.0% each` / `₱75 flat each`), commission.

Writes need a super-admin UPDATE policy on the commission columns (§9.3).
`20260724140000_scope_org_update_grant.sql` scoped the column grant; verify with
`has_column_privilege` before assuming it covers the new columns — hosted `organizations`
has had table-level grant drift before.

**Validation:**

- Percent: 0–100, stored as the existing numeric fraction (`0.10` = 10%). The UI works in
  percent and converts; the DB never sees `10` meaning 10%.
- Flat: integer centavos, `>= 0`.
- **Flat-fee warning.** If a flat fee exceeds the cheapest `categories.base_price` across
  the org's open events, the row shows a red strip naming that category. The fee still
  clamps server-side (§9.5), but a silent clamp is worse than a visible one — the operator
  should know they have set a fee that earns the organizer nothing on some entries.

---

## 8. Payouts

Super-admin only. One statement per event. Gross → commission → refunds → net owed.

**Opening is manual.** The super admin cuts a statement whenever they choose — no automatic
gate on event completion. Events still running show as **Held** with the reason, greyed
rather than hidden, so "where's my money for Dumalinao?" can be answered off the screen.
Opening one for an unfinished event is allowed but confirms first.

**Double-payment is prevented structurally, not by timing.** Marking a statement paid
stamps `payout_statement_id` onto every payment row it covered. The next statement for that
event picks up only unstamped rows. So:

- the same peso can never be paid twice, whenever a statement is opened;
- opening mid-registration is safe — a later top-up statement catches what arrived after;
- each transfer has an audit trail of exactly which payments it settled.

**Refunds** reduce net owed while a statement is open. A refund arriving after a statement
is paid cannot retroactively change it — it lands unstamped and nets against the event's
next statement. If none follows, it surfaces as a negative balance for manual resolution.
This is the accepted cost of manual opening.

---

## 9. Schema and backend changes

### 9.1 `payout_statements` (new)

```sql
create table payout_statements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id),
  event_id          uuid not null references events(id),
  gross_cents       bigint not null,
  commission_cents  bigint not null,
  refunds_cents     bigint not null,
  net_owed_cents    bigint not null,
  status            text not null default 'open' check (status in ('open','paid')),
  reference         text,              -- bank transfer ref, entered on mark-paid
  note              text,
  opened_by         uuid not null references auth.users(id),
  opened_at         timestamptz not null default now(),
  paid_at           timestamptz,
  paid_by           uuid references auth.users(id)
);

-- at most one OPEN statement per event; paid ones accumulate as history
create unique index payout_statements_one_open_per_event
  on payout_statements (event_id) where status = 'open';
```

Plus `alter table payments add column payout_statement_id uuid references payout_statements(id)`,
indexed, null = not yet settled.

**How each amount is derived**, over payments for the event where `payout_statement_id is null`:

| Column | Derivation |
| --- | --- |
| `gross_cents` | `sum(amount) filter (where status = 'paid')` |
| `commission_cents` | `sum(platform_fee) filter (where status = 'paid')` |
| `refunds_cents` | `sum(net_to_org) filter (where status = 'refunded')` |
| `net_owed_cents` | `gross − commission − refunds` |

Refunds subtract `net_to_org`, not `amount`: the organizer is only clawed back what they
were credited. Whether the platform also refunds its `platform_fee` on a refunded entry is
a **commercial decision, not a technical one** — the arithmetic above assumes it keeps the
fee. Flag before implementing if that is wrong.

RLS: super-admin only, via `auth_is_super_admin()`. Amounts are integer centavos, matching
`payments.amount`.

### 9.2 RPCs

| RPC | Purpose |
| --- | --- |
| `payout_open_statement(p_event_id)` | sums unstamped payments for the event, inserts the statement. Security definer — the write must be atomic with the read. |
| `payout_mark_paid(p_statement_id, p_reference, p_note)` | sets status/paid_at/paid_by **and** stamps `payout_statement_id` on covered payments, in one transaction. |
| `admin_org_signups_daily(p_org_id, p_days)` | dashboard time series |
| `checkin_undo(p_registration_id)` | deletes the `checkins` row, authorized by `auth_can_check_in_event` |

The two payout RPCs follow the existing security-definer money pattern from
`20260723100000_money_txn_rpcs.sql`. Money transitions must not be two round trips.

### 9.3 Commission UPDATE policy

Super-admin UPDATE on `organizations.commission_rate`. Verify the column grant with
`has_column_privilege` first — this exact class of drift bit the branding editor before.

### 9.4 `org-provision` Edge Function (new)

Service role. Creates the org, invites the first admin via
`auth.admin.inviteUserByEmail`, assigns an `admin` role bound to the new `org_id`. Rejects
non-super-admin callers. Returns the action link so provisioning works before SMTP exists.

### 9.5 Percentage-or-flat commission (new)

```sql
alter table organizations
  add column commission_type text not null default 'percent'
    check (commission_type in ('percent', 'fixed')),
  add column commission_flat_cents integer not null default 0
    check (commission_flat_cents >= 0);
```

`commission_rate` stays as-is and keeps its meaning for `commission_type = 'percent'`.
Existing rows default to `'percent'`, so behaviour is unchanged until a rate is edited —
no backfill, no migration risk to live money.

`_shared/confirm.ts` branches on the type:

```ts
const fee = org.commission_type === "fixed"
  ? Math.min(org.commission_flat_cents, reg.total_amount)
  : Math.round(reg.total_amount * rate);
```

**The clamp is not optional.** A flat fee larger than the entry price would make
`net_to_org` negative — the organizer owing the platform money for a sale. `Math.min`
caps the fee at the entry total, so net floors at zero. This also handles a ₱0 entry
(a free event or a fully-discounted comp) without a special case.

Both branches already round to whole centavos, so `platform_fee + net_to_org` continues to
equal `amount` exactly and the payout arithmetic in §9.1 is unaffected.

The `select` in `confirm.ts:18` must be widened to fetch the two new columns — currently
it requests only `organizations(commission_rate)`, so a missed edit here fails silently
into the `?? 0.10` percent default rather than erroring.

### 9.6 Super-admin org context (blocking prerequisite)

The org switcher exists only on the stale Vite worktree. In the Next.js admin,
`admin@racepace.test` currently gets "No organization on this account" on every org-scoped
page, so Dashboard and Check-in are unreachable for a super admin.

Port it cookie-based rather than `localStorage`: `apps/web` reads roles in Server
Components (`lib/queries/roles.ts`), which cannot see `localStorage`. A cookie is readable
server-side, so the selected org survives SSR without a client round trip.

The pure `pickActiveOrg(orgIds, stored)` logic and its seven tests port unchanged — it
already validates a stored id against the available list rather than trusting it.

---

## 10. Two defects found while scoping

### 10.1 `payment-verify` records the wrong payment method

`payment-verify/index.ts:52` calls `confirmPayment(registrationId, "paymongo", …)` — the
provider, not the instrument. `payments-webhook/index.ts:28` gets it right, reading
`payments[0].attributes.source.type` (`gcash` / `card` / `paymaya`). The single live paid
row reads `"paymongo"`, confirming the redirect path is the common one.

`payment-verify` already fetches that session via `pmGetCheckoutSession(ref)`, so this is a
field extraction in one function.

### 10.2 Method backfill

Existing `"paymongo"` rows are recoverable: each stores the session in `payments.raw`, so a
one-off migration can re-read `source.type` and correct history. Worth doing while the
table is small.

**Both must land before the Payments method column**, or the column reads "paymongo" on
every redirect-confirmed row and tells the user nothing.

---

## 11. Payments method column

`admin_payments_v` already selects `p.method` — no view change. The page renders a Method
cell: brand mark plus label, using the same PNGs as the public site
(`apps/site/components/PaymentLogos.tsx`) so one GCash mark appears across the product.
Card rows show the scheme where known. Unpaid rows show "Not yet paid", not a blank cell.

A method filter joins the existing event/status filters. Filter values come from the
distinct set actually present, not a hardcoded list — PayMongo can add instruments.

---

## 12. New dependencies

| Dependency | Size | For | Avoidable? |
| --- | --- | --- | --- |
| `jsqr` | ~40 KB | camera fallback decode | no, if camera is supported |
| chart library | ~90 KB | sign-ups chart | **yes — avoided.** Hand-rolled SVG |

`BarcodeDetector` is native and needs no library, but Safari does not ship it, so jsQR
remains the portable path.

---

## 13. Out of scope

- Offline check-in queue (roster fallback covers the common case)
- Org deactivate / reactivate / ownership transfer
- Automated payout disbursement — MVP transfers are off-platform by design
- Immutable statement line items — `payout_statement_id` stamping gives the audit trail
  without a second table
- Backend test fixtures in `supabase/tests/` still pin pre-reseed ids (9 files, 50 tests).
  Unrelated to this work; tracked separately.

---

## 14. Testing

- **Pure logic, unit:** `pickActiveOrg`, rate ↔ percent conversion, token-shape validation,
  roster split and client-side filters, statement arithmetic (gross − commission − refunds)
- **Fee calculation, unit** — the highest-value tests here, because they guard live money:
  percent and flat both round to whole centavos; `platform_fee + net_to_org == amount` for
  every case; a flat fee **above** the entry total clamps so `net_to_org` is 0 and never
  negative; a flat fee on a ₱0 entry yields a ₱0 fee; an org row left at the default still
  computes 10% exactly as before the migration
- **RPCs, pgTAP:** `payout_open_statement` excludes already-stamped payments; a second open
  statement for the same event violates the partial unique index; `payout_mark_paid` stamps
  every covered row; `checkin_undo` refuses a caller without `auth_can_check_in_event`
- **Tenant isolation:** an org admin reading `payout_statements` gets zero rows; a
  non-super-admin `UPDATE` of `commission_rate` changes zero rows
- **E2E (Playwright):** provision an org end to end; open and mark a statement paid; check a
  runner in via the roster path (no camera needed — this is why the manual path matters for
  testability as well as for race day)
