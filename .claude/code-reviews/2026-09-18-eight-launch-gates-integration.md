# Eight launch gates integration review

Scope: runner group checkout, optional check-in, Team Name reporting, PayMongo refund and capture safeguards, staging migrations, and launch ledger.

**Stats:** 74 staged files, about 1,803 added lines and 102 deleted lines at review time. No files were deleted.

**Review result:** No unresolved code defect found in the combined local change. The group booking pages are server-disabled by default. The reservation Edge Function merges the Passport identity into each registration's `custom_data`, so the group confirmation can show distinct runner names and tickets. Check-in is enforced in a service-only database transaction, with existing events defaulting to required. The pending-registration DELETE policy prevents a runner from deleting an ordered line or a provider-backed checkout. Refunds prefer a settled capture ID and retain a guarded legacy lookup.

Validation on the combined tree: runner 404/404, admin 870/870, backend 680/680, both TypeScript checks, and staged diff check. The initial backend run used a different local Edge secret file and failed; rerunning against the active function server's file passed all tests.

Staging integration still needs exact-revision Vercel builds, changed Edge Function redeploys, optional check-in browser and marshal tests, group PayMongo sandbox payment/refund/email/report tests, and provider duplicate/expiry replay. Google OAuth remains in Testing with zero test users. Production still has unapplied migrations and no Storage object restore drill. This review is not a production launch approval.
