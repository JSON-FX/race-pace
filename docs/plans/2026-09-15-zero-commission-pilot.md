# Zero-commission pilot QA — 2026-09-15

Local simulated money journey passed for 0% commission with organizer-absorbed processing. No money transferred. This is not hosted deployment or real PayMongo verification.

## Fixtures

- Organization: QA Zero Commission Pilot 20260915 (`935f64ee-bb07-4012-8f0e-8a30f322bdaa`).
- Event: QA Zero Commission Pilot 10K (`4de30fc8-4bf7-4d8e-aeb4-522f14aff3c4`). Marked completed through local fixture setup for payout testing.
- Category: `1eec035b-312c-4dad-9501-4e6ba0b4ed94`, PHP 1,000, ten slots.
- Refunded registration: `cd59e445-bc01-4b98-9fdf-e87f5d9cfa6e`.
- Paid registration: `5fb56ea7-5cea-4550-acff-2cc03d2fd020`.

## Results

| Check | Evidence |
| --- | --- |
| Commission configuration (Computer) | 0%, Absorb, PHP 0 commission. |
| Two authenticated checkouts and fake payments | Each PHP 1,000 gross, 0 commission, 15 predicted GCash processing, 985 organizer net. |
| Authenticated refund preview/execution | First entry refunded PHP 985; PHP 15 processing retained. |
| Settlement (Computer) | PHP 2,000 gross minus 0 commission, 30 processing, 985 refund equals PHP 985 net. Refunded runner row has zero net. |
| Authenticated CSV endpoints | Payment and registration exports returned HTTP 200 and exactly two rows. Correct identities/statuses; payment export has zero platform fee, predicted processing source and confirmation timestamps. |
| Payout (Computer and database) | Statement `8c45ee6c-b224-4993-9a2b-b613e5eb2fac` paid for PHP 985, reference `QA-SIMULATED-ZERO-PILOT-20260915-001`. |
| Authenticated payout replay | Returned `already`. |
| Follow-up statement | `ac5f7a43-9890-4d87-8dc7-ff42c06aefc1` remains open with zero gross, commission, processing and net. No duplicated earnings. |

The settled statement includes only the remaining paid entry: PHP 1,000 gross less PHP 15 processing. The event settlement includes both payments and the refund. These different gross totals reconcile correctly.

Payment CSV retains original PHP 985 net on the refunded payment alongside its refunded status. It represents payment history, not outstanding payout totals. Refund amount and outstanding net columns would clarify reconciliation.

## Remaining limits and discrepancies

- Actual PayMongo fees, asynchronous webhooks, pending/failure behavior and real refunds remain unverified.
- CSV endpoints passed through authenticated HTTP. This is not a browser download pass; Brave previously blocked downloads.
- Settlement still says funds are “already banked and exact” despite predicted fees. This previously recorded wording discrepancy remains open.
- Completed event still shows projected proceeds from unsold entries. Review hiding projections after completion.
- Fixed-zero and pass-on processing remain separate test cases.
- Mailtrap delivery was not verified in this slice. Hosted data and deployments were unchanged.

Next: PayMongo test-mode checkout and webhook lifecycle, then race-day kit/check-in operations. Configure zero commission before opening pilot registrations.
