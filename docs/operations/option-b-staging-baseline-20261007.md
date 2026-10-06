# Option B initial staging baseline — 2026-10-07

Status: backend and app identity verified; complete hosted acceptance and production approval pending.
Times below are UTC on 2026-10-06 unless stated otherwise.

## Source and validation

- PR #223 implemented Option B; PR #224 recovered the already-deployed lifecycle email worker.
- Exact staging revision: `581313241f6e6d32514d803306d0bf6f863173a3`.
- PR #224 CI run `37489704272` and exact staging push run `37490723942` both passed all jobs.
- Local recovery validation: 16 focused cases; frozen Deno graph; 1,011 backend/shared tests
  across 116 files after correcting the isolated macOS test network. Prior same-session app
  typechecks, builds and suites passed without intervening app changes.
- Both environments have the same 180 migration versions, latest `20260930083846`. No migrations applied.

## Applications

| App | Vercel deployment | Environment | Alias |
| --- | --- | --- | --- |
| Runner | `dpl_37KExhZUMhB8jsMzrVeRE425AzFz` | custom staging | `staging.racepace.com.ph` |
| Admin | `dpl_2gdhTLWGuL9BmDPuX8414G5Cp3mN` | custom staging | `staging-admin.racepace.com.ph` |

Both are Ready at the exact revision above. Both `/api/release` responses identify staging
Supabase `pepbmqomiailnnvvwupz`; their SHA marker is null under the existing Git integration.
Git deployment metadata establishes source identity here. The Option B bootstrap build will
establish the explicit marker. Runner `/sign-in` and admin `/login` returned HTTP 200.

Browser readback used the existing staging automation bypass and existing test sessions.
Runner home and admin events/registrations loaded. Vercel's normal SSO redirect returned
`FUNCTION_INVOCATION_FAILED`; automation access succeeded without changing protection settings.
A missing runner `/login` returned 404 during an exploratory check; the app's actual route is `/sign-in`.

## Backend rollout

All 33 tracked hosted functions were deployed from the exact clean staging revision using the
pinned CLI and reviewed import map. `fake-checkout` was excluded and not changed. Every selected
function is Active with a newer version and its expected JWT verification setting. The recovered
worker is version 10. Its unauthenticated POST returned HTTP 401.

The CLI returned nonzero for three attempts. `group-reservations` passed an unchanged retry;
the first attempt's diagnostic was not retained. `platform-users` and `reservation-checkout`
reported successful deployment followed by `Timeout while shutting down PostHog`. Independent
readback proved both deployments succeeded, so they were not blindly repeated. The follow-up
workflow sets `SUPABASE_TELEMETRY_DISABLED=1`; a read-only command with this setting passed.
Actual deployment errors and all hosted verification gates remain fail-closed.

| Function | Version | verify_jwt | Hosted bundle SHA-256 |
| --- | --- | --- | --- |
| `admin-group-refund` | 11 | true | `da8c350fed904d185964642d4188b2ca0bf6086071d1c28e64c765c8dd0c8aef` |
| `admin-refund` | 13 | true | `f485409d312195268f89bf6341dfd8c7ae6d8780aeff50343e5c87fa670cb1ef` |
| `check-in` | 12 | true | `11380fa7fe9f4d7bf8769263aec8c806ab067d6b6aa97dc7ff5b39da652b5788` |
| `coming-soon-delivery` | 4 | false | `38a8b8a66f9f41e2257b805e639df71251fff1d5585dedd4ded308fa811675f1` |
| `coming-soon-subscribe` | 3 | true | `611421e00e21d95ac2f8a980bf3d02740cb5eb90f2a9d0294d405d05ef3a9814` |
| `discount-checkout` | 3 | false | `8258f407a648ad8bd777c1f01748ad56d6244d5c017e19d4030bfc78e32e315c` |
| `expire-coming-soon-reservations` | 6 | false | `5af263140ea584a61760227d1930c138ef393755324e3ae9dc2453997ff5482c` |
| `expire-paymongo-checkouts` | 15 | false | `36f47d0a3f7b95c68d20332e40a21bbf6a03dcd87e55e5fb07940a3af1e35044` |
| `group-order-cancel` | 3 | true | `57e4d4d8750fd55fabdbb4a95313b513ed8d59e6650d5db29d243ab525929ff5` |
| `group-payment` | 15 | true | `4eb1d3920b773749653f751889deb80964a6bc09b401133b15a79677725af94a` |
| `group-payment-prepare` | 12 | true | `1af294ecf1294fc545d7bc0d2a820036929979cb0ea55853f4cb6fbe433f32d3` |
| `group-reservations` | 8 | true | `ada4c571a605406ccfc728beb4c67f4bd9b00d48bb013b1e808b08d7e84e5ace` |
| `group-ticket-delivery` | 14 | false | `e56a806557f344f8bd6d39129f4f7f69770af8de8b1487b62d1318613f355964` |
| `kit-release` | 11 | true | `833bcea31df7e5e07a71869f15917838dffbe71d02e07411ee5bfd32580c56f6` |
| `org-members` | 16 | true | `f400b1370a6bb1ff96e3ca74c1064478d909d0601681a2f0bdb66df41212f9e9` |
| `org-provision` | 17 | true | `768a0e1b5305385d03b539be3b94279832a803df87076495d2e8f7330efc8627` |
| `organizer-inquiry` | 12 | true | `0ee043049a2d7290af027714d8864e63809c285108bfb5d2e1fd51416e3baf35` |
| `payment-session` | 24 | true | `282664a73e92672685a3aebbf1b58e744263226e4468be8d2b28402b99c3a814` |
| `payment-verify` | 23 | true | `0bbd975ee07dff3af224ed7e434ff3c60993599bc68e175733b4939a80b53982` |
| `payments-webhook` | 23 | false | `1a48f164f1fc39f931f2fac77b764adda4aab3378ba5f5f8d1d24ec479b15933` |
| `platform-users` | 7 | true | `35cf6f19e9a858289caacd10f5554b0132613604f261bbca08d433a89327d16e` |
| `prescreening-maintenance` | 5 | false | `8ef4d762837d8ebebdee4c1f0507bac6ea4d0f2cffd37ec239e31ebf0d15b4d0` |
| `prescreening-proof` | 4 | true | `c0e9c76efaecafe4d163dabd4c637c460ab1e49f17de0e125b25ed7262cc58b0` |
| `prescreening-submit` | 3 | true | `47e343064499839ef57734fb4fa08a818e2f70d1ce195dd90025a7064422ccbc` |
| `reconcile-payments` | 2 | false | `9bad53416e360c8f9ae23fa2ffe5167454ca8bcff242bbb6676741ebf23d2e9c` |
| `registrations-checkout` | 24 | true | `cf8c2f209809e808a19e76dc9fb63d2530d73531cfd4f9b21fe939e75e91ee52` |
| `reprice-event-checkouts` | 13 | true | `e0a7affce3137a6787f29ee5297fd46a6f8cb5a146c243c494a72b9e8961ae33` |
| `reservation-checkout` | 6 | true | `3c02f3149001116e10803d72cf7fc61d4dd50c4644a9e27efe3b7f916f49aedc` |
| `reservation-verify` | 6 | true | `6ec4ca46f598bd11fda8b2099227c4f790ad4595a1d057311c82d8418434c908` |
| `send-lifecycle-email` | 10 | false | `0e6443698b633d9b9e5f8ed2859f4c20657d8df6b24cedd9b74f61668cda1f8c` |
| `send-push` | 5 | false | `0f92fa3802a6fc2fd64bf78f6bd47663cbe303f423ab4a49ba9bae7b942786ba` |
| `send-ticket-email` | 13 | false | `dd1fce5be7b7fef521714bfd558161f8d316a9df6adba6c104086ba1bc913f33` |
| `ticket-qr` | 11 | false | `d32fcec9f6fe3488e9de45e260586d6695b8d4222274e2f9dc604bfe9dcc9357` |

## Email and providers

Secret fingerprints confirm staging `PUBLIC_SITE_URL=https://staging.racepace.com.ph`,
`EMAIL_ENVIRONMENT=staging`, and `EMAIL_PROVIDER=resend`. No provider settings, schedules,
Auth settings or hosted secret values were changed during this rollout.

The owner authorized the recipient for one staging test message. A dedicated test outbox row
`942bc5b6-d9c3-4282-9821-a68b860df760` used existing synthetic registration data for
`[TEST] Discount promotion 2`. No registration or payment was changed. The scheduled worker
claimed it once and recorded `sent_at=2026-10-06 15:59:01.253344+00`, with no error.
The owner confirmed receipt with staging labeling. The completed outbox row is retained as
acceptance evidence; it cannot be claimed again. Scheduled worker runs also reported success.

## Credentials and remaining gates

All required GitHub environment secret names are present. Both database passwords passed
TLS-verified `SELECT 1` and were saved by the owner. The dedicated Supabase/Vercel tokens
still require their first protected workflow execution; presence alone does not prove scope.

The existing staging admin session is an organizer QA account. The owner was asked to sign
in as a staging super-admin for the required organization-creation check. Fresh sign-in/recovery,
organization/event creation and tenant-isolation acceptance are not yet complete. PayMongo
test-mode checkout acceptance is not claimed. Production promotion must wait for the required gates.

Production remains at `083bbc749c666aece5a319e5f8b4dc755b6623f5`. No production function,
data, provider, schedule or deployment changed. `OPTION_B_ENABLED` and `RELEASE_BOOTSTRAP_SHA`
remain unset, and both Vercel Git integrations remain connected. No timing improvement is claimed.
