# Payments — Real Money Engine (real refunds + verified webhook + atomic transitions) — Design Spec (Payments track · A1)

- **Status:** Approved (brainstorm 2026-07-23)
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Track:** First slice of a three-part **Payments** track — **A1 (this spec)** real money engine · **A2** refund approval queue (admin maker-checker UI) · **A3** commission "owed" rollup (org-admin read view). A2/A3 get their own spec → plan cycles.
- **Plan numbering:** Plans **14–16** are reserved on the roadmap (check-in / dashboard / super_admin). This track is additive and foundational; suggested numbering **Plan 17 = A1**, 18 = A2, 19 = A3 (confirm at writing-plans time — do not renumber 14–16).
- **Relates to:** [Plan 13 registrations & payments](2026-07-22-registrations-payments-design.md) (the `admin-refund` Edge Function + `_shared/refund.ts`, the read-only Payments ledger, `decrement_slot`); the PayMongo hosted-checkout integration merged 2026-07-22 (`_shared/paymongo.ts`, `_shared/payments.ts` provider abstraction, `registrations-checkout`, `payment-verify`); the paid-transition `confirmPayment` (`_shared/confirm.ts`); the `payments` / `registrations` / `categories` schema (`20260718183018_registrations_payments.sql`). **Discharges** the deferrals in the Plan 13 spec §10 ("Real PayMongo refund execution — the function has the swap point; wiring the provider is the payments-integration plan") and the money-write atomicity debt recorded in project memory.

## 1. Goal

Make the money engine **real and correct**:

1. **Real PayMongo refunds** — an admin refund actually moves money at PayMongo (test mode today), not just a DB status flip. The provider call is the swap point Plan 13 left as a no-op.
2. **Verified webhook** — payment status reconciles from PayMongo, the payment authority, via a signature-verified webhook that handles both `payment.paid` (confirmation) and `refund.updated` (async refund settlement). Replaces the fake body-based dev stub.
3. **Atomic transitions** — the confirm and refund state changes each become **all-or-nothing** (one DB transaction), removing the sequential non-transactional write pattern that is safe only while the provider cannot fail. It can now: real PayMongo calls genuinely fail.

**Non-goals for A1:** any UI, any runner-facing surface change, the refund request/approval workflow (→ A2), commission rollups (→ A3). A1 is backend/`_shared` + one migration only. Refunds stay invokable through today's `admin-refund` function (admin-authorized inside); A2 later fronts it with the request→approve queue.

## 2. Decisions (from brainstorm)

1. **Webhook owns paid + refunds.** `payment.paid` is an **authoritative** confirmation path (server-to-server; robust even if the runner closes the app before the redirect); `refund.updated` settles async refunds. `payment-verify` (redirect re-fetch) **stays** as the instant-UX path. All confirmation/refund transitions are idempotent, so verify and webhook can both fire — first wins, the other no-ops.
2. **Pending refunds wait for confirmation.** When PayMongo returns a refund as `pending` (common for cards), the DB **does not** flip to `refunded` and **does not** release the slot. It records `payments.raw.refund = { status:'pending', … }` and keeps `status = 'paid'`. Only a `refund.updated` webhook with terminal `succeeded` finalizes (flip + slot release); `failed` clears the pending flag and leaves the registration `paid`. **Never over-releases** a slot on a refund that later fails. **No enum/column migration** — pending state rides in `payments.raw`.
3. **Provider chosen by the payment row, not the environment.** A refund uses the **same provider that took the payment** (`payments.provider`) via `getPaymentProviderByName(name)`, so `fake`/legacy/seed rows refund through the no-op fake provider without a live key, while real `paymongo` rows hit the Refunds API.
4. **Atomicity via `security definer` plpgsql RPCs.** Each transition (confirm, refund-finalize) runs as one plpgsql function = one transaction; the provider **network** call stays **outside** the transaction (Postgres can't do network) and is **ordered first** for refunds so a provider error returns before any DB mutation. Both RPCs are idempotent and race-safe via `SELECT … FOR UPDATE` row locks.
5. **Behavior-preserving refactor.** `confirmPayment` / `refundRegistration` keep their existing signatures, return shapes, and idempotency contracts; internally they delegate the multi-write step to the new RPC. Existing Plan 13 tests stay green.
6. **No new payments column.** Payment-id for the refund call and refund audit both live in `payments.raw` (jsonb).

## 3. Component 1 — PayMongo refund in the provider layer

### 3.1 `_shared/paymongo.ts` (additive)

```ts
// Resolve the pay_… id captured by a checkout session (session.payments[0].id).
export function pmPaymentIdFromSession(session: PmSession): string | null;

export interface PmRefund { id: string; status: "pending" | "succeeded" | "failed"; raw: unknown }

// POST /refunds — amount in centavos, reason optional (PayMongo enum:
// duplicate | fraudulent | requested_by_customer | others).
export async function pmCreateRefund(input: {
  paymentId: string; amount: number; reason?: string;
}): Promise<PmRefund>;
```

`pmCreateRefund` uses the existing `authHeader()` (secret key, Basic auth) and the `parse`-error convention already in the file (`throw new Error("paymongo_refund_failed: …")` on non-2xx).

### 3.2 `_shared/payments.ts` — extend the provider abstraction

```ts
export interface RefundInput  { providerRef: string; amount: number; reason?: string }
export interface RefundResult { providerRefundId: string; status: "pending" | "succeeded" | "failed"; raw: unknown }

export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  refund(input: RefundInput): Promise<RefundResult>;   // NEW
}
```

- **`PayMongoProvider.refund`** — resolve the payment id (from `payments.raw.paymongo_payment_id` if present, else re-fetch the session by `providerRef` and `pmPaymentIdFromSession`), then `pmCreateRefund`.
- **`FakePaymentProvider.refund`** — no-op success: `{ providerRefundId: "fake_refund_" + providerRef, status: "succeeded", raw: { fake: true } }`.
- **`getPaymentProviderByName(name: string): PaymentProvider`** — returns the provider matching a stored `payments.provider` value (`"paymongo"` → `PayMongoProvider`, else `FakePaymentProvider`). `getPaymentProvider()` (env-based, for **new** checkouts) is unchanged.

### 3.3 Payment-id capture at confirm time

`confirmPayment` already receives the PayMongo `raw` (from `payment-verify` and, now, the webhook). When present, it extracts the `pay_…` id into `payments.raw.paymongo_payment_id` as part of the confirm write, so the refund path reads it directly. Older rows without it fall back to the session re-fetch in §3.2. No schema change.

## 4. Component 2 — Real signed webhook (`payments-webhook`)

Replaces the current dev stub (which trusts a `registration_id` in the body — unauthenticated).

**Flow:**
1. **Read the raw text body first** (needed for signature verification — must hash the exact bytes, not a re-serialized object).
2. **Verify signature.** Parse the `Paymongo-Signature` header (`t=<unix>,te=<testSig>,li=<liveSig>`). Compute `HMAC_SHA256(key = PAYMONGO_WEBHOOK_SECRET, msg = `${t}.${rawBody}`)` (hex) and **constant-time compare** against `te` (test) / `li` (live). Mismatch or missing → `401`, no state change. (Optional timestamp-freshness check to bound replay; note only.)
3. **Parse + route** on `data.attributes.type`, resource at `data.attributes.data`:
   - **`checkout_session.payment.paid`** (and/or `payment.paid`) → extract `registration_id` from the session `metadata` (set at checkout) → `confirmPayment(registration_id, method, raw)`. Idempotent (already-paid → no-op).
   - **`refund.updated`** → resolve the registration (via the refund's `payment_id` → the matching `payments` row / its `raw.refund.id`) and reconcile the **terminal** state:
     - `succeeded` → `refund_registration_tx(...)` (finalize: flip + slot release; no-op if already refunded).
     - `failed` → clear `payments.raw.refund.status → 'failed'`, leave registration `paid` (slot stays held).
   - **unknown type** → `200` ignore (so PayMongo does not retry).
4. **Responses:** `200` handled/ignored · `401` bad/missing signature · `500` internal error (PayMongo will retry).

**Idempotency:** every branch delegates to an idempotent function guarded on current status, so duplicate deliveries and verify/webhook races are safe.

## 5. Component 3 — Transactional money transitions (migration + refactor)

New migration `supabase/migrations/<ts>_money_txn_rpcs.sql` adds two `security definer` plpgsql functions (each one transaction), `service_role`-only. Both take a `SELECT … FOR UPDATE` lock on the registration row so concurrent callers serialize and the loser sees the already-transitioned status.

```sql
-- Atomically: payment→paid (+fee/net/method/raw), registration→paid (+ticket), slot+1.
-- Idempotent: already-paid → 'already', writes nothing. Mirrors increment_slot semantics.
create or replace function confirm_payment_tx(
  p_registration_id uuid, p_method text, p_fee int, p_net int, p_token text, p_raw jsonb
) returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_status registration_status; v_cat uuid;
begin
  select status, category_id into v_status, v_cat
    from registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;
  update payments set status='paid', method=p_method, platform_fee=p_fee,
         net_to_org=p_net, raw=p_raw where registration_id = p_registration_id;
  update registrations set status='paid', ticket_token=p_token where id = p_registration_id;
  update categories set slots_taken = slots_taken + 1 where id = v_cat;
  return 'paid';
end $$;
grant execute on function confirm_payment_tx(uuid,text,int,int,text,jsonb) to service_role;

-- Atomically finalize a refund: registration→refunded, payment→refunded (+audit in raw),
-- slot−1 (floored at 0). Idempotent + race-safe. Mirrors decrement_slot semantics.
create or replace function refund_registration_tx(
  p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb
) returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_status registration_status; v_cat uuid; v_raw jsonb;
begin
  select status, category_id into v_status, v_cat
    from registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;
  update registrations set status='refunded' where id = p_registration_id;
  select raw into v_raw from payments where registration_id = p_registration_id;
  update payments set status='refunded',
         raw = coalesce(v_raw,'{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(), 'refunded_by', p_refunded_by,
                 'note', p_note, 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;
  update categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_cat;
  return 'refunded';
end $$;
grant execute on function refund_registration_tx(uuid,uuid,text,jsonb) to service_role;
```

**Refactor (thin functions delegate the write step):**

- **`_shared/confirm.ts`** — keep computing `fee`/`net` (needs `commission_rate`) and minting the ticket (needs `TICKET_SIGNING_SECRET`), then replace its three separate writes with a single `rpc('confirm_payment_tx', …)`. Same signature, same idempotent `{ ok, already? }` return.
- **`_shared/refund.ts`** — new order:
  1. Load registration (`id, category_id, status`) + payment (`provider, provider_ref, amount, raw`); guard (`404`/`already`/`409` as today).
  2. `getPaymentProviderByName(pay.provider).refund({ providerRef, amount, reason:'requested_by_customer' })` — **network, before any DB write.** Throw/`failed` → return `502 provider_refund_failed` / `provider_refund_declined`, **no DB mutation**.
  3. `pending` → write `payments.raw.refund = { status:'pending', id, requested_at, refunded_by, note }`, keep `paid`, return `{ ok:true, pending:true }` (webhook finalizes later).
  4. `succeeded` → `rpc('refund_registration_tx', …)` with the provider refund payload; map `refunded`/`already`/`not_paid`/`not_found` → the existing response codes.

The only remaining non-transactional seam is provider-call ↔ DB, which is unavoidable (no network in PG) and is covered by **ordering** (provider first) plus the **refund webhook** reconciling the terminal state.

## 6. Data flow

**Paid:** runner pays on PayMongo → **(a)** redirect → `payment-verify` re-fetches the session → `confirmPayment` → `confirm_payment_tx`; **and/or (b)** `payment.paid` webhook → verify sig → `confirmPayment` → same RPC. Idempotent → first landing wins, the other no-ops.

**Refund (A1):** admin invokes `admin-refund` (authorized inside the function) → `refundRegistration` → `provider.refund()` →
- `succeeded` → `refund_registration_tx` (flip + slot release) now.
- `pending` → record in `raw`, hold; later `refund.updated=succeeded` webhook → `refund_registration_tx`; `failed` webhook → clear pending flag.

## 7. Edge cases & error handling

| Case | Behavior |
| --- | --- |
| Bad / missing webhook signature | `401`, no state change |
| Provider refund throws (network / PayMongo error) | Return `502` **before** any DB write; money state untouched |
| Provider refund returns `failed` | `502 provider_refund_declined`; no DB mutation |
| Provider refund returns `pending` | `raw.refund={status:pending}`, stays `paid`, slot held; webhook finalizes |
| `refund.updated=succeeded` after we already finalized | `refund_registration_tx` → `already`, no double slot release |
| `refund.updated=failed` on a pending refund | Clear pending flag; registration stays `paid` |
| Refund on non-paid / already-refunded reg | `409 not_refundable` / idempotent `already` (unchanged) |
| Webhook arrives before verify (or vice-versa) | Idempotent RPCs; second is a no-op |
| Legacy / fake / seed payment refund | `FakePaymentProvider.refund` no-op success → RPC finalizes |
| Duplicate webhook delivery | Idempotent (status guards) |
| Mid-transaction DB failure | Whole RPC rolls back — no partial paid/refund; no orphaned slot change |
| Missing `paymongo_payment_id` on an older paid row | Re-derive from session via `provider_ref` before refunding |

## 8. Testing

- **Provider (`_shared`, unit):** `pmCreateRefund` request shape (amount/paymentId/reason, auth header); `PayMongoProvider.refund` resolves the payment id (raw-cached path + session-refetch fallback); `FakePaymentProvider.refund` no-op success; `getPaymentProviderByName` dispatch.
- **Webhook (unit + live-stack):** valid signature accepted / invalid rejected `401` / constant-time compare; routing — `payment.paid` → confirm, `refund.updated`(`succeeded`) → finalize, (`failed`) → clear pending, unknown → `200` ignore; idempotent duplicate delivery.
- **RPC atomicity (root Vitest, live stack):** a forced failure inside each RPC rolls back **all** writes (assert no partial paid/refunded and no slot drift); idempotent re-call returns `already` and writes nothing; concurrent refunds release the slot **exactly once** (`FOR UPDATE`).
- **Refund ordering (unit):** a provider stub that throws ⇒ assert **zero** DB mutation (money state unchanged).
- **Regression:** existing `admin-refund` + confirm/backend suites stay green (behavior-preserving). The fake-provider path keeps the current test seed refundable end-to-end.

## 9. Secrets & one-time setup (operator-run)

- **`PAYMONGO_WEBHOOK_SECRET`** — set via `supabase secrets set PAYMONGO_WEBHOOK_SECRET=…` for the hosted functions. Obtained when the PayMongo **webhook resource** is created.
- **Register the webhook at PayMongo** (once) pointing at the hosted `payments-webhook` function URL, subscribed to `checkout_session.payment.paid` (+ `payment.paid`) and `refund.updated`. Runs against the PayMongo dashboard/API with the secret key → **operator action** (documented in the plan; not automatable from the app).
- `PAYMONGO_SECRET_KEY` (already set for checkout) also authorizes the Refunds API — no new key needed for refunds themselves.

## 10. Out of scope (this slice)

- **Refund request / approval queue** (maker-checker, `refund_requests` table, admin UI) → **A2**.
- **Commission "owed" rollup** (org-admin read view) → **A3**.
- **Partial refunds** (`refunded_amount`) — Refunds API supports a partial `amount`; A1 issues full-amount refunds only (unchanged from Plan 13).
- **Payout / settlement statements**, super_admin cross-org money, commission-rate configuration → Plans 15/16.
- **Dispute / chargeback** webhook events — ignored (`200`) for now.

## 11. File touch-list (for writing-plans)

- **Create (backend):** migration `<ts>_money_txn_rpcs.sql` (`confirm_payment_tx`, `refund_registration_tx` + `service_role` grants) · webhook signature-verification test(s) · RPC-atomicity tests (`supabase/tests/`) · provider-refund unit tests.
- **Modify (backend):** `_shared/paymongo.ts` (`pmCreateRefund`, `pmPaymentIdFromSession`) · `_shared/payments.ts` (`refund` on the interface + both providers, `getPaymentProviderByName`) · `_shared/refund.ts` (provider-first ordering, pending handling, RPC finalize) · `_shared/confirm.ts` (delegate to `confirm_payment_tx`, capture `paymongo_payment_id`) · `supabase/functions/payments-webhook/index.ts` (signature verify + event routing, replacing the stub).
- **No web changes** (A1 is backend-only; the existing Payments ledger already reflects `payments.status`).
- **Docs:** add the A1 plan to `docs/plans/`; note the Payments track (A1→A2→A3) in `docs/README.md` when A1 lands.
