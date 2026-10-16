# Payment confirmation repair and focused hardening

Spec: [payment confirmation hardening](../specs/2026-10-16-payment-confirmation-hardening.md).
Base: `origin/main` at `2c9637dcb86e8eabefeb974a8cab5fb1672bf0b8` after verified Option B activation.
Worktree: dedicated `codex/payment-confirmation-hardening` branch. Preserve the shared checkout.
Status: implementation and independent review complete; local validation complete; staging acceptance pending.

## Decisions

Reuse `booking_payment_captures.state='received'` and the existing reconciliation cron.
Add no queue service or provider dependency. Persist provider evidence first; continue
the existing atomic fulfillment afterward. Use a separate, tenant-checked progress RPC
for runner/admin displays. Keep financial reports based on fulfilled allocations.
The approved scope settles product behavior; no open product decisions block work.

## Step-by-step tasks

1. **Database repair and capture inbox.** Add a new migration with the explicit
   pre-screening alias correction. Add service-only `booking_payment_capture_observe`
   and `booking_payment_capture_failure` functions. Observation returns the persisted
   capture state and never replaces existing evidence. Confirmation resumes received
   evidence, preserving terminal states and all validation. Add diagnostics and safe
   progress/retry RPCs with explicit grants. Check checkout, expiry, payout, and worker
   predicates against durable captures. Add real PostgreSQL regression coverage.
   **VALIDATE:** focused backend tests plus `function-grants.test.ts`.
2. **Edge recovery path.** Observe all verified captures before fulfillment and before
   reading the ticket-signing secret. Retry received captures directly from storage.
   Record fulfillment errors separately; return processing only after durable persistence.
   Permit webhook acknowledgement for durable processing. Add authenticated, audited
   administrator retry to the existing group-payment endpoint. Keep ownership checks
   for session/verify. Cover failure after receipt and provider outage during recovery.
   **VALIDATE:** group payment, reconciliation, webhook tests and frozen Deno graph.
3. **Runner and organizer display.** Add a scoped progress lookup for booking orders.
   Show received/processing and review states. Block duplicate checkout controls.
   Show safe diagnostics and authorized retry in the organizer registration details.
   **VALIDATE:** focused component/query tests and both application type checks.
4. **Integration and review.** Run the required local CI checks against an isolated
   Supabase instance: backend/shared tests; site/web tests, types and production builds;
   shared UI audit/tests/types; frozen Edge graph. Perform an independent PIV review
   of transaction boundaries, authorization, retry races, and money invariants.
   **VALIDATE:** all selected checks pass and findings are resolved.
5. **Staging release and acceptance.** Commit the reviewed change, open/attach its PR,
   pass CI, merge through the active release process, and inspect exact staging evidence.
   Complete test-mode provider and browser acceptance for an approved pre-screened
   booking; verify organizer paid status, capture/allocation/ticket invariants, replay,
   and safe received/processing recovery. Use synthetic staging data only.
   **VALIDATE:** record candidate SHA, both deployment IDs, migration/function inventory,
   provider modes, acceptance results, and production job awaiting owner approval.

## Tests that must fail before the fix

- Approved pre-screened one-person checkout confirms without SQLSTATE 42703.
- Multiple approved entries confirm atomically with correct fees and tickets.
- Expired/released approval holds and captures outside the deadline remain under review.
- Forced fulfillment failure leaves the observed capture committed and visible.
- Recovery works from that evidence when PayMongo GET is unavailable.
- Concurrent webhook/runner/worker replays produce one fulfillment and delivery.
- Different payment IDs cannot settle the same order twice; evidence cannot be rewritten.
- Runner/other-tenant requests cannot read diagnostic rows or invoke administrator retry.
- Retry of a business-review capture is rejected and every allowed manual retry is audited.
- Unresolved captures block duplicate checkout, expiry/release, and payout settlement.

## Production handoff

Report staging results before requesting production approval. Deployment and recovery of
the reported payment are separate, later authorized actions. Recovery must reuse the
verified provider capture and normal confirmation path; never patch a paid flag manually.
