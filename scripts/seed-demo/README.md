# Demo fill for the hosted database

`supabase/seed.sql` creates the *shape* of the demo catalog — two organizations,
twenty events, forty-seven distances. It deliberately leaves most optional
columns empty and creates no runners at all, because it is also the fixture the
backend tests run against.

These four files fill everything else in, so the runner site and the admin
console can be looked at with a full season of real-looking data behind them.
They are **additive and re-runnable**: each one only creates what is missing.

```bash
node scripts/seed-demo/gen-content.mjs /tmp/01-event-content.sql
npx supabase db query --linked -f /tmp/01-event-content.sql
npx supabase db query --linked -f scripts/seed-demo/02-runners.sql
npx supabase db query --linked -f scripts/seed-demo/03-registrations.sql
npx supabase db query --linked -f scripts/seed-demo/04-raceday.sql
```

Run them in order. `03` depends on the runners from `02`; `04` depends on the
paid registrations from `03`. Swap `--linked` for `--local` to fill a local
stack instead.

| File | What it writes |
|---|---|
| `gen-content.mjs` → `01` | Every remaining empty column on `events` (description, gallery, inclusions, race-morning schedule, start/finish coordinates, **course route**, status note, legacy place/region) and `categories.blurb`; add-ons and custom form fields for all twenty events. |
| `02-runners.sql` | 1,200 runner accounts with full profiles. Password `password123`. |
| `03-registrations.sql` | ~5,900 registrations — paid, pending, failed and refunded — with add-on line items, payments, and signed tickets. |
| `04-raceday.sql` | Check-ins for every race that has started, payout statements, notifications, and four entries reassigned to the real `json.alanano@gmail.com` account. |

## The one rule that matters

`categories.slots_taken` must equal the number of **paid** registrations on that
category. Production maintains it in `confirm_payment_tx` (increment) and
`refund_registration_tx` (decrement), and the public site reads it as "slots
left". `03` generates exactly the shortfall and ends by asserting the invariant:

```
select count(*) as categories_out_of_sync ...   -- must be 0
```

Pending, failed and refunded entries are deliberately outside that count, which
is why a cancelled race ends up at `slots_taken = 0` — everyone was refunded, and
a refund gives the slot back.

## Known limits of the seeded data

- **Seeded QR codes will not pass hosted check-in.** Tickets are signed with the
  literal `dev-secret`, the fallback `supabase/functions/_shared/ticket.ts` uses
  when `TICKET_SIGNING_SECRET` is unset. The hosted project has that secret set
  and the Management API will not read it back, so a seeded ticket verifies
  locally but not against the deployed `check-in` function. Check-ins are
  therefore written straight into `checkins` by `04`. Setting
  `TICKET_SIGNING_SECRET=dev-secret` on the project would make scans work, at the
  cost of invalidating the one genuinely-minted ticket already in the database.
- **Pending payments have dead checkout links.** `payments.checkout_url` points
  at a `cs_seed_…` PayMongo session that was never created. Paying a seeded
  pending registration through to completion is not possible; register fresh to
  exercise the real checkout.
- **No avatars, and RunWithPoint has no logo.** Those need real uploaded image
  files. Neither is rendered anywhere on the runner site.
- **`end_date` and `original_date` stay null on most events**, on purpose. They
  are not blank fields waiting to be filled — `end_date` set means "multi-day"
  and `original_date` set means "Rescheduled", so filling them everywhere would
  make every 5K a two-day event and badge the whole catalog as rescheduled.
