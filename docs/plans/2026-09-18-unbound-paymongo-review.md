# Unbound PayMongo checkout review

Status: planned; no production rollout. Scope: single-runner checkout only. Group checkout remains gated.

## Goal and user story

As a platform super admin, I need to identify a checkout whose PayMongo create response was lost, inspect provider evidence, and resolve it without charging a runner twice or releasing a potentially paid slot. This is a high-risk payment-safety feature. The sandbox returned different checkout IDs for byte-identical requests with the same `Idempotency-Key`, so automatic checkout creation retry is disabled.

## Inherited decisions and current behavior

- The database is the money boundary. Privileged provider calls run in a Deno Edge Function with the PayMongo secret; a single Postgres transaction applies each financial state transition.
- All amounts are integer centavos. `payments.provider_ref` is the single saved checkout ID. The capture inbox and payout hold protect against extra paid evidence.
- `payment-session` returns `checkout_reconciliation_required` for a PayMongo payment with no saved session, without another provider POST. The pending registration keeps its slot.
- The five-minute expiry worker records `missing_session_ref` when no `cs_` ID is available. The deployed trigger creates one deduplicated `payment_review` notification for each platform super admin.
- Admin currently has no review inbox or action for this case. The payments and registrations pages show ordinary pending rows, but do not expose the expiry attempt or capture evidence. Ordinary pending-registration cancellation is intentionally blocked.

## Provider boundary

PayMongo documents retrieval and expiry **by checkout session ID**. The examined public documentation does not establish a way to enumerate every checkout session by Race Pace registration reference. Do not treat an empty local `provider_ref`, a missing webhook, or a passed hold deadline as proof that no chargeable PayMongo session exists. Ask PayMongo to reconcile the account's observed idempotency behavior and supply a supported lookup or formal case evidence before enabling a release action.

The first version may show a case and allow staff to record provider evidence, but must **not** automatically release the held slot or retry checkout creation. The safe default is an unresolved hold with visible escalation. This keeps a runner waiting, but does not create a second chargeable session or oversell an event.

## Context to read before implementation

| File | Why |
|---|---|
| `docs/issues/paymongo-checkout-idempotency.md` | Sandbox evidence and failure mode. |
| `supabase/functions/payment-session/index.ts:75-179` | Authorization, existing bound-session reuse, unbound refusal. |
| `supabase/functions/expire-paymongo-checkouts/index.ts:20-77` | Worker attempt recording and provider expiry behavior. |
| `supabase/functions/_shared/paymongo.ts:1-102` | Secret-key GET and expire calls; use the same client. |
| `supabase/migrations/20260917211002_single_payment_capture_inbox.sql:1-181` | Capture replay and payout hold invariants. |
| `supabase/migrations/20260917212328_provider_confirmed_checkout_expiry.sql:1-140` | Attempt table, guarded expiry transaction and grants. |
| `supabase/migrations/20260918115000_alert_unbound_paymongo_checkout.sql:1-36` | Notification trigger. |
| `apps/web/lib/queries/payments.ts:1-76` and `apps/web/lib/queries/registrations.ts:1-175` | Current admin projections. |
| `apps/web/lib/actions/registrations.ts:1-100` | Server-action and error patterns. |
| `apps/web/app/(admin)/payouts/page.tsx:1-90` | Platform-only page gating. |

Official provider references: [idempotent requests](https://docs.paymongo.com/reference/idempotent-requests), [checkout-session retrieval](https://docs.paymongo.com/re/reference/get_checkout_sessions), [checkout-session resource](https://docs.paymongo.com/reference/checkout-session-resource), and [webhook behavior](https://docs.paymongo.com/reference/webhook-resource). The sandbox observation conflicts with the general idempotency reference; code must follow observed safe behavior until the provider resolves it.

## Implementation plan

### 1. Read-only platform review queue

Create a follow-up migration rather than changing applied migrations. Add a `security definer` or carefully authorized view/RPC that returns only unresolved PayMongo single-registration cases to `auth_is_super_admin()`. Include registration/event/org IDs, age, payment amount, checkout-request presence, saved provider ID, latest expiry attempt, capture count/state, and notification time. Do not return provider secrets, raw payment payloads, private Passport fields, or customer contact data unless the review action needs them. Revoke default function EXECUTE and grant only the required role; test `has_function_privilege` and RLS isolation.

Add an admin route under the platform navigation with count, sortable oldest-first cases, plain status and a copyable internal registration reference. Render provider data as evidence, not an instruction. A non-platform organizer receives no rows and cannot invoke the review RPC or page action.

**Validation:** focused migration/grant tests, admin query/component tests, both typechecks, and a rollback-only two-role staging query. The page must show an unbound fixture and hide it from organizer access.

### 2. Evidence capture and audit

Add an append-only review/evidence table with registration ID, staff user ID, timestamp, provider session ID when known, PayMongo support case/reference, action type and a narrow structured provider snapshot. Do not store credentials or a free-form unredacted provider response. Only the platform super admin may add evidence through a privileged Edge endpoint; writes must be idempotent by a stable action ID.

The Edge endpoint checks `getUser()` and platform role, validates a `cs_` ID, GETs that session with the secret key, verifies the merchant's test/live mode, Race Pace registration reference or metadata, amount, currency, and provider payments, then records a sanitized snapshot. A mismatch or unavailable GET leaves the hold unchanged and returns a specific review error. Never take a client-supplied claim of `expired`, `paid`, or `no other sessions` as provider truth.

**Validation:** mocked provider tests for wrong ID/reference/amount/mode, 404/5xx, paid/expired/active status, duplicate submissions and authorization; database tests for immutable audit and no role leakage.

### 3. Guarded resolution, only after provider lookup is established

If PayMongo supplies a supported, complete way to identify **all** sessions for a registration, add a single guarded database RPC that serializes with capture confirmation. For a verified paid capture, use the existing capture inbox and confirmation path. For every verified unpaid active session, expire it, GET it again, and require `expired` with no paid capture before releasing the local hold. If any provider call or identity check is uncertain, leave the case pending and the slot held.

If PayMongo cannot prove a complete session set, do **not** offer a one-click release. Staff must escalate the case to PayMongo and retain the hold until documented provider evidence is strong enough for a separately reviewed manual policy. Binding one discovered session alone does not prove another orphan does not exist, because the sandbox created two IDs for one idempotency key.

**Validation:** concurrency tests race resolution against webhook/capture; prove at most one ticket, no premature slot release, duplicate action replay, and payout hold whenever paid evidence is unresolved. Run a controlled staging sandbox case and verify provider/dashboard state plus ledger, ticket and slot counts. Do not create a synthetic paid webhook and call it a live capture test.

### 4. Operational visibility and release gate

Document who monitors the queue, the response target, how PayMongo case evidence is attached, and when a hold can be reviewed again. Alert on aged unresolved cases and a missing/stalled expiry worker. Keep group checkout flags off. Update `docs/operations/launch-progress.md` after staging verification, then run `pnpm --filter site typecheck`, `pnpm --filter web typecheck`, `pnpm --filter web test`, root `pnpm test`, function-grant tests, and exact-merge CI. Only deploy to staging first.

## Acceptance criteria

1. A real `missing_session_ref` attempt appears in a platform-only review queue and in no organizer's view.
2. Repeated expiry attempts create one alert and preserve the pending registration and slot.
3. Evidence lookup never creates another checkout session or changes payment, ticket, slot or payout balances by itself.
4. A provider mismatch, unavailable response, paid capture, or incomplete session inventory leaves the hold unresolved.
5. Any later release transition is atomic, replay-safe and blocked by unresolved capture evidence.
6. The staging test confirms zero residual QA rows after rollback/cleanup. Production receives no sample data.

## Assumptions and open provider dependency

- Assumed from the user's no-hard-gate instruction: deliver a read-only review queue and evidence capture first, with no release control until provider lookup guarantees are known. This is the safest behavior and may leave a slot held longer.
- PayMongo must explain why the test account minted distinct v1 and v2 sessions for an identical idempotency key. Do not send account details or a support request without authorization.
- The public reference found only session-by-ID retrieval; a complete session enumeration contract is unverified. Do not infer one from payment listing or webhook delivery.
- No production rollout or group checkout enablement is part of this plan.

## Amendments

- None yet.
