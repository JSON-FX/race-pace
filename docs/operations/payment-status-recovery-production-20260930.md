# Payment status recovery: production evidence, 2026-09-30

## Backend rollout and customer recovery

The compatible backend was deployed from exact validated staging revision
`ca2c65fafc0240566ac5f1df0690af4504a250f6` during production PR #212, before app promotion.
Staging acceptance is recorded in `payment-status-recovery-staging-20260930.md` and
`discount-runner-search-staging-20260930.md`. No unvalidated backend source was introduced.

Production `whaqarofxdlzxrelbcrq` now has all 180 migrations through `20260930083846`.
The recovery migration is `20260930081626`; its service-role execution grant is present and
its authenticated grant is denied. Both discount function bodies match staged fingerprints.
The CLI catalog-cache certificate warning did not prevent application; independent SQL readback passed.

The 15 production bundles below match staging byte for byte, with matching JWT settings.
The dev-only fake checkout remains absent from production. Source hashes use the same sorted
TypeScript file-manifest SHA-256 method as the staging record.

| Function | Version | Verify JWT | Source manifest hash |
| --- | --- | --- | --- |
| admin-group-refund | 16 | true | `5be003dd513eeecd4863ee3e41ce4b801fb1f3f23fa8df9b83ed849046ecf3b1` |
| admin-refund | 33 | true | `deb98340dbe46c149b29dc5a6f3bf117e5d61bb0011c911fe789be8f30ee2826` |
| discount-checkout | 2 | false | `6ce2243b4421c77740db631b033a0de10df2f52549f0940f1142655eb66ea8aa` |
| expire-coming-soon-reservations | 6 | false | `70f3486573f1a45ec4f225a7d6f094e13e897a24c6f993c64f147e49b88a97f6` |
| expire-paymongo-checkouts | 18 | false | `d3600920104db4e1edb44e28ed45b68a1a0ecf12755abb496e08cbfada803f70` |
| group-payment | 18 | true | `355b1b4712172ed08609a000d761e164a31fe01cb9563288346bea4b1dd3b1ea` |
| payment-session | 39 | true | `f250b44c2f978381d5738d929360b40dfae5aebc7104244b68154124abf5d050` |
| payment-verify | 40 | true | `c2e4b6853830eb5a77d4afd4b9b10df70e90984fc79f6df31e5e48c182f59b74` |
| payments-webhook | 39 | false | `068b2348483fd34489a4088fe3856422bd03e65964ada5fbf1273fe90dd277f5` |
| prescreening-maintenance | 4 | false | `77b19470e1a638ecb96f562cce075b570226297f40dd1d962e3f3fd17e61df69` |
| reconcile-payments | 1 | false | `40ee1d535a00c181e23d1ffdd3a602884895b6de54c956d812b01d2a6283050d` |
| registrations-checkout | 42 | true | `fe4d79391826b1075b79b621b7f92154de4bd245077680c53dc59ae3329a3548` |
| reprice-event-checkouts | 10 | true | `2ec182e04b0b9b46fa4a0f39e819b9c185bfc86c4391c81fe3b1466c83a0d192` |
| reservation-checkout | 6 | true | `80022fcf432b596ed71c7f914a37c185ffa1beb58143350d70e9dee54d8031e5` |
| reservation-verify | 6 | true | `1840ebad4910f2a894be57bb0bee672f31b1b76ef11124f35e973d85eccb8de3` |

Authenticated worker request `101362` returned HTTP 200: nine bound pending reservations
checked, three paid captures settled, six unpaid checkouts retained as pending. Settlement
used existing atomic provider-verification functions, never direct status-only updates.

| Reservation | Provider payment | Gross | Provider fee | Platform | Organizer net |
| --- | --- | --- | --- | --- | --- |
| `4cc59cf7-1b73-4f0c-919a-2ffce15995fa` | `pay_CRyZPPHKwLgXLscLUAqUrveH` | 20513 | 513 | 0 | 20000 |
| `a593f0ee-31c8-4a0c-9a9d-7074a3b3cf89` | `pay_wzVqkQM8ozkPQ8TugdGd4D3Y` | 21128 | 528 | 600 | 20000 |
| `77b20ff2-a5fa-4a5f-ba58-a0730f20f585` | `pay_usFEKdrddBERoBca51ssn2Hh` | 21128 | 528 | 600 | 20000 |

Amounts are integer centavos. All three captures were independently retrieved with `livemode=true`.
The reported customer's provider capture time is `2026-09-30T05:17:22Z` (13:17:22 Manila).
Both reservation and payment now show paid. The production admin reservation page displays
PHP 200 reservation fee, zero frozen platform fee, PHP 5.13 processor fee, and PHP 205.13 paid total.
Reservation fees remain separate from entry charges; no registration was fabricated for this account.

## Live delivery and recurring protection

Enabled the existing live webhook `hook_2SE1qyvHNjEHfe46cy1KnSGu` after handler deployment.
Its endpoint and all event subscriptions, including refunds, were preserved. Retried the actual
historically failed bare event `evt_QmhjmRo3GzNWneHJTFaK99vy` for an already-settled payment.
PayMongo now shows Success with zero retries at 18:05 Manila. Production logs record HTTP 200
at `2026-09-30T10:05:43.305Z`. No new charge or refund was created by this replay.

Both `paymongo-payment-reconciliation` and `payment-reconciliation-health` run every five minutes;
the HTTP job is 13 and uses the production Vault worker secret. The first scheduled runs at
10:05 UTC succeeded. Readback returned HTTP 200 and `provider_issue=null`. The initial disabled
webhook health check created three deduplicated operator alerts; recovery cleared the health issue.
Request `101369` and the scheduled replay made no duplicate captures. A further scheduled
readback at `2026-09-30T10:25:03.380273Z` remained healthy with `provider_issue=null`;
both five-minute jobs remained active and the reported reservation remained paid.

## Ledger and report audit

Before and after recovery, registration/payment/allocation fingerprints match:

- Registrations: `a4c291ced68aa10c7484a88113f8548e`.
- Single payment financial values: `5d5d9de58a318b99b5f007ffc3036d8f`.
- Group allocations: `d73a808aae77462aa78eb3e01f89a902`.

Snapshot after recovery: 19 paid, one pending, six expired and three cancelled registrations.
The authorized admin registration view has 19 paid entries; the payment view has 18 paid
captures, including the group payment covering two participants. All checked single, group and
reservation gross-minus-processor-minus-platform equals organizer net. No paid payment has an
inconsistent active reservation status. Production traffic continued during verification, so
reservation counts are time-specific rather than fixed release expectations.

The historical incident sweep verified all five failed/expired single checkouts against stored
PayMongo GET expiry confirmations and expired provider checkout pages. No unexplained paid capture
was found there. Intentional review holds are never cleared by the new worker. There are no synthetic
production fixtures or automated live test charges/refunds.

## App promotion and synchronization

Production PR [#212](https://github.com/JSON-FX/race-pace/pull/212) merged reviewed staging
`8c3022b556d495663ec32635f57e7c1fa7ec09af` into main at
`6ff9a1843f454ba52348f24c7b5cb62306b2f8ca`. Both required CI runs
[`36701097717`](https://github.com/JSON-FX/race-pace/actions/runs/36701097717) and
[`36701102905`](https://github.com/JSON-FX/race-pace/actions/runs/36701102905) passed.
The latter passed after retrying the unchanged, pre-existing Next Google font-loader failure.
No branch protection was bypassed. The combined release includes the staged discount runner search.

| Application | Deployment | Verified production aliases | State |
| --- | --- | --- | --- |
| Runner | `dpl_Dw5q2JLfebrYu2ehnuSusgitCGXo` | `www.racepace.com.ph`, `racepace.com.ph` | Ready |
| Admin | `dpl_EMSEXe2Gi4x5rB78pwwP7WNZe9QN` | `admin.racepace.com.ph` | Ready |

Both deployment metadata records identify exact main commit `6ff9a1843f454ba52348f24c7b5cb62306b2f8ca`.
HTTP reads returned 200 for runner events and the admin login destination. The 25 runner and
18 admin script bundles reference only production Supabase, with no staging project reference.
Application, shared-package and backend sources are identical to validated staging `ca2c65f`.
The production admin finance page was reloaded after deployment; the reported customer's
PHP 205.13 payment, PHP 5.13 PayMongo fee and PHP 200 organizer net remain visible.
The release evidence branch contains the production merge commit and only these documentation
updates. Merge it into staging to complete the required main-to-staging synchronization; verify
`git merge-base --is-ancestor origin/main origin/staging` after merge.

## Residual operational limits

Provider downtime can delay confirmation. Recovery retries verified bound checkouts every five
minutes and alerts platform operators when delivery or the worker is unhealthy. A mismatched
capture remains held for investigation. Existing production-safe readback and real event replay
provide release evidence; no new live payment or refund was triggered as a test.

