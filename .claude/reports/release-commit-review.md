# Web and admin pilot release review — 2026-09-16

## Scope
Consolidates the previously reviewed readiness changes: durable refunds and callbacks, runner ticket/refund disclosures, event-scoped check-in, race-kit release, scoped staff invitations, email confirmation/recovery, local Mailpit, report exports and charged-revenue totals. Mobile is excluded. Prior individual review artifacts preserve the scope-specific evidence. This is a release inventory and validation review, not a new independent line-by-line audit of every prior change.

## Validation
- Public site: 374 tests across 40 files pass; fresh typecheck passes.
- Admin: prior final application revision passed 815 tests across 102 files, typecheck and isolated production build. Fresh typecheck also passes. No admin source changes followed that build.
- Backend broad run initially passed 449 of 450 cases. The failing fee-drift test inserted only 14 observations into a global 20-payment sample. Four saved card payments yielded 14/18 disagreements, below the required 80 percent.
- The fixture now fills all 20 observations and expects the exact sample and aggregate delta. Production drift logic is unchanged. Focused rerun passes all 12 processor-rate tests. The final broad rerun passes all 450 tests across 51 files.
- backend.test.ts is excluded from the broad run because several cases assume fake-checkout-only runtime configuration. The earlier selected 13 webhook/pass-on/reconciliation cases passed; 17 other cases were not run in that selection.
- git diff --check passes. Local secret environment files remain ignored. Pattern-based credential scan found no matching secrets in the release files; this is not a guarantee of exhaustive secret detection.
- Existing applied migration files are unchanged. Six new migration files are included.

## Release limits
Hosted has 89 migrations versus 98 local; nine versions require deployment. Hosted kit-release is missing. Hosted Resend credential and sender settings are absent from the secret-name inventory. Actual hosted configuration values, Auth SMTP/redirects, scheduled jobs and provider reconciliation require verification. Both deployed production apps are older than these changes. Large live CSV export and unsupported repeated partial refunds remain documented limits.

This commit does not push, deploy, apply hosted migrations, send real payments or certify production readiness.
