# Three-party commission: Race Pace, PayMongo, and the organizer

**Date:** 2026-08-11
**Status:** approved, ready for planning
**Supersedes:** `2026-08-06-admin-platform-pages-design.md` §5 (refund commission reversal)

---

## 1. Why

The ledger has two parties. It needs three.

Today `payments` stores `amount`, `platform_fee` and `net_to_org`. PayMongo's processing
fee appears nowhere. Race Pace's 10% commission silently absorbs it, so the platform's real
margin on a card payment is 10% − 3.5% − ₱15 and nobody can see that without a calculator.

Race Pace should earn a clean 3%. That is impossible to express while PayMongo's cost is
invisible, because "3%" would mean 3% minus an unknown number.

This spec adds the processor as an explicit party, gives organizations a choice about who
bears the processing cost, and makes every peso traceable from what the runner paid to what
the organizer receives.

### Two settlement modes

An organization is on one of two modes, set by the super admin:

| Mode | Runner pays | Organizer receives |
| --- | --- | --- |
| `absorb` | the sticker price | entry − 3% − processing |
| `pass_on` | sticker price + fees, grossed up | the full sticker price |

### Rates are VAT-exclusive at source

The rate card in circulation is quoted ex-VAT. Every figure × 1.12 lands on PayMongo's
published rate:

| Ex-VAT (as quoted) | × 1.12 | Published |
| --- | --- | --- |
| 3.125% + ₱13.39 | 3.50% + ₱15.00 | cards, local |
| 4.02% + ₱13.39 | 4.50% + ₱15.00 | cards, international |
| 1.34% | 1.50% | QR Ph, GCash, Maya, BillEase |
| 0.71% | 0.80% | direct online banking |

**Everything stored and displayed is VAT-inclusive**, because that is what actually leaves
the account. Publishing the ex-VAT number and deducting the VAT-inclusive one is exactly
the reconciliation failure this spec exists to prevent.

---

## 2. The core insight

PayMongo settles net. On a ₱2,000 payment, ₱1,970 arrives — never ₱2,000. And PayMongo
reports what it took: the checkout session's embedded `payments[].attributes` carries
`fee` and `net_amount` as integers in centavos, and `_shared/paymongo.ts` already fetches
and stores that entire payload in `payments.raw`.

So one formula covers both modes:

```
net_to_org = PayMongo's net_amount − Race Pace's commission
```

Both inputs are certain. One is a number PayMongo hands us; the other is a number we set.
**Nothing about the ledger is estimated.**

This is the answer to rate drift. If PayMongo changes its pricing tomorrow, the ledger is
still exactly right the same day, because it records what was actually charged rather than
what we predicted would be. Correctness does not depend on anyone noticing a pricing
announcement.

---

## 3. Schema

### 3.1 `payments`

```sql
alter table payments
  add column if not exists processor_fee_cents integer not null default 0
    check (processor_fee_cents >= 0),
  add column if not exists processor_fee_predicted_cents integer,
  add column if not exists processor_fee_source text not null default 'none'
    check (processor_fee_source in ('actual', 'predicted', 'none'));
```

- `processor_fee_cents` — what PayMongo actually took. The only figure the ledger trusts.
- `processor_fee_predicted_cents` — what the rate card said. Kept solely to detect drift.
- `processor_fee_source` — `actual` once read from PayMongo, `predicted` while awaiting
  reconciliation, `none` for rows that predate this work.

Frozen at confirmation alongside `platform_fee`, so a rate change is never retroactive.

### 3.2 `organizations`

```sql
alter table organizations
  add column if not exists fee_mode text not null default 'absorb'
    check (fee_mode in ('absorb', 'pass_on'));
```

Independent of `commission_type` and `commission_rate`. An org can be on a flat peso
commission *and* pass-on mode. Mode and rate are negotiated separately, so they are stored
separately.

The two live organizations keep their existing 10% `percent` terms. `3%` becomes the
default for organizations created from here on, expressed as a changed column default —
not a backfill. Same reasoning as `20260807090100_commission_and_refund_policy.sql`: a
default is for rows that do not exist yet.

### 3.3 `processor_rates`

The rate card is data, so it can be corrected without a deploy.

```sql
create table processor_rates (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null default 'paymongo',
  method         text not null,
  scope          text not null default 'local'
                   check (scope in ('local', 'international')),
  percent_bps    integer not null check (percent_bps >= 0),  -- VAT-INCLUSIVE. 350 = 3.50%
  fixed_cents    integer not null default 0 check (fixed_cents >= 0),
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  note           text,
  created_by     uuid references auth.users(id)
);

create unique index processor_rates_one_current
  on processor_rates (provider, method, scope) where effective_to is null;
```

Versioned by effective date, so a prediction made in August stays explainable in December.
Lookup selects the row where `effective_from <= paid_at < coalesce(effective_to, 'infinity')`.

Seed, VAT-inclusive:

| method | scope | percent_bps | fixed_cents |
| --- | --- | --- | --- |
| `card` | local | 350 | 1500 |
| `card` | international | 450 | 1500 |
| `gcash` | local | 150 | 0 |
| `paymaya` | local | 150 | 0 |
| `qrph` | local | 150 | 0 |
| `dob` | local | 80 | 0 |
| `billease` | local | 150 | 0 |

Only `card`, `gcash` and `paymaya` are reachable today — `METHOD_MAP` in
`payment-session/index.ts` offers no others. The rest are seeded so that enabling a method
is a UI change rather than a schema change.

The `dob` figure is the least certain of the seven: the source quotes "~0.71% **or** ₱13.39,
varies by partnered bank", which are different shapes, not a range. It is seeded as a
percentage and will be corrected by §5 from real settlements before the method is enabled.

GrabPay and ShopeePay are deliberately absent. Their quoted 1.34–2.2% ex-VAT is a range
across integration tiers rather than a rate, so seeding either end would be a guess. They
get a row once a real settlement establishes which tier applies.

### 3.4 `payout_statements`

```sql
alter table payout_statements
  add column if not exists processing_cents bigint not null default 0;
```

---

## 4. Where the arithmetic runs

### 4.1 Absorb mode

Nothing changes at checkout. The runner pays the sticker price.

At confirmation, `_shared/confirm.ts` computes `platform_fee` from the org's terms exactly
as it does today, reads `processor_fee_cents` from the PayMongo payload, and writes
`net_to_org = amount − processor_fee_cents − platform_fee`.

### 4.2 Pass-on mode

The surcharge is computed in `payment-session`, at the moment the runner picks a method and
the scoped session is recreated. That recreate already exists; no new step in the flow.

PayMongo charges its percentage on the *final* amount, so the fee must be grossed up rather
than added. Integer arithmetic throughout — no floats in money math:

```
target = base_total + platform_fee
charge = ceil((target + fixed_cents) * 10000 / (10000 - percent_bps))
```

`base_total` is `registrations.total_amount` — entry fee plus add-ons, the figure the
organizer priced and the same figure absorb mode charges.

Race Pace's commission is struck on the **base the organizer priced**, not on the grossed-up
total. A ₱2,000 event yields the organizer ₱2,000 and Race Pace ₱60 whatever the runner
chooses.

Worked, ₱2,000 base at 3%:

| Method | Charge | PayMongo takes | RP | Organizer |
| --- | --- | --- | --- | --- |
| GCash (1.50%) | ₱2,091.38 | ₱31.37 | ₱60.00 | ₱2,000.01 |
| Card (3.50% + ₱15) | ₱2,150.26 | ₱90.26 | ₱60.00 | ₱2,000.00 |

`ceil` puts the sub-centavo remainder on the organizer's side rather than Race Pace's — at
most ₱0.01 per transaction, and never a shortfall.

Naive addition instead of gross-up would charge ₱2,147.10 for the card case and come up
₱3.16 short on every single card payment.

### 4.3 The international card gap

Whether a card is international is unknowable before it is charged. Pass-on mode predicts
`local` and PayMongo may charge `international`: on the ₱2,150.26 above, a foreign card
costs ₱111.76 instead of ₱90.26.

**Race Pace absorbs the ₱21.50.** The organizer still receives their full ₱2,000; Race
Pace's ₱60 becomes ₱38.50. Race Pace chose the prediction, so Race Pace carries its error.
The shortfall is visible per-transaction and totalled on the Commission page.

Charging the international rate to everyone to be safe would overcharge the overwhelming
majority of runners to protect against a minority, which is worse.

---

## 5. Rate drift

The rate card touches exactly two things: the pass-on surcharge, and estimates shown to
humans. **It never touches the ledger.** So drift cannot make a report wrong — it can only
make a pass-on charge under- or over-collect.

Every confirmation stores predicted alongside actual, which makes drift measurable from
real money:

```
implied_bps = (processor_fee_cents − fixed_cents) * 10000 / amount
```

A view `processor_rate_drift_v` aggregates the last 20 payments per `(method, scope)` and
reports the median implied rate against the card. Where at least 80% disagree by more than
₱1 in the same direction, the Commission page raises:

> **Card rate appears to have changed.** The last 14 of 14 card payments cost 3.80%; the
> rate card says 3.50%. Under-collected ₱90.30 across those payments. **[Review rates]**

Detection comes from the platform's own transactions within hours. No one has to watch
PayMongo's pricing page.

Shortfalls land on Race Pace, never the organizer: the organizer receives what was
promised, and the gap appears as a Race Pace line on the platform report — visible to the
only party who can fix it.

---

## 6. Refunds

**The runner is refunded exactly what the organizer would have been paid.**

That single sentence is the policy, and it is not a coincidence: both quantities are
`amount − platform_fee − processor_fee_cents`, so `refund == net_to_org` holds by
definition.

Race Pace's commission is an earned service fee and is not returned. PayMongo does not
return its fee under any circumstances.

₱2,000 GCash entry, `full` policy:

| | |
| --- | --- |
| Runner receives | ₱1,910 |
| Race Pace keeps | ₱60 |
| PayMongo kept | ₱30 |
| Organizer returns | ₱1,910 |

In pass-on mode the same rule returns the base entry fee exactly — the runner gets their
₱2,000 back and loses only the fees, which is a policy that can be published without
argument: *your entry fee is refundable; service and processing fees are not.*

### 6.1 What this supersedes

`2026-08-06-admin-platform-pages-design.md` §5 states that a refund reverses the commission
too, so neither party keeps anything. That rule is replaced. The commission is now earned at
capture and retained on refund. This is a deliberate commercial decision, recorded here so
the divergence is not later mistaken for drift.

The `flat_fee` policy's "retained amount is a smaller sale" rule goes with it. Race Pace has
already kept its full commission, so re-striking commission on the organizer's retention
would charge twice for one sale. An organizer's retention is theirs entirely.

### 6.2 Code changes

**`_shared/refund.ts`** — `refundAmount` becomes `net_to_org − retained` instead of
`pay.amount − retained`. `retained` clamps to `net_to_org`, not to `amount`: an organizer
cannot retain money they were never going to receive. `computeFee(retained, org)` is
deleted along with the `retainedFee` it produced.

**`refund_registration_tx`** — the full-refund branch is unchanged; it already preserves
`amount`, `platform_fee` and `net_to_org`, which is what makes the clawback size itself
correctly.

The partial branch stops rewriting `amount`. Today it overwrites `amount` with the retained
figure and stashes the original in `raw.original_amount`; under the three-party ledger that
would permanently break `amount − processor_fee_cents = net_amount`. Instead `amount` and
`platform_fee` stay, and only `net_to_org` drops to the organizer's retention. The
`p_retained_fee` parameter is dropped; `p_retained_net` becomes the retention.

Organizer retains ₱300 under `flat_fee`:

```
runner ₱1,610 + organizer ₱300 + Race Pace ₱60 + PayMongo ₱30 = ₱2,000
```

Balances exactly, which is the property every partial refund test asserts.

---

## 7. Payout statements

`payout_open_statement` switches from `gross − commission − refunds` to summing the
authoritative per-payment figure:

```
net_owed = Σ net_to_org  (status in ('paid','partially_refunded'), payout_statement_id is null)
         − Σ net_to_org  (status = 'refunded', payout_statement_id is not null,
                          payout_clawback_id is null)
```

`gross_cents`, `commission_cents`, `processing_cents` and `refunds_cents` become
presentational breakdown columns rather than load-bearing arithmetic — one number decides
what is owed, and the breakdown explains it. Two things that must agree cannot disagree
when only one of them is authoritative.

The two-stamp mechanism (`payout_statement_id`, `payout_clawback_id`) is unchanged. It
already makes double-payment structurally impossible and needs nothing from this work.

### Unreconciled rows

A statement may be opened while some payments still carry `processor_fee_source =
'predicted'`. The RPC returns the count, and the page shows it rather than blocking:

> 3 payments have estimated processing fees awaiting reconciliation. **[Reconcile now]**

Blocking would strand a payout behind a PayMongo API outage. Warning surfaces the risk
without creating a new way to be stuck.

---

## 8. Runner-facing display

### Absorb mode

The pay screen shows one number. The runner pays no fees, so printing fee lines invites
"why am I being charged ₱30?" about money that never touches them.

```
Entry fee · 40K Ultra          ₱2,000.00
Add-ons                            ₱0.00
─────────────────────────────────────────
Total to pay                   ₱2,000.00
```

The breakdown appears on the receipt after payment, built from the **actual** fee rather
than an estimate — a record, not a projection:

```
Paid                           ₱2,000.00
  Race Pace service fee (3%)      ₱60.00
  Payment processing (GCash)      ₱30.00
  To organizer                 ₱1,910.00

Refundable amount              ₱1,910.00
```

Stating the refundable amount at the point of purchase is what stops the refund policy
being a surprise later.

### Pass-on mode

Every line is itemised, because every line changes the total and the runner is genuinely
paying it:

```
Entry fee · 40K Ultra          ₱2,000.00
Race Pace service fee (3%)        ₱60.00
Payment processing (GCash)        ₱31.38
─────────────────────────────────────────
Total to pay                   ₱2,091.38
```

The processing line updates when the runner changes method, since the amount genuinely
differs. Both `apps/site` (`app/pay/[registrationId]/PayPanel.tsx`) and the mobile pay
screen carry this; they already share the method picker that triggers the session recreate.

---

## 9. Reporting

### Organizer — new event Settlement view

Org-scoped, showing the organizer their own money without having to ask:

- Summary: gross collected → Race Pace commission → payment processing → refunds → net
- Per-registration table with the same breakdown per row
- CSV export
- In absorb mode, a projected-range line

That last item matters more than it looks. In absorb mode the organizer's net swings ₱55
per entry between GCash and card — across 500 entries, ₱27,500 they cannot forecast. The
range is stated up front rather than discovered at settlement:

> Net ₱927,500–₱955,000 depending on payment mix. Card payments cost ₱85 to process;
> GCash costs ₱30.

**RLS.** Org staff need read access to their own org's `payments`; today
`payments_read_own` is runner-scoped only. The new policy scopes once, not per row:

```sql
using (org_id in (select org_id from org_staff where user_id = (select auth.uid())))
```

Written this way deliberately. An unwrapped `auth.uid()` or a per-row helper call evaluates
once per row and has already taken this schema from 4.9ms to 1220ms and into statement
timeouts.

### Super admin

Commission and Payouts keep their platform scope band and gain:

- a processing column alongside commission
- effective blended rate — commission and processing as a percentage of gross
- the §5 drift banner
- total absorbed by Race Pace: international-card shortfalls plus drift under-collection

### CSV

Transaction-level only:

```
registration_id, runner_name, category, paid_at, method, gross_paid,
rp_commission, processing_fee, net_to_org, status, refunded_amount, refunded_at
```

The summary lives on the page, where it can be printed. A summary block above a CSV header
breaks every spreadsheet import, and this export exists specifically to be opened in a
spreadsheet.

---

## 10. Backfill

Existing payments have no processor fee. A migration extracts it from `payments.raw` where
PayMongo's stored payload already contains it, and marks the remainder `none`.

**Historical `net_to_org` is not touched.** Those entries were settled under terms where
Race Pace absorbed processing. Recomputing them would invent debts against organizers for
money they were correctly paid, and some of it has already been transferred. The backfill
makes old rows *explainable*, never *repriced*.

Reports spanning the cutover label pre-migration rows as "processing absorbed by platform"
rather than showing ₱0 processing, which would read as free rather than as absorbed.

---

## 11. Error handling

| Condition | Behaviour |
| --- | --- |
| Payload has no `fee` | Write `predicted` from the rate card, flag for reconciliation. `net_to_org` is computable, so the organizer is never blocked. |
| `amount − fee ≠ net_amount` | Refuse to write `actual`. Log loudly, mark for manual review. A figure that fails PayMongo's own arithmetic is not defensible. |
| No rate card row for a method | Pass-on mode refuses the session with an operator-facing error — it cannot compute what to charge. Absorb mode is unaffected: it charges the sticker price and reports from actuals. Only the organizer's projected range (§9) degrades, and it omits that method rather than guessing. |
| Rate card row is stale | Not an error. §5 detects it from actuals. |
| Refund exceeds `net_to_org` | Rejected before the provider call. Nothing can refund more than the organizer received. |

---

## 12. Testing

- **Gross-up round trip.** For every seeded method and a range of base prices, `charge −
  actual_fee − platform_fee == base_total`. The single test that catches gross-up errors,
  and the reason the formula is expressed in integer arithmetic.
- **Refund invariant.** `refunded_amount == net_to_org` for every `full`-policy refund; the
  four-way sum balances exactly for every partial.
- **Integrity check.** A payload where `amount − fee ≠ net_amount` must refuse to write
  `actual`.
- **Rate card effective dates.** A payment confirmed before a rate change predicts with the
  old rate, not today's.
- **RLS.** Org A reads zero rows of org B's payments. This suite had no safety net until
  `test/seeded.ts` was fixed; the new policy must not be the thing that proves it again.
- **Drift view.** A seeded run of payments at a rate other than the card's raises the flag;
  a run at the card's rate does not.
- **Backfill.** Historical `net_to_org` is byte-identical before and after the migration.

---

## 13. Out of scope

- **PayMongo v2 `pass_on_fees`.** v2 computes and grosses up its own fee, which is
  attractive. But the rate card is needed regardless — absorb mode has nothing to pass on
  and still owes the organizer a projected range (§9) — so v2 removes neither the rate card
  nor the drift detector. It buys one formula in exchange for migrating every payment path
  off v1. Revisit if PayMongo deprecates v1 or adds methods with materially harder pricing.
- **Automated organizer transfers.** Payouts stay manual and off-platform, recorded in the
  console. Unchanged by this work.
- **Per-org method restriction.** Letting an organizer disable cards to narrow their absorb
  range is a reasonable follow-up, but the projected-range line addresses the transparency
  problem without new surface.
