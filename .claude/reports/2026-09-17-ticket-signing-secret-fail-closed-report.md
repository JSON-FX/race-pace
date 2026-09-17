# Implementation Report — Ticket signing fail closed

**Plan**: `docs/plans/2026-09-17-ticket-signing-secret-fail-closed.md`
**Branch**: `feature/admin-ui-changes`
**Status**: COMPLETE for staging; production remains untouched.

## Summary

Single-payment confirmation now refuses an absent signing secret before any ledger correction or ticket minting. Check-in refuses to verify tokens when the secret is missing. Existing paid replays still short-circuit before configuration checks.

## Tasks completed

- Added a pure configuration guard in `supabase/functions/_shared/ticket.ts`.
- Applied it to `_shared/confirm.ts` and `check-in/index.ts`, returning `ticket_signing_not_configured` with HTTP 503.
- Removed the test-only public fallback and added missing-secret and configured-key tests.
- Deployed payment-verify, payments-webhook and check-in to staging only. A manual check-in after deployment succeeded, and the roster ended at IN 1 / LEFT 0.

## Validation

- Focused secret/check-in tests: 8 passed.
- Registration gate tests combined with focused tests: 34 passed.
- Runner site suite: 393 passed.
- Staging function list: payment-verify v4, payments-webhook v4, check-in v2 all ACTIVE.
- `git diff --check`: passed.

## Deviation and limit

The guard was moved ahead of fee reconciliation after review found that reconciliation could write a payment amount before the original proposed guard location. The missing-secret path was tested in process; staging has a configured secret and was smoke tested on the success path. Production was not modified.
