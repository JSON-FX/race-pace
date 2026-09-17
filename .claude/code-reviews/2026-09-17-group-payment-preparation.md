# Review — group payment preparation

Scope: groupPricing.ts, group-payment-prepare/index.ts, migration 20260916173539, and their two test files. Earlier Passport/reservation changes have separate reviews.

Code review passed. No remaining technical issues detected within the preparation slice.

## Checks

- BigInt oracle and SQL bigint/numeric arithmetic avoid floating-point centavo calculations. Per-entry fee clamping and positive half-up rounding match existing commission policy.
- Processor fixed fee is applied once; pass-on gross-up runs on the combined target. Two largest-remainder allocations conserve every total and use stable registration UUID tie-breaking. Free entries receive no proportionate fee allocation.
- Authentication derives the actor from getUser. The service-only definer routine rechecks a verified account. Clients cannot call it or mutate the tables. Same-organization admins and bookers can read their own quotes; other-organizer admins cannot.
- An advisory lock serializes actor/key reuse across orders. The locked order and unique live-attempt index serialize competing keys for one order. Unknown attempts remain live. Retries preserve the same quote even after commission settings change.
- Pending status, complete line count, entry sum, scope, expiry, organization and event availability are rechecked. No provider call takes place inside the transaction or endpoint.
- Preparation is not capture: all financial columns are explicitly predicted/quoted, no legacy payments row is created and no registration is marked paid. No QR is minted.
- Endpoint defaults to disabled and the actual local HTTP smoke returns 503 group_checkout_not_available.

## Deliberate boundaries

This is not provider dispatch, capture, refund or release approval. A subsequent migration must add provider request/session/capture records and explicit transition procedures, and intentionally extend the immutable-field guard. The eventual dispatch worker must recheck order/attempt eligibility before returning a session URL. Failed/expired states may only be assigned after definitive evidence; a timeout or local hold expiry is not enough.

Actual processor fees may differ from this rate-card prediction. Do not turn a predicted net into a paid ledger entry. The eventual capture verifier must validate actual payment identity, gross, currency, fee and net independently.
