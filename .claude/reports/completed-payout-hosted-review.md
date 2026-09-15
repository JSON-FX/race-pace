# Completed payout browser test and hosted review — 2026-09-16

## Local browser workflow: PASS
Using the in-app Browser and a dedicated completed sample event:
- Open statement produced PHP1000 gross, PHP0 commission, PHP15 processing, PHP985 net, Ready.
- Submitting without a reference was rejected with Enter the transfer reference.
- Recording QA-SIMULATED-BROWSER-20260916 changed the statement to Paid.
- Direct database read confirmed the payment was stamped with that statement ID.
- A simulated organizer-net refund after payout was applied through the local refund RPC.
- Opening the next statement produced minus PHP985 owed back, with Record recovery rather than Mark paid.
- The recovery dialog correctly said Recover PHP985 from the organizer. A sample recovery reference closed the statement.
- Opening the third statement showed zero gross, zero clawback and zero net: no repeated payout/recovery.

Event: 869f5900-b7d1-471a-a17d-8eccfd07500f.
Registration: ddb4a297-9cda-4f96-8f65-92cdce4202da.
Original payout statement: b42f954c-5040-4ac6-9c8b-9968b3f807fc.
All records are local fake/sample data. No bank transfer or provider refund occurred.

## Hosted release review: NOT READY
- Vercel roots verified: race-pace-web -> apps/web; race-pace-site -> apps/site. Both Next.js, Node24.
- Required variable names exist in Production and Preview. SUPABASE_INTERNAL_URL is absent.
- Sensitive values were masked; actual URL/key correctness is not verified. Temporary environment downloads were deleted.
- Latest branch previews are READY at 8e1321b. Production admin is f13f4bb; production site is 0f520c5.
- Git fetch succeeded. Current branch is one commit ahead and zero behind origin/main. Substantial local readiness changes remain uncommitted and are absent from deployed builds.
- Production admin login, runner homepage and runner sign-in returned HTTP200.
- Production runner /forgot-password returned404. Admin /forgot-password redirected to login instead of showing recovery. This is consistent with the new recovery implementation not being deployed.
- Supabase connector project listing failed. CLI migration and function inventory then returned503 with explicit scheduled-maintenance messages and an estimated completion of 2026-09-15 21:45 UTC (September16 05:45 Manila).
- Local database has98 applied migrations, including six local untracked migration files. Hosted migration/function parity is unknown until the service is available.
- Hosted Auth redirects, SMTP, ticket transport, secrets, webhook configuration and operational jobs were not verified during maintenance.
- Local scheduled jobs remain inactive (count0).

## Documentation and limits
Updated docs/deploy-vercel.md to remove obsolete migration/function counts, name the real projects, separate local keys from hosted keys, document recovery/invitation redirects, and list backend/email release dependencies.

No application code changes, new commits, pushes or deployments in this pass. Existing changes preserved.
No broad tests/builds repeated: this pass exercised the live browser and read hosted metadata, then changed documentation only. git diff --check passed.

Next release steps: finish remaining large-export/local checklist gaps, review and publish the intended revision, recheck hosted configuration after maintenance, apply reviewed backend changes and validate both preview apps before production.

## Hosted follow-up before release commit
Supabase CLI access recovered. Migration inventory now confirms 89 hosted versions and 98 local versions. Nine versions are pending deployment: 20260914213000, 20260915115501, 20260915123631, 20260915174500, 20260915190158, 20260915191046, 20260915200038, 20260915211523, 20260915212629.

Hosted function inventory has 12 functions and does not include kit-release. Secret names include PayMongo, origin, ticket-signing and ticket-email settings. RESEND_API_KEY, EMAIL_FROM and EMAIL_PROVIDER are absent. The email transport defaults to Resend, which requires RESEND_API_KEY; outbound ticket email is not ready on this metadata evidence. Actual secret values and hosted Auth SMTP/redirect configuration remain unverified. No hosted settings, migrations or functions were changed.
