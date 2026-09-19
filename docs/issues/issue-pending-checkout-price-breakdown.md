# Root Cause Analysis: Pending Checkout Price Breakdown

## Issue Summary

- **GitHub Issue ID**: Not supplied
- **Title**: Repriced event shows a false add-on amount on an existing checkout
- **Reporter**: Product owner
- **Status**: Confirmed in production

## Assessment

| Metric | Value | Reasoning |
|---|---|---|
| Severity | High | The page mislabels money immediately before payment, although the provider amount remains the original frozen total. |
| Complexity | High | Existing provider sessions must be expired, verified, replaced, and rebound atomically. |
| Confidence | High | Production rows and both read/write paths prove that a frozen total is being combined with a mutable category price. |

## Problem Description

An organizer changed the pilot category from ₱100 to ₱10 and changed its add-ons to ₱5 and ₱10. An existing ₱100 pending checkout then displayed ₱10 as the entry fee and invented a ₱90 add-on line.

**Expected behavior:** Unpaid checkouts automatically adopt saved category and selected add-on prices. Paid registrations keep their accepted historical prices.

**Actual behavior:** The total stays frozen at ₱100, but the breakdown subtracts the current ₱10 category price and labels the ₱90 difference as add-ons.

## Reproduction

1. Create a pending registration at a ₱100 category price without selecting add-ons.
2. Change the category to ₱10 in the admin event editor.
3. Reload the existing payment page.
4. Observe ₱10 entry fee plus a false ₱90 add-on line.

**Reproduction verified:** Yes. Production registration `a7900660-67a2-47cf-bee4-64e1ae961731` has a frozen ₱100 registration/payment, no selected add-ons, and a current category price of ₱10.

## Root Cause

### Affected Components

- `apps/site/lib/registration.ts` — combines frozen registration data with the live category price.
- `apps/site/app/pay/[registrationId]/PayPanel.tsx` — renders the mixed breakdown.
- `apps/site/lib/payment.ts` — subtracts the supplied base price from the frozen total.
- `apps/web/lib/actions/events.ts` — did not refresh unpaid provider sessions after a price edit.

### Evidence Chain

```text
WHY does the page show ₱90 in add-ons?
→ `breakdown` subtracts the current ₱10 category price from the frozen ₱100 registration total.
  (apps/site/lib/payment.ts:13-16; apps/site/app/pay/[registrationId]/PayPanel.tsx:61-62)

WHY are those values from different moments?
→ The registration query selects `registrations.total_amount` and embeds the mutable `categories.base_price`.
  (apps/site/lib/registration.ts:192-217)

WHY did the total not change when the organizer edited prices?
→ Checkout creation freezes the total, selected add-on prices, provider request, and payment amount.
  (supabase/functions/registrations-checkout/index.ts:203-216,285-322)

WHY did the existing provider amount remain frozen?
→ The event save path never expired and replaced its bound PayMongo checkout session.
  (supabase/functions/payment-session/index.ts:152-180; docs/issues/paymongo-checkout-idempotency.md)

ROOT CAUSE
→ The runner receipt ignores `registration_addons.price`, the historical snapshot already used by the admin receipt, and instead derives history from a live category row.
  (apps/web/components/RegistrationDetail.tsx:86-103)
```

## Impact Assessment

- All pending or completed registrations can show a false add-on amount after their category price decreases.
- A category price increase clamps the add-on line to zero and can also misstate the historical entry price.
- PayMongo still charges the original amount until its session is explicitly expired, so local-only repricing would create a provider/ledger mismatch.
- No unauthorized charge or data corruption was found in this incident.

## Proposed Fix

### Fix Strategy

1. Include `registration_addons(price)` in the runner query so every displayed breakdown uses one snapshot.
2. After an organizer saves an existing event, find pending individual checkouts whose current prices differ.
3. Expire the old PayMongo session and retrieve it to prove no payment was captured.
4. Create a replacement session with the latest category and selected add-on prices.
5. Atomically update the registration, add-on snapshots, payment amount, provider reference, URL, and frozen request.
6. Preserve paid registrations unchanged and record every successful checkout replacement for audit.

### Alternative Approaches

Updating only local rows, or minting a second session without expiring the first, could leave two different chargeable URLs. The implementation therefore uses PayMongo's explicit expiry endpoint and verifies the provider state before replacement.

### Testing Requirements

1. The mapper never invents add-ons by mixing a frozen total with a live category price.
2. A pending ₱100 checkout becomes ₱10 after the organizer changes its category to ₱10.
3. Selected add-ons adopt their latest prices while unselected add-ons do not affect the total.
4. The old provider URL is expired before the replacement is bound.
5. Paid or concurrently captured registrations are never repriced.

## Implementation Plan

1. Update `REG_SELECT` and `mapReg` in `apps/site/lib/registration.ts`.
2. Add the provider-confirmed replacement Edge Function and atomic database hand-off.
3. Invoke it after every existing-event save so a failed attempt can be retried safely.
4. Add pricing behavior copy and regression coverage.
5. Run runner and admin tests, type checks, local migration, function compilation, and `git diff --check`.

## Next Steps

Implement this RCA locally, validate it, and release it through the normal staging-to-production path. No GitHub issue comment will be posted because no issue ID was supplied.
