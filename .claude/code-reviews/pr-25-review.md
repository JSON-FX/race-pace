# PR #25 review — `feature/admin-ui-changes` → `staging`

Reviewed draft PR [#25](https://github.com/JSON-FX/race-pace/pull/25) at head `b9d1307c6285f58e97e70648c0671e02e88e1d20`, against base `ef951887f2dabb47823f9236bb13c877a9b97e5f`. This is a local review report. No GitHub review was posted.

## Recommendation

Keep the PR as a draft and do not promote this revision to production yet. I found no high-confidence critical or high code issue in the changed paths. The PR itself identifies unresolved staging acceptance exercises involving actual provider behavior, browser flows, and group emails. Those exercises are essential before enabling the group flags or promoting the migrations and Edge Function consumers.

## Findings

No confirmed critical or high code findings. Two medium readiness concerns need explicit closure:

1. **Medium — Group checkout lacks a verified end-to-end acceptance run.** `apps/site/app/register/[categoryId]/group/page.tsx:12` gates the entry with `GROUP_CHECKOUT_ENABLED`. The UI records one waiver acceptance per selected participant at `apps/site/app/register/[categoryId]/GroupRegister.tsx:85-95`, but only component-level and backend tests are recorded. Before enabling the flag, exercise a real managed Passport, two independent acceptances, a PayMongo sandbox return, individual tickets, email delivery, expiry, and a refund. This is an unverified release gate rather than a demonstrated logic defect.

2. **Medium — Hosted provider and migration behavior remains unverified.** The three new migrations add the check-in mode and audit, capture review notification, and safe deletion policy. `supabase/functions/_shared/refund.ts:83-96` now prefers a settled capture payment ID and falls back to session lookup for historical charges. Verify staging has the exact migration definitions, deploy changed Edge Function consumers, then exercise late/duplicate captures, unknown checkout creation, nonempty expiry, refunds, payout hold, notifications, optional check-in, and report downloads. Local tests cannot establish the provider's live response shape or hosted grants.

The migration headers at `supabase/migrations/20260918100000_optional_event_checkin.sql:1` and `supabase/migrations/20260918113000_payment_capture_review_notifications.sql:1` say these versions have not reached hosted, while the PR body says all three are already on staging. Confirm the deployed staging SQL matches this exact revision. An applied migration version will not be replayed merely because its file later changes.

## Validation and positive evidence

| Gate | Result |
| --- | --- |
| Exact local HEAD and PR head | Match: `b9d1307c6285f58e97e70648c0671e02e88e1d20` |
| `git diff --check origin/staging...HEAD` | Pass |
| Site tests / admin tests / backend tests | 404 / 870 / 680 pass, per combined-revision PR evidence; not independently rerun in this review |
| Both TypeScript checks / GitHub checks | Reported pass; not independently rerun in this review |
| Hosted browser and provider acceptance | Pending, as stated in PR body |

The group order page checks the signed-in booker before rendering and relies on tenant-scoped row-level security for later reads. The reservation transaction rechecks Passport access, event waiver version, participant uniqueness, capacity, and current form fields under locks. The optional check-in transaction checks event mode under a row lock before writing attendance. The pending-registration delete policy excludes ordered lines and all PayMongo-backed payments. Review-alert failure is isolated from capture persistence, and the refund path keeps the original request ID for provider idempotency.

Scope reviewed includes the PR diff, relevant complete UI/Edge Function files, reservation and payment foundation migrations, the three new migrations, existing test coverage, and implementation reports. This review did not run hosted mutations or browser acceptance.
