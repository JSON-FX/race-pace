# Financial report dates and processing fees

Settlement mapping uses payment creation as paid_at and discards raw.refunded_at. Payment CSV lacks the processing fee and its source, so its three-party breakdown is incomplete.

Plan: add nullable payments.paid_at and stamp it in the existing atomic confirmation RPC. Backfill only from matching system paid audit entries, whose created_at is the confirmation transaction timestamp; leave unknown legacy dates null. Preserve replay guards and grants. Append processing fee/source and paid_at to the security-invoker payment view. Settlement reads paid_at and validates raw.refunded_at; no checkout-date fallback. Payment CSV shows processing fee/source and labels creation date explicitly alongside paid date. Validate timestamps, replay safety, authorization, CSV values and refund date parsing. Local only, no release.

## Financial reporting fixes verified locally

- FIXED: migration 20260915115501 records payment confirmation time atomically. Existing dates are backfilled only from matching system paid audit entries; unknown legacy dates remain blank.
- FIXED: settlement reads confirmation time and validated refund time. Payment CSV includes recorded processing fee/source and distinct checkout/confirmation timestamps.
- PASS: 743 admin tests and typecheck; final export test rerun 13 passed; reporting and function-grant checks 9 passed; git diff --check clean.
- PASS: authenticated HTTP payment export returns North's three rows and South's header only. Each North row shows PHP 1000 gross, 30 commission, 15 predicted processing, 955 net. Confirmation timestamps differ from checkout timestamps.
- PASS: direct database test confirms payment replay preserves paid_at and refund preserves paid_at while recording refunded_at. This is not a browser refund/payout pass.
- OPEN: browser download remains unverified. Full refund/payout browser reconciliation and PayMongo test mode remain pending. Settlement projection says already banked and exact despite predicted processing fees; review this copy.
- LOCAL ONLY: timestamp migration and code have not been released to hosted Supabase or Vercel. Production readiness remains NO.
