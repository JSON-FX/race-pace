# Fail closed when ticket signing is unconfigured

Status: implemented and staging verified. Scope: single-payment confirmation and race-day check-in.

## Problem and decision

`confirmPayment` and `check-in` currently substitute the public literal `dev-secret` when `TICKET_SIGNING_SECRET` is absent. A captured payment could therefore mint a predictable ticket, and a check-in station could accept one. The existing group payment service and scanned kit release already require the environment secret. Keep the existing token format and configured-secret behavior; reject a missing or blank secret before minting or verifying a ticket. Return a retryable server error without logging or returning the secret. Existing paid replay remains idempotent.

## Implementation tasks

1. Add a small pure guard in `supabase/functions/_shared/ticket.ts` that rejects absent, empty, or whitespace-only values. Validate with a focused unit test.
2. Use the guard before any ledger correction or `confirm_payment_tx` in `_shared/confirm.ts`, returning a 503 configuration error without changing money or ticket state. Use it in `check-in/index.ts` before token verification and return the same unavailable response. Validate with focused ticket, confirmation and check-in tests.
3. Deploy only `payment-verify`, `payments-webhook`, and `check-in` to staging, where `TICKET_SIGNING_SECRET` is configured. Verify function state and repeat the synthetic check-in smoke test. No production deployment.

## Validation

- `pnpm exec vitest run supabase/tests/confirm-ticket-secret.test.ts supabase/tests/ticket-secret.test.ts supabase/tests/check-in.test.ts supabase/tests/registration-gate.test.ts`
- `pnpm --filter site test`
- Inspect the exact scoped diff for accidental fee or authorization changes.

## Open questions

None. Existing staging configuration and the group-payment fail-closed pattern settle the behavior.
