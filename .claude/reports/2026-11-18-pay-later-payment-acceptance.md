# Pay Later staging payment acceptance

Result: passed on November 18, 2026 Philippine time. Paying the reserved Pay Later
registration through PayMongo sandbox produced a paid, valid race pass. The deployed
staff check-in endpoint accepted its signed ticket. No application changes were needed.

## Verified deployment

- Application revision: `4bb527ab2f93263d04fca22f60dd5959d515c0e8`.
- Runner: `dpl_H8gCVKPFpmGd8rxVunVdjj3pMg2L`.
- Admin: `dpl_BhtS5nc1nn3r5XstaCCxqiDah9Gj`.
- Both staging `/api/release` responses matched this revision and Supabase
  `pepbmqomiailnnvvwupz` during this test session.
- Migration count: 185; latest `20261118090000`.
- Active functions: registrations-checkout 31, payment-session 31, payment-verify 30,
  payments-webhook 30, ticket-qr 18, check-in 19, send-lifecycle-email 18.
- Release `44182876135`: staging successful; production still waiting after testing.

## End-to-end evidence

Ego Lite operated the deployed administrator and runner interfaces. The administrator
granted eligibility for `[TEST] Pay Later Payment QA`. The runner selected 21 km and
reserved it through the actual registration form. January 16, 2027 event day defaulted
the deadline to December 19, 2026 at 11:59 p.m. Philippine time.

The synthetic runner used a separate account and Passport. No existing runner's
credentials or profile were changed. The test event's waiver explicitly described a
synthetic acceptance test without a real booking.

| Check | Observed result |
| --- | --- |
| Before payment | Pending Pay Later registration; reserved/unpaid message; no ticket token or QR code |
| Cancel hosted checkout | Returned to “Payment not completed”; registration and payment remained pending; no ticket |
| Retry checkout | Reused the same PayMongo checkout session |
| Authorize sandbox payment | PayMongo QRPH Test Payment Page explicitly displayed a ₱100 test payment; authorized through its test control |
| Provider capture | One settled capture with `livemode=false`, amount 10,000 centavos |
| Payment result | Registration and payment became paid; signed ticket generated |
| Runner view | Race pass displayed QR and “Show this QR at check-in” at desktop and mobile sizes |
| Admin view | Record displayed Paid and “Payment is complete and the runner’s race pass is available” |
| Payment verification repeated twice | Both HTTP 200, paid, already true; unchanged ticket token; one payment and one capture |
| Staff check-in endpoint | HTTP 200, ok true; signed ticket accepted for the correct event |
| Check-in repeated | HTTP 200, already true; exactly one check-in retained |
| Inventory after all requests | One paid slot occupied out of three; no duplicate slot increment |

Final readback: `2026-11-17T23:34:07.998Z`.

- Event: `2aa91a87-7862-4b95-aa36-9edcc06c24af`.
- Registration: `04c3a35a-3a02-4786-a97d-90322e94b8df`.
- Checkout: `cs_8f675ff16b0a9fe88607940c`.
- Provider payment: `pay_X1ryX71N7H5oona7csJr92yP`.
- Check-in: `0eea31ee-b1c8-4da7-8e03-a7b12dd97988`.
- Accounting: ₱100.00 paid, ₱1.50 processor fee, ₱0.00 platform fee,
  ₱98.50 net to the test organizer.
- Capture delivery count reached five while retaining one settled capture. This does
  not imply five signed webhook deliveries; provider verification also confirms captures.

Ignored local evidence remains under `.local/pay-later-release/`: `payment-before.json`,
`payment-cancelled.json`, `payment-after.json`, `payment-before.png`,
`payment-paid-desktop.png`, and `payment-paid-mobile.png`. Credentials and signed ticket
tokens are excluded from this report. The synthetic paid fixture remains available for
review and is already checked in.

## Scope and release boundary

QR Ph was the payment method offered by this hosted checkout. Other payment methods and
a physical camera scan were not tested. Ticket validity was verified through the actual
staff endpoint, including signature, paid status, event and organization authorization.
No payment state was forced through SQL and no real funds were charged.

The five Pay Later emails were already confirmed received by the owner in the preceding
staging acceptance. This test does not add a delivery claim for the separate paid-ticket
email. Production was neither approved nor deployed during this task.
