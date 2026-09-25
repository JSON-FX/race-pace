# Coming Soon reservations for own and managed Race Passports

Status: implemented locally; staging release pending. Branch: `codex/coming-soon-events`.

## Goal

One signed-in booker selects one to ten accessible Race Passports and pays one
PayMongo checkout. Each selected Passport holds one event place. The booker
may omit their own Passport. Reservation and Platform Fees apply per place;
PayMongo computes one checkout fee. No reservation creates an entry or ticket.

## Existing contracts

- The Coming Soon single-place flow is live only on local Docker. Its current
  `event_reservations` row owns one `reservation_payments` row and one PayMongo
  checkout. Preserve paid local/legacy rows without data rewriting.
- Managed Passport access is defined by `runner_passports` and
  `passport_managers`. Reuse the existing one-to-ten distinct participant
  limit and check access in both Edge and SQL.
- `total_event_slots` remains the event capacity. Categories may be absent
  while Coming Soon. Opening registration requires enough category allocation.
- Existing registration and group payment paths remain intact. The separate
  reservation charge is never applied to entry payment.

## Architecture

Keep `event_reservations` as the checkout/payment header. Add `quantity` and
`event_reservation_places`, with one held place per Passport. A new RPC locks
the event, checks booker authorization and every Passport, counts all active
places and registrations, and inserts the header, place rows, and one payment
atomically. The header stays the PayMongo metadata and callback identity.
Legacy one-place headers without place rows count as one place.

The provider payment confirms once against `quantity × (reservation fee +
Platform Fees)`. Places convert or expire individually. A parent's financial
payment remains one row, so ledger and payout totals are not multiplied by
Passport count. Registration links by Passport and booker, including managed
Passports whose registration `user_id` is null. Never infer a managed person's
identity from the booker's email.

## Step-by-step tasks

1. Add an additive migration with quantity, place rows, explicit grants,
   row-level security, active Passport uniqueness, and an atomic group hold
   RPC. Preserve one-place reads and payment records. Validate with focused
   Postgres tests using the actual `service_role`, including duplicate
   Passport, wrong booker, total capacity, and concurrent checkout cases.
2. Update checkout and capture for a list of Passport IDs, one PayMongo
   session, per-place fee line quantities, idempotent readback, and one ledger
   payment. Test provider error, replay, fee mismatch, and paid confirmation.
3. Update conversion and expiry so each place transfers to its matching
   entry only after payment and before the deadline. Keep other places held
   until converted or expired. Verify partial conversion and cancellation,
   ordinary and group entry paths, and no overselling.
4. Add a category-free Passport selector to the approved Dossier page. Show
   names, own/managed relationship, selected count, and per-person fee
   breakdown without showing available slots. Show selected Passports on the
   runner receipt and organizer roster. Keep the existing one-place paid
   receipt readable.
5. Update the event directory's Coming Soon capacity cell to use the global
   total. Add precise user-facing error text for a payment method that the
   test merchant has not enabled.
6. Run focused migration, function, site, and admin tests; both typechecks;
   relevant builds; then repeat Docker browser acceptance with one own and
   one managed Passport in one PayMongo test checkout. Record exact charge,
   provider fee, rows, capacity, and any limitations in launch progress.

## Risks and checks

- Do not expose the selector before the database rejects unauthorized and
  duplicate Passport holds. A booker must not reserve another account's
  claimed Passport.
- PayMongo has only QR Ph enabled on this local test merchant. Check method
  capabilities and use test keys only.
- The existing group registration route is feature gated. It must not be
  assumed available when the reservation opens for managed participants.
- Neither hosted Supabase project nor production data changes in this task.

## Validation

Local Docker acceptance: one own and one managed Passport were selected in the runner UI and paid through one PayMongo test QR Ph checkout. The runner receipt, organizer roster, and database agree on two held places, a ₱1,045.69 charge, a ₱15.69 processor fee, and ₱30 in Platform Fees. The earlier one-place paid reservation remains intact.

`pnpm exec vitest run supabase/tests/coming-soon-reservations.test.ts`

`pnpm --filter site typecheck && pnpm --filter web typecheck`

`pnpm --filter site test && pnpm --filter web test && pnpm test`

`pnpm --filter site build && pnpm --filter web build` in an isolated build
environment, away from the Docker bind-mounted `.next` directories.

## Open decisions

- The user's selected direction is one checkout for multiple Passports.
- Own Passport participation is optional, matching current group entry.
- A follow-up may move event capacity to a general editor section and make
  category allocations sum exactly to it. That broader migration is not
  needed to secure multiple Coming Soon places safely.
