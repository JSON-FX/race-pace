# Root Cause Analysis: GitHub Issue #51

## Issue Summary

- **GitHub Issue ID**: #51
- **Issue URL**: https://github.com/JSON-FX/race-pace/issues/51
- **Title**: Handle distinct duplicate PayMongo paid captures safely
- **Reporter**: JSON-FX
- **Status**: Open

## Assessment

| Metric | Value | Reasoning |
|---|---|---|
| Severity | Critical | A second captured charge is contained but cannot be refunded or cleared without service-role SQL, leaving customer money and payouts blocked. |
| Complexity | High | The fix crosses the capture ledger, PayMongo refund orchestration, webhook reconciliation, authorization, admin operations and payout safety. |
| Confidence | High | The complete capture, confirmation, refund, webhook and payout paths were traced with existing database tests. |

## Problem Description

A distinct second PayMongo payment for an already fulfilled registration is durably recorded and quarantined. It creates no extra registration, ticket, slot use or organizer payable amount, but platform staff have no supported way to refund it and clear the payout hold.

**Expected Behavior:** The platform must show the exact extra capture to a super admin, fully refund that immutable `pay_` payment through an idempotent workflow, preserve the valid registration, and release the payout hold only after provider-confirmed success.

**Actual Behavior:** The extra capture remains permanently `reconciliation_required`. The normal refund path targets the settled registration capture and changes registration accounting, so it is unsafe for the extra charge.

**Symptoms:**
- Super admins receive a notification but have no capture review page or action.
- Payout opening, refresh and payment remain blocked.
- A safe capture-specific refund and audit record do not exist.

## Reproduction

1. Complete one PayMongo payment for a registration.
2. Present a different paid `pay_` resource for the same registration and checkout session.
3. Observe `extra_capture`, no duplicate fulfillment and a payout hold.
4. Attempt to resolve it through web admin.
5. No supported action exists.

**Reproduction Verified:** Yes, through code tracing and the existing capture inbox test.

## Root Cause

### Affected Components

- `supabase/migrations/20260917211002_single_payment_capture_inbox.sql`
- `supabase/functions/_shared/confirm.ts`
- `supabase/functions/_shared/refund.ts`
- `supabase/functions/payments-webhook/index.ts`
- `apps/web/app/(admin)/checkout-reviews/`
- `apps/web/lib/actions/payouts.ts`

### Analysis

The capture inbox change implemented detection, durable evidence, notification and payout containment. It did not implement the operator recovery half of the workflow.

**Evidence Chain (5 Whys):**

```text
WHY does an extra paid capture remain unresolved?
→ The capture state has detection states only and no refunded terminal resolution.
  (20260917211002_single_payment_capture_inbox.sql:4-21)
WHY can the existing settle function not clear it?
→ single_capture_settle deliberately returns reconciliation_required unchanged.
  (20260917211002_single_payment_capture_inbox.sql:102-121)
WHY can the normal refund workflow not resolve it?
→ It selects only the settled primary capture and applies registration-level refund accounting.
  (supabase/functions/_shared/refund.ts:79-99)
WHY is registration-level accounting unsafe?
→ The extra capture never contributed a ticket, slot, payment ledger amount or organizer payable balance.
WHY is there no alternative?
→ No capture-specific refund request, reconciliation RPC, Edge Function or admin action was implemented.
ROOT CAUSE: durable containment was shipped without an operator recovery workflow.
```

### Related Issues

The existing unbound-checkout queue is platform-only and provides a suitable location and authorization pattern, but it does not query capture incidents or perform financial actions.

## Impact Assessment

**Scope:** Any distinct extra PayMongo capture on a single registration. Same-ID webhook replay is already idempotent.

**Affected Features:** Payments, refunds, payout statements, support operations and accounting.

**Severity Justification:** Customer funds may remain captured while every payout for the event stays blocked. Manual SQL is not an acceptable production recovery path.

**Data/Security Concerns:** The current design prevents duplicate fulfillment and overpayment. The missing recovery path creates operational and financial risk rather than tenant data exposure.

## Proposed Fix

### Fix Strategy

Add a durable capture-specific refund request ledger. Claim the exact provider payment ID before network work, submit a full refund with a stable idempotency key, consume early webhook events, and mark the capture refunded only after verified success. Expose unresolved captures and the refund action only to platform super admins. Keep the legitimate registration, payment, ticket, slot and organizer balance unchanged.

### Files to Modify

1. **New follow-up Supabase migration**
   - Add the refund request model, claim/bind/uncertain/apply RPCs, terminal capture state and platform review query.
2. **New capture refund Edge Function and shared PayMongo helpers**
   - Orchestrate preview, submit and retry by immutable payment ID.
3. **`payments-webhook/index.ts`**
   - Reconcile capture-specific refund events before the registration refund path.
4. **Web-admin checkout reviews**
   - Show capture incidents and provide an explicit, confirmed full-refund action.
5. **Payout error mapping**
   - Explain that a capture review blocks the statement.
6. **Tests**
   - Prove unchanged fulfillment/accounting, authorization, idempotency, refund outcomes and payout release.

### Alternative Approaches

A service-role SQL runbook could change state after an external refund, but it has no idempotency, provider verification or safe audit trail. Reusing registration refunds would incorrectly change the valid booking and accounting.

### Risks and Considerations

- A timeout after provider submission must remain retry-safe.
- Failed or pending refunds must keep the payout hold.
- Only `extra_capture` incidents can use the automatic full-refund action.
- Provider payment ID, amount and refund metadata must match before resolution.

### Testing Requirements

1. Settle the legitimate capture, then record a second capture.
2. Assert one registration, one ticket, one slot and unchanged organizer payable amount.
3. Assert payout is blocked and only super admins see the incident.
4. Assert preview and claim use the exact gross amount.
5. Assert retry reuses one refund request and idempotency key.
6. Assert pending/failed/unknown outcomes keep the hold.
7. Assert succeeded provider evidence marks only the extra capture refunded and releases the hold.
8. Assert wrong amount, payment ID or tenant access is rejected.

**Validation Commands:**

```bash
pnpm exec supabase db reset
pnpm exec vitest run supabase/tests/single-payment-capture.test.ts
pnpm exec vitest run supabase/tests/single-capture-refund.test.ts
pnpm --filter web test
pnpm --filter web typecheck
pnpm test
```

## Implementation Plan

1. Add the capture refund ledger and database transitions.
2. Add provider orchestration and webhook application.
3. Add the super-admin review and refund interface.
4. Add focused database, Edge and UI regression tests.
5. Run focused and full validation, then deploy to staging for a PayMongo sandbox proof.

## Next Steps

1. Implement this RCA with `piv-implement-issue`.
2. Validate locally and review the full diff.
3. Merge to staging and run a real sandbox duplicate-capture recovery test.
4. Promote only after staging proves refund success and payout release.
