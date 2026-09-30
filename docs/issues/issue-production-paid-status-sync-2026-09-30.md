# Investigation: production payments remain pending after PayMongo capture

> Resolved in production on 2026-09-30 through PR #212. See the [production recovery record](../operations/payment-status-recovery-production-20260930.md) for current status. The findings below preserve the original pre-repair investigation snapshot.

## Status and assessment

Investigated on 2026-09-30, Asia/Manila. This is a confirmed production incident, not a display-only hypothesis. Production remains unchanged by this investigation. Recovery and the permanent fix are outstanding.

The report came directly from the owner. No GitHub issue was supplied or published. Customer contact details are omitted from this artifact; the reservation and provider identifiers below identify the case.

| Metric | Assessment | Evidence |
| --- | --- | --- |
| Severity | High; urgent | Live money was captured while the reservation and its financial record remain pending. The disabled webhook serves reservations, single registrations, and group registrations. |
| Complexity | Medium | Existing atomic settlement functions can be reused, but event handling, provider configuration, reconciliation, and visible reports require verification. |
| Confidence | High for the incident and disabled delivery; medium for the historical disabling trigger | Live PayMongo and database readbacks agree on the mismatch. Deployed code reproduces a 503 for the failed event type, but the dashboard does not expose the historical response body. |

## Confirmed customer payment

| Field | Verified value |
| --- | --- |
| Event | KIBALABAG TRAIL ULTRA 2027 |
| Reservation | `4cc59cf7-1b73-4f0c-919a-2ffce15995fa` |
| Reservation payment row | `3c20262a-ea4a-49f3-8555-e66779ad3443` |
| Bound PayMongo checkout | `cs_8f8cf6f9a88acae67ab06cc4` |
| PayMongo payment | `pay_CRyZPPHKwLgXLscLUAqUrveH` |
| Provider status | PAID, Live mode, PHP, GCash |
| Provider payment time | September 30, 2026, 1:17 PM Manila; dashboard has minute precision |
| Charged / provider fee / provider net | PHP 205.13 / PHP 5.13 / PHP 200.00 |
| Frozen platform fee | PHP 0.00 |
| Reservation created | September 30, 2026, 1:11:15 PM Manila |
| Local checkout deadline | October 3, 2026, 1:10:37 PM Manila |
| Database state | Both `event_reservations.status` and `reservation_payments.status` are `pending`; both paid timestamps and provider payment ID are null |
| Capture inbox | No `reservation_capture_events` row for this reservation |

The [live payment detail](https://dashboard.paymongo.com/payments/pay_CRyZPPHKwLgXLscLUAqUrveH) matches the reported customer. Opening the exact stored checkout independently showed “GCash Payment Received,” the same reservation reference, and the same payment ID. This establishes the checkout-to-payment binding without assuming that an email or amount match alone proves payment.

The checkout receipt presents the PHP 200.00 base. The merchant payment detail shows the authoritative gross PHP 205.13 and provider fee PHP 5.13. The stored checkout request enables PayMongo-managed pass-on fees, so the difference is expected. Settlement must record the actual gross, fee, and net rather than copying the pending base amount.

This account has no associated registration row. Reservation fees and race-entry payments are separate charges. Do not create or mark a race registration paid because the reservation fee was paid.

## Confirmed delivery outage

The [production webhook](https://dashboard.paymongo.com/webhooks/hook_2SE1qyvHNjEHfe46cy1KnSGu) targets:

`https://whaqarofxdlzxrelbcrq.supabase.co/functions/v1/payments-webhook`

Its live status is **Disabled**, with reason **Max retries exceeded**. Both `payment.paid` and `checkout_session.payment.paid` are subscribed.

The dashboard delivery history contains repeated failed `payment.paid` events with 12 retries each on September 20. Interleaved `checkout_session.payment.paid` deliveries succeeded with zero retries. One inspected failure is event `evt_QmhjmRo3GzNWneHJTFaK99vy`, resource `pay_HjXRqgU39uGPJZKvHJC3fBF7`. It was created at 8:32 PM Manila and last retried at 10:49 PM. Its payload is a bare `payment` resource with a registration ID in metadata. Its corresponding database capture is already settled.

Production function logs for the 24-hour window ending September 30 at 4:30 PM Manila contained no webhook invocations through the actual read time, approximately 4:06 PM. Successful runner verification calls existed. The affected reservation had no return-path verification near its payment time. This is consistent with payments settling only when a runner returns successfully, or when a later worker reconciles them.

[PayMongo documents](https://docs.paymongo.com/reference/webhook-resource) automatic disablement after three consecutive events exhaust 12 retries. It also states that missed events are not resent automatically. Re-enabling delivery alone therefore does not repair existing pending records.

## Root cause and evidence chain

1. **Why is a captured reservation pending?** No capture was committed. Both live rows remain pending and the reservation capture inbox is empty.
2. **Why did automatic confirmation not run?** The production webhook is disabled. The affected checkout had no observed return verification.
3. **Why is there no immediate fallback?** `ReservationStatusPanel.tsx:17-32` checks once only after `returned=1`. Normal visits require manual “Check payment.” The expiry candidate SQL waits until the checkout deadline; this reservation is not due until October 3.
4. **Why did provider delivery become disabled?** PayMongo reports exhausted retries. Historical failures are `payment.paid`; this event shape is rejected by the deployed single-registration parser. This is the strongest supported historical cause, but the original HTTP response was not available to prove each failed retry.
5. **What code defect reproduces the failure?** `payments-webhook/index.ts:29,57-64` accepts `payment.paid` and passes its event to `confirmPayment`. `confirm.ts:53-82` extracts captures only from a checkout resource's `payments[]`. A bare payment therefore produces zero captures and `provider_capture_invalid`, HTTP 503, at `confirm.ts:136-139`.

The [official PayMongo event documentation](https://docs.paymongo.com/docs/developer-tools-webhooks-events) confirms that `payment.paid` contains a bare payment resource. The failure is reproducible without contacting production. The parser regression was introduced by commit `1291285` on September 18. The signature implementation has been unchanged since July 24; valid documented live and test signature forms pass the local check. This does not verify the current deployed signing secret.

Reservation and group webhook branches refetch their bound checkout and do not share the bare-resource parsing defect directly. They still lose automatic notification when the shared webhook is disabled.

## Wider audit

| Surface | Verified result |
| --- | --- |
| Reservation records | Three total: one locally paid, the reported paid-but-pending case, and one other pending reservation |
| Other pending reservation | `ded29f5d-2c65-4e49-be3d-6e69595a5614`; its exact provider checkout still presents “Complete Your Order” and PHP 206.00 Total Due. No payment was submitted. |
| Already settled reservation | `3e5c4466-5a20-498e-aab4-30910fb60e8d`; PHP 211.28, payment `pay_9LcNe5mGsD8Cj9R8QDgRHn3j`, confirmed PAID in PayMongo and the database |
| Registrations | 29 total: 19 paid, one pending, six expired, three cancelled |
| Single payments | 17 paid, five failed; all 17 capture inbox rows are settled; no unresolved single capture inbox entries |
| Group payments | One fulfilled capture, one paid attempt, two allocations, two paid participants |
| Pending registration | Belongs to a group order with no payment attempt or provider checkout bound; no captured payment evidence in its local records |
| Administrative payment report | Authorized view returns 18 paid transactions, 19 participants, PHP 32,906.68 gross |
| Provider-to-registration comparison | Two 50-row PayMongo dashboard pages contain all 18 corresponding paid registration capture IDs. After deduplicating repeated dashboard rows by payment ID, gross totals PHP 32,906.68, matching the authorized report exactly. |
| Administrative registration report | All 19 paid registrations have payment status paid under authorized claims |
| Money invariants | All 17 paid single payments and both group allocations satisfy gross = processor fee + platform fee + organizer net |
| Schedulers | Registration and reservation expiry jobs are active every five minutes; they are not immediate pending-payment reconciliation jobs |

Group financial views explicitly check JWT role claims. An initial raw SQL query without claims hid group rows. A second read with a transaction-local service-role claim verified the complete 18-transaction/19-participant totals. This was a read context only; no stored permission or production record changed.

The provider cross-check independently confirms all 18 currently recorded paid registration captures and both paid reservation captures. Only one of those reservation captures is reflected locally. The comparison used payment IDs, not just matching totals. PayMongo repeats some payment rows; those were deduplicated by payment ID. The other pending reservation remains at Total Due. This is not proof that every historical or unbound provider transaction is recorded: a complete recovery sweep must also inspect expired, failed, superseded, and unbound sessions before declaring recovery complete.

## Affected user and financial surfaces

The reservation roster and registration-page reservation section read the actual stored statuses; no paid-to-pending display conversion was found. Reservation payment reports include only paid rows. Therefore the missing capture also omits this revenue from reservation payment reports and fee/payout calculations.

Relevant production-source references:

- `apps/web/app/(admin)/events/[id]/reservations/page.tsx:16-18,58-63`
- `apps/web/app/(admin)/registrations/reservation-section.tsx:8-11,45-48`
- `apps/web/lib/queries/reservation-payments.ts:18-24`
- `apps/site/app/races/page.tsx:20-22,52`
- `apps/site/app/reservations/[id]/ReservationStatusPanel.tsx:12-32,44-47`
- `apps/site/app/reservations/callback/page.tsx:14-15` drops `returned=1` when redirecting an unauthenticated runner to sign-in.
- `supabase/migrations/20260929191739_screening_maintenance_fairness_and_upload_cleanup.sql:12-19` restricts pending reservation maintenance to expired checkouts.

## Safe recovery and implementation plan

1. **Reconcile the confirmed customer capture promptly.** Use fresh authenticated provider GET evidence with the existing `verifyReservationPayment` function. It validates the bound session and capture, then calls the existing atomic `confirm_reservation_payment` function. Do not directly update status fields or invent a provider timestamp. The owning runner's existing “Check payment” button invokes this path.
2. **Fix the shared handler before restoring delivery.** Handle a single-registration `payment.paid` event by resolving and verifying its bound checkout, or normalize a verified capture with all existing ownership, mode, currency, amount, duplicate, and session checks preserved. Checkout events and refunds must retain their existing safeguards. Do not simply swallow a failed capture with HTTP 200.
3. **Validate through staging.** Prove both paid event shapes, duplicate delivery, early delivery before GET consistency, invalid signatures, wrong mode/currency, amount mismatch, historical/superseded sessions, reservation capture, and group capture. Then follow the staging-to-main release workflow.
4. **Restore the existing live webhook after validation.** Check signing configuration and retained refund subscriptions. Confirm a real provider replay reaches the intended function and receives an appropriate success response. Avoid enabling it unchanged while the known 503 defect remains.
5. **Run a read-first reconciliation sweep.** Compare provider sessions/payments to reservation, single, and group ledgers. Include failed/expired/superseded sessions and durable review inboxes. Settle only verified captures through existing functions. Leave unpaid entries unpaid and route conflicts to review.
6. **Verify all surfaces.** Check reservation and payment rows, capture evidence, participant holds, runner My Races/detail, admin reservation rosters, registration/payment tables, exported totals, commissions, and payout eligibility. Reloading an already-open page may be required.
7. **Close the fallback gap.** Add bounded recurring verification of unresolved checkouts without waiting for expiry; retry provider verification on the return page; preserve callback intent across sign-in. Add alerting for disabled webhook delivery and overdue reconciliation.

Do not run expiry workers early as a generic repair. They can expire unpaid chargeable sessions. Do not make a production test payment, refund, or synthetic registration.

## Verification and source identity

- Production Supabase: `whaqarofxdlzxrelbcrq`, ACTIVE_HEALTHY.
- `origin/main`: `8ef3b4fedf2aa2757574bc84affbc30b7c96ab68`.
- `origin/staging`: `1253b36d4c48cfeea4b7d89284bd2f0122cc43c5`; main is an ancestor of staging.
- Deployed `payments-webhook`: v37, ACTIVE, JWT verification disabled, bundle SHA-256 `064620815f74d19f03a45aaf09bbe3cfa197129e53fe412c4da5850eb341926d`.
- Exported deployed `payments-webhook/index.ts`, `_shared/confirm.ts`, `_shared/paymongo.ts`, and `_shared/reservationPayment.ts` match `origin/main`, ignoring trailing newlines.
- `reservation-verify` v4, `payment-verify` v38, `group-payment` v16, both expiry workers v4/v16 are Active.
- Production migration head: `20260929191739`. The deployed reservation confirmation function was read directly.
- Local parser reproduction: `node /tmp/racepace-payment-investigation-20260930/payment-parser-evidence.mjs` passed. It proves the bare-event 503, correct checkout capture extraction, valid live/test signature parsing, and rejection of stale/wrong signatures. Zero network requests and zero database writes.
- No application code was changed and no full application or backend suite was run. No deployment was attempted. Vercel project lookup was blocked by a connector argument-schema error, so this report does not claim fresh Vercel deployment identity verification.
- No live webhook setting, payment status, money ledger, registration, or provider record was changed. No customer message was sent.
- The primary checkout contains extensive unrelated changes and is behind production. Source analysis used `origin/main` and deployed exports. Only this new report belongs to this investigation.

## Completion boundary

| Completed | Outstanding | Next action |
| --- | --- | --- |
| Customer payment verified; disabled webhook identified; deployed parser failure reproduced; reservation/registration/report consistency audited | Customer remains pending; webhook remains disabled; complete provider sweep and repair are not done | Reconcile the verified capture through the existing verification path, then validate and release the handler correction and restore delivery |

Use this artifact as the input to `piv-implement-issue`. Preserve the separate reservation and race-entry payment boundaries throughout recovery.
