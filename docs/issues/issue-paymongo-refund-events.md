# PayMongo refund event mismatch — 2026-09-16

Local readiness investigation; no GitHub issue or external comment created.

## Assessment

High severity: asynchronous refunds can finish at the provider while the registration remains paid. High confidence for event-name/status bugs: direct API rejection, provider readback and source evidence agree. Callback races need separate transactional work.

## Reproduction and evidence

- Test-key webhook creation with `refund.updated` returned parameter_invalid. Creation/update with `payment.refund.updated` and `payment.refunded` succeeded.
- `_shared/refund.ts` parks pending results. `payments-webhook/index.ts` only branches on `refund.updated`, so documented notifications reach the ignored-event acknowledgement.
- Existing `backend.test.ts` fixtures repeat the same incorrect name, hiding the integration mismatch.
- Registration `8a73ba41-fde2-4d73-b53d-ca244b0f263f`: test refund `ref_58tE2u2m5E8t2w4oDYys7WtY` returned pending, then GET returned succeeded for 97500 centavos. Local refund remained pending. Refund subscriptions were added after this first request, so this is not proof of an ignored delivered callback by itself.
- `_shared/paymongo.ts` casts an unvalidated refund status. Documented `processing` bypasses the pending branch in `_shared/refund.ts` and reaches finalization without terminal success.
- Relevant original refund code is present in commit 588fc9f; this is a pre-existing integration gap.

## Proposed bounded fix

Recognize documented refund event names, preserving the legacy synthetic alias for compatibility. Confirm actual notification resource shape before finalizing the routing patch. Normalize provider processing to pending and reject unknown statuses. Add regression coverage using documented event names and statuses. Preserve the parked amount, actor and retained net.

## Separate release blockers

- Provider request precedes pending persistence. An early callback may be acknowledged as unknown before a matching row exists.
- Two concurrent refund requests can both pass the pending check before either saves a provider refund ID.
- Lookup errors are treated as unknown refund and acknowledged.
- A failed notification arriving after success can overwrite refund metadata.

These need durable request ownership and replay/reconciliation handling. A routing-only fix does not establish refund readiness.

## Sources and validation

[Supported webhook events](https://docs.paymongo.com/reference/webhook-resource) and [refund statuses](https://docs.paymongo.com/reference/refund-resource). Documentation is inconsistent about other event aliases; provider observations take priority.

Run focused adapter regression tests and signed webhook integration tests against the local simulator, with its matching test signing secret. Never run fake-payment fixtures against the provider-backed function runtime. Then repeat provider test-mode refund delivery.

## Provider evidence and approved implementation scope

Second test refund `ref_ZfN4DeEZhZ1YT3Ydbiih8C6y` produced both signed callbacks after subscriptions were active. The relay received HTTP 200 ignored for both. `payment.refund.updated` contains a refund resource; `payment.refunded` contains a payment resource whose `attributes.refunds` is an array of refund resources. Both carry explicit succeeded status on the refund. This confirms the proposed normalization from actual test provider payloads.

Implement a pure refund-resource normalizer in `_shared/paymongo-webhook.ts`, use it in the existing handler, preserve legacy synthetic notifications, and normalize processing to pending in the provider adapter. Reject unknown provider statuses. Reconcile the actual captured callbacks through the fixed local handler with locally renewed test signatures, keeping replay evidence distinct from original delivery. The separate concurrency and early-callback risks remain open and are not claimed fixed by this bounded patch.
