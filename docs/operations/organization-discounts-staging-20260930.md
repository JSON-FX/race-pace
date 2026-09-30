# Organization discounts: staging release, 30 September 2026

Status: staging acceptance passed; production promotion authorized. Production is unchanged at this checkpoint.

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

## Production promotion acceptance

The owner authorized production promotion after staging checks pass. The final staging source is
`f7ded2161e87a9e662ff7b65d30e770688b5e5a5` (PR #203). Exact CI `36682538269` passed.
Application/backend trees are identical to the reviewed feature merge `55a6c5f`; PR #203 is documentation only.
Both aliases were independently read back as Ready at `f7ded21`:

- Runner: `dpl_2jhMAMWsCUv2PRogJfwDEJLeZTtX`.
- Admin: `dpl_3finFjqJY4wUPhx1uDuPN3SgwxLu`.

Additional hosted Browser acceptance used a dedicated synthetic organization,
`21a2410a-a918-4ec2-b3d6-71d0af752109`, with pass-on fees and 3% commission. Four events,
six prepared registrations and four codes were added there. A fifth code, `GATESCREEN`, was scoped
to the existing synthetic screening event in the original QA organization. No production fixture was added.

| Scenario | Result and evidence |
| --- | --- |
| Entire free group | Order `d26d96f5-9ec1-4ff8-9cf7-b8aff7a4c7af` confirmed two tickets with `GATEFREE`. Each allocation has gross, commission, processor fee and organizer net of zero. Delivery job sent on its first attempt. |
| Mixed free and discounted group | Order `e667240e-a1a9-4d9c-9d3c-efabe43054c0` used `GATEMIXFREE` for the booking runner and `GATE20` for the managed runner. GCash test capture `pay_51Hg1naKmid9cJWMUAC19L7r` fulfilled both tickets. Paid allocation: 84,513 gross, 2,400 commission, 2,113 processor fee, 80,000 organizer net. Free allocation: all zero. Provider livemode=false. |
| Discounted participant refund | Request `cb898594-1e4d-4243-a0d8-97c03b2c1b57`, provider `ref_hBF82iVayUCeXLGWdNtwZ8nD`, succeeded for 80,000 centavos with livemode=false. Fees of 4,513 were retained. The managed runner became refunded with no ticket; the free sibling stayed paid with its ticket. Reloaded admin reporting showed the refund and both discount codes. The refunded redemption remained consumed. |
| Close unpaid checkout and retry | The UI locked code changes after dispatch. The close action expired `cs_1e7580a04da39bdef2e7d810`; the restart journal records provider GET evidence of expired. The code became editable without extending the hold. Removed `GATE20` redemption was released. A replacement checkout used a different provider session. |
| Special absorption on pass-on organization | Registration `b2821913-02f7-4195-a52e-9cc9c03ac40f` applied `GATESPECIAL`: 100,000 original less 10,000 savings, total 90,000. PayMongo displayed no added fees. QR Ph test capture fulfilled the ticket with commission 2,700, processor fee 1,350 and organizer net 85,950. All recorded livemode values are false. Organization fee mode remains pass_on; only this checkout absorbs fees. |
| Approved screening checkout | Existing approved managed application `1aa2625d-dc71-4a68-b358-aa320dd047e2` completed the real hosted entry form using its explicitly fictitious QA waiver. Order `7dc8271d-15a9-4118-bfd0-ca9267ae2e7c` applied `GATESCREEN`, confirmed registration `d631c10f-a8c0-41e8-b971-98706b643c24` at zero, and issued its ticket. Batch became completed. Original deadline stayed `2026-10-02T20:39:53.590339Z`; rejected sibling was not enrolled. |
| Provider email delivery | Resend reports Delivered for free-group email `01a0f12d-6cfa-709f-986b-d3fd2d16a05e`, mixed-group email `01a0f130-2b42-70ac-b6cb-06a9840e7379`, and special-entry email `01a0f134-138c-739e-9219-be6bbfd2448b`. Special-entry detail confirms `Race Pace Staging <staging@notify.racepace.com.ph>`, the TEST—STAGING marker, total paid ₱900 and a staging ticket URL. Earlier single-free and percentage-payment emails also show Delivered. |
| Responsive group summary | Hosted 390px view showed both participant codes, savings, commission and payment action with no horizontal overflow. Desktop group flows passed. Existing local tablet evidence remains applicable because application source is unchanged. |

The prepared single-payment fixture initially used the lower-level provider request shape. It lacked
`returnUrl` and failed before a checkout POST. Only the two owned, undispatched fixture payment rows
were corrected. An explicit GCash-only fixture then received a definitive capability rejection and
returned to prepared; it was changed to the advertised QR Ph method. The fixture callback path was
corrected after provider-confirmed expiry and before replacement dispatch. These were fixture defects,
not application-source edits. Existing registrations and provider sessions were not reset.

The unused fourth synthetic event has one prepared, unpaid registration retained for inspection and
normal expiry. The other synthetic records, refunds, restart journal and codes are retained as evidence.
The screening journey additionally proves registration creation through the deployed application;
prepared group fixtures do not establish that earlier entry-form step.

All discount-specific promotion checks listed at the earlier checkpoint are complete. The unchanged
Auth, organization/event setup, private-proof and reservation paths retain their prior release coverage;
this release rechecked authenticated staging access, isolated discount authorization, deployed source,
provider mode and actual transactional delivery. No production payment or refund is an automated gate.
The owner performs any live financial acceptance after release.

## Evidence files

- Local manifest and full source hashes: `/tmp/discounts-staging-release.json`.
- Backend readback: `/tmp/discounts-staging-bundle-verification.log`.
- Screenshots: `/tmp/racepace-discounts-evidence/staging-*.png`.
- Durable overview: `/Users/jsonse/.codex/visualizations/2026/09/30/01a0f0c6-791a-7a20-a518-99175ce581ee/discounts-staging.png`.
