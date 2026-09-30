# Organization discounts: staging release, 30 September 2026

Status: deployed and verified on staging. Production was not changed.

## Source and applications

Feature PR [#202](https://github.com/JSON-FX/race-pace/pull/202) merged as
`55a6c5f680226fd9f065cd5c86655c42d1b85969`. Both final feature-head CI runs
(`36678372327`, `36678377192`) and exact staging CI `36679345519` passed.

| Application | Deployment | State and alias |
| --- | --- | --- |
| Runner | `dpl_9eRfbfKLASiyMx3GjgX2Ko9viP3q` | Ready; `staging.racepace.com.ph` |
| Admin | `dpl_CpmddxK8YapTQG8kYZkr4DCmW9JE` | Ready; `staging-admin.racepace.com.ph` |

The Vercel API identifies the exact merge for both deployments. Browser script deployment IDs
match. Authenticated asset fetches found `pepbmqomiailnnvvwupz.supabase.co` in both applications.

## Database and functions

Staging project: `pepbmqomiailnnvvwupz`. All 178 migrations are applied through
`20260930053856_organization_discounts.sql`. File SHA-256:
`b70f33c82c127daf8908b4c58a076fc783e7921304df4f801417ba9ccd87fc60`.

The CLI reported a pg-delta catalog-cache certificate-file warning after applying the migration.
The command exited successfully. Independent SQL verified the migration history, new tables,
service-only runner mutation grants, and authenticated admin creation grant. Existing 16 registrations
and 12 payments retained their pre-migration status, amount, provider-reference and ticket fingerprints.

| Function | Version | JWT verification | Downloaded source SHA-256 |
| --- | --- | --- | --- |
| `discount-checkout` | 1 | false | `540b8c24dfe7818b147d8f371c7d0afd68f4b68e1995a69be04057a6068a0603` |
| `registrations-checkout` | 22 | true | `9472a0586301a7e83fe0b59c12ee1565cbc00db1db181f00a5e6c1a974aac291` |
| `payment-session` | 22 | true | `e371014d9cdc164c6e4c1d307d54a5476f4386a5842473cdb39ce0e067c639c9` |
| `payment-verify` | 21 | true | `e28e0b2e91d1c1c8ac07c2c2308d56e32018e0f2a51e8837eec8b6270d0cfcd7` |
| `payments-webhook` | 21 | false | `8bb4cedf92e988b40e118ed7973e06c53304de72940d598b028e47ff4909ec77` |
| `group-payment` | 13 | true | `5a5212c5e73fcccb213d02042421b2d16aadd6899c5173dc3fe7269b96745e1f` |
| `group-payment-prepare` | 11 | true | `a551a1739378b853b73c70eaefd717b113911a5b02893ca33d49ad1256ab8486` |
| `expire-paymongo-checkouts` | 13 | false | `9c606298717018366340219416404f73df3baaa2a3f157a8868959393088e4aa` |
| `expire-coming-soon-reservations` | 4 | false | `c21b357d8a630dcefd1dd11053c1438e8d6a5f12033d2b190bd11fe2eb9fa322` |
| `reprice-event-checkouts` | 11 | true | `2d10e416a2bda94fa2191e7626e9973097c74ea5832cc868b1524a98dd8def43` |
| `prescreening-maintenance` | 3 | false | `c4d9e42c658eb01aac8008ac1529d0a654c75cc693f522a3d538c70f20b2a486` |
| `reservation-checkout` | 4 | true | `53f0114e235369a60368388b00b8acfe6032a53e8dda8f1a6fb55e4d3718c093` |
| `reservation-verify` | 4 | true | `277f8c17092007de3178aa2dd3cf14483dc4f7d9aaf5d48ef6d3294c9d844000` |

Every function is Active. Each deployed source bundle was downloaded separately; every file matched
the reviewed checkout byte-for-byte. The hash above covers sorted `path:file-sha256` entries.
The new discount endpoint validates identity itself; an anonymous POST returned 401.
A rolled-back authenticated-role probe confirmed that an unrelated subject sees no discount rows
and cannot administer the test organization.

## Configuration and provider evidence

All Edge secret fingerprints remained unchanged. Group reservation, preparation and payment flags
read back as true by fingerprint. PayMongo checkout displayed its QRPH Test Payment Page; all
recorded `livemode` values for the new paid capture are false. No real charge was made.
Resend settings were not changed; fresh email-provider delivery acceptance was not performed.

## Hosted acceptance

Tests used the existing staging organizer and runner accounts. Two clearly named `[TEST] Discount
release QA` events and two prepared registrations were created solely as fixtures. Registration
creation and waiver UI were not re-tested by these prepared fixtures.

| Check | Result |
| --- | --- |
| Admin regular creation | Created `STAGE20` at 20%, cap 2, scoped to the two test events; created `STAGEFREE` at 100%, cap 1, scoped to the free test event. |
| Admin special generation | Created two unique single-use codes, each with ₱100 off and organizer fee absorption, scoped to the test events. |
| Apply/remove | ₱1,250 became ₱1,000; removal restored ₱1,250. The removed redemption was released. |
| Free confirmation | `52b135ec-f568-4e22-b590-f337ed6949ee` issued a signed ticket. Gross, commission, processor fee and organizer net are all zero; provider reference is null. `STAGEFREE` is redeemed. |
| Discounted PayMongo capture | `b11c99eb-6577-439b-9023-0e362ef3cd69` issued a ticket after a QR Ph simulated capture. Gross 100,000 centavos; platform 3,000; actual processor fee 1,500; organizer net 95,500. `STAGE20` is redeemed. |
| Reporting | Payments and Registrations show the code and savings. Complimentary method is visibly labelled. Payment search by code returns the matching entry. |
| Usage history | Free code shows 1 redeemed and 0 left; percentage code shows 1 redeemed and 1 left. |

The synthetic events, four codes and two paid test registrations are retained for review. No existing
fixture was overwritten. The two fixture payment rows were replaced before dispatch to correct the
fixture-only callback URL; the immutable-request guard correctly rejected an in-place edit first.

Local validation totals 2,410 tests: backend/shared 854, runner 525, admin 1,018 and shared UI 13.
Both application builds, typechecks, 178-migration replay and Fieldnotes audit passed. Fresh review
found two medium reporting issues; both were reproduced, fixed and re-reviewed before merge.

## Remaining promotion checks

This is staging delivery, not production approval. Before a production release, complete the remaining
hosted mixed-group/free-group matrix, approved pre-screening checkout, pass-on special-fee absorption,
provider expiry/retry and refund matrix, and email delivery acceptance. Local tests cover these core calculations and safety guards;
they are not a substitute for the outstanding provider journeys.

Desktop/tablet/phone design acceptance for single checkout and admin is recorded in the existing
design evidence. Group browser coverage is tablet-only. This staging smoke test did not repeat
that entire responsive matrix.

## Evidence files

- Local manifest and full source hashes: `/tmp/discounts-staging-release.json`.
- Backend readback: `/tmp/discounts-staging-bundle-verification.log`.
- Screenshots: `/tmp/racepace-discounts-evidence/staging-*.png`.
- Durable overview: `/Users/jsonse/.codex/visualizations/2026/09/30/01a0f0c6-791a-7a20-a518-99175ce581ee/discounts-staging.png`.
