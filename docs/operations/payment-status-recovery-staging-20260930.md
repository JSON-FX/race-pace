# Payment status recovery: staging acceptance, 2026-09-30

## Reviewed source and applications

PR #208 merged at `231265b95d57c9d123c1a35b39ecc11b40413696`.
Exact-merge CI `36692704211` passed. Both Ready deployments own the staging aliases:

- Runner: `dpl_GU2ovszchXgj5jaLhVVdcSTAaoqA`.
- Admin: `dpl_4jVBNtHwtcLrH1MNqEY6KBDFWvpW`.

Browser loaded the runner races page and authenticated admin events page on the staging aliases.
The earlier full local checks passed: 871 backend/shared, 530 runner, 1,018 admin and 13 shared UI tests;
final focused regressions, typechecks, optimized builds and Fieldnotes audit also passed.

## Backend readback

Staging project `pepbmqomiailnnvvwupz` has 179 migrations through
`20260930081626_payment_status_reconciliation`. Service-role claim grants are present;
authenticated execution is denied. Downloaded source files match the reviewed checkout byte for byte.
Hashes below are SHA-256 over sorted JSON mappings of repository-relative TypeScript paths to file hashes.

| Function | Version | Verify JWT | Source manifest hash |
| --- | --- | --- | --- |
| admin-group-refund | 10 | true | `5be003dd513eeecd4863ee3e41ce4b801fb1f3f23fa8df9b83ed849046ecf3b1` |
| admin-refund | 12 | true | `deb98340dbe46c149b29dc5a6f3bf117e5d61bb0011c911fe789be8f30ee2826` |
| discount-checkout | 2 | false | `6ce2243b4421c77740db631b033a0de10df2f52549f0940f1142655eb66ea8aa` |
| expire-coming-soon-reservations | 5 | false | `70f3486573f1a45ec4f225a7d6f094e13e897a24c6f993c64f147e49b88a97f6` |
| expire-paymongo-checkouts | 14 | false | `d3600920104db4e1edb44e28ed45b68a1a0ecf12755abb496e08cbfada803f70` |
| fake-checkout | 6 | false | `cb771ab69824a7199339915779131d2dcb1d97423c573b9162ac5c224964b6d9` |
| group-payment | 14 | true | `355b1b4712172ed08609a000d761e164a31fe01cb9563288346bea4b1dd3b1ea` |
| payment-session | 23 | true | `f250b44c2f978381d5738d929360b40dfae5aebc7104244b68154124abf5d050` |
| payment-verify | 22 | true | `c2e4b6853830eb5a77d4afd4b9b10df70e90984fc79f6df31e5e48c182f59b74` |
| payments-webhook | 22 | false | `068b2348483fd34489a4088fe3856422bd03e65964ada5fbf1273fe90dd277f5` |
| prescreening-maintenance | 4 | false | `77b19470e1a638ecb96f562cce075b570226297f40dd1d962e3f3fd17e61df69` |
| reconcile-payments | 1 | false | `40ee1d535a00c181e23d1ffdd3a602884895b6de54c956d812b01d2a6283050d` |
| registrations-checkout | 23 | true | `fe4d79391826b1075b79b621b7f92154de4bd245077680c53dc59ae3329a3548` |
| reprice-event-checkouts | 12 | true | `2ec182e04b0b9b46fa4a0f39e819b9c185bfc86c4391c81fe3b1466c83a0d192` |
| reservation-checkout | 5 | true | `80022fcf432b596ed71c7f914a37c185ffa1beb58143350d70e9dee54d8031e5` |
| reservation-verify | 5 | true | `1840ebad4910f2a894be57bb0bee672f31b1b76ef11124f35e973d85eccb8de3` |

The first CLI deployment attempt omitted the import map and failed bundling. Redeployment with
`--import-map supabase/functions/deno.json` succeeded. All 16 downloaded bundles were verified afterward.

## Provider acceptance

Only PayMongo test mode was used. Test key and webhook secret fingerprints matched the staging
Edge secrets without printing them. Synthetic organization `c8876a82-87c6-4108-8e17-d127618e3c47`
is named `[TEST] Payment recovery 2026-09-30`; its fictional account uses an example.invalid address.
No live charge, refund or production fixture was created.

The reservation and single-registration checkouts deliberately omitted routing metadata and returned
to the events page. This prevented webhook/callback settlement and reproduced missed delivery.
Worker request 38830 returned HTTP 200 and settled both through existing atomic functions:

| Flow | Provider payment | Gross | Provider fee | Organizer net | Result |
| --- | --- | --- | --- | --- | --- |
| Reservation | `pay_y1iNdWCi7j4w2baPoBRnPhud` | 10152 | 152 | 10000 | Reservation and payment paid |
| Single entry | `pay_bVqdyo1Kn3u3kUD6DwwRsgH9` | 10000 | 150 | 9850 | Payment and registration paid; ticket present |
| Valid group entry | `pay_9vQ5wYKmVYpi1W1kg1v7WYFN` | 10000 | 150 | 9850 | Provider webhook fulfilled capture; registration paid; ticket present |

All amounts are integer centavos; platform fee is zero in these fixtures. All captures report
`livemode=false`. Reservation provider capture time is retained in raw evidence separately from
application settlement time.

The first group fixture also omitted required group metadata. Its real test capture
`pay_g7z8YAfmkdpCew7BQPE2XKXu` correctly became a durable `invalid_provider_capture` review,
with `invalid_metadata` evidence. That hold remains intact. A new valid fixture proved successful
group settlement instead of weakening validation or clearing the hold. One pre-existing staging
single capture also entered review; another unpaid staging checkout remained pending.

Signed replays of the actual single capture passed as `payment.paid`, canonical
`checkout_session.payment.paid`, and duplicate `payment.paid`, all HTTP 200. Invalid webhook signature
returned 401; unauthenticated worker POST returned 401; worker GET returned 405.

Staging webhook `hook_Rycf1WJREFL3PmRhtEwMCSsy` is enabled in test mode. Added `payment.paid`
to its existing checkout and two refund subscriptions so staging exercises the production event shape.
Both natural deliveries for the valid group capture returned HTTP 200 at 09:29:17 UTC.

## Schedule and scope

Both `paymongo-payment-reconciliation` (HTTP job 13) and `payment-reconciliation-health` run every
five minutes. The HTTP worker uses this project's existing Vault expiry-worker secret and a 120-second
timeout. Immediate health readback was healthy with no provider issue. Worker regression tests cover
all three recovery routes and replay safety; hosted recovery exercised reservations and single entries,
while hosted group acceptance exercised natural provider delivery and invalid-capture review.

Staging fixtures remain clearly labelled for audit. No unrelated review holds were cleared.
Production is not yet repaired at this checkpoint. The next step is staging-to-main promotion,
production reconciliation, restored live delivery, and readback of ledger/report/scheduler state.

## Combined release checkpoint

PR #209 subsequently merged the independently accepted discount search fix at
`ca2c65fafc0240566ac5f1df0690af4504a250f6`. Its exact staging CI `36697611359` passed;
[the discount acceptance record](discount-runner-search-staging-20260930.md) records the
new Ready runner/admin deployments and migration 180 (`20260930083846`). Payment application
and Edge Function source are unchanged from the payment acceptance above. Both acceptance
records are combined in the release documentation to avoid another overlapping staging merge.

The scheduled payment worker returned HTTP 200 at 09:30 and 09:35 UTC, retaining the unpaid
checkout as pending. Both SQL watchdog runs succeeded. The admin Browser finance view shows
two paid entry captures (gross 20000, organizer net 19700) and the separate paid reservation
(gross 10152, provider fee 152, organizer net 10000). Replay readback still shows exactly one
single capture and one valid group capture. Production deploy excludes the dev-only
`fake-checkout`, which is absent from production.
