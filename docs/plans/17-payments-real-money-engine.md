# Payments — Real Money Engine (A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin refunds actually move money at PayMongo, reconcile payment status from PayMongo via a signature-verified webhook, and make the confirm + refund state transitions atomic (all-or-nothing).

**Architecture:** Two `security definer` plpgsql RPCs run each money transition in one transaction; the confirm/refund Edge-Function code becomes thin wrappers that call them. The `PaymentProvider` abstraction gains a `refund()` method (real for PayMongo, no-op for the fake/local provider, chosen by the payment's own `provider` column). The `payments-webhook` function is rewritten from an unauthenticated dev stub into a signature-verified handler that owns `checkout_session.payment.paid` (authoritative confirmation) and `refund.updated` (async refund settlement). Backend/`_shared` only — no web or mobile changes.

**Tech Stack:** Postgres (plpgsql `security definer` functions) · Supabase Edge Functions (Deno, `crypto.subtle` HMAC) · PayMongo Refunds API + webhook signatures · root Vitest against the live local stack (`supabase start` + `supabase functions serve`).

**Spec:** [docs/specs/2026-07-23-payments-real-money-engine-design.md](../specs/2026-07-23-payments-real-money-engine-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Backend-only.** No `apps/web` or `apps/mobile` changes. The existing read-only Payments ledger already reflects `payments.status`.
- **Additive migration; no enum/column change.** Both enums already carry `refunded` (`registration_status` = `pending,paid,refunded,cancelled`; `payment_status` = `pending,paid,failed,refunded`). Refund audit + pending-refund state ride in `payments.raw` (jsonb). New migration file: `supabase/migrations/20260723100000_money_txn_rpcs.sql` (after the latest existing `20260722122753_profile_images_avatar_cover.sql`).
- **RPCs are `security definer`, `search_path = ''`, fully schema-qualified, `service_role`-only** (revoke from public, grant execute to `service_role`). Row-locked (`select … for update`) so concurrent callers serialize; idempotent via status guards.
- **Behavior-preserving refactor.** `confirmPayment(registrationId, method, raw)` and `refundRegistration(registrationId, refundedBy, note)` keep their signatures, return shapes (`{ ok, already? }` / adds `pending?`), and idempotency contracts. The `admin-refund` endpoint contract (403/404/409/200) is unchanged.
- **Provider chosen by the payment row, not env.** Refunds use `getPaymentProviderByName(payments.provider)`. `getPaymentProvider()` (env-based, for new checkouts) is unchanged. `FakePaymentProvider.refund` is a no-op success so fake/seed/legacy rows refund without a live key.
- **Ordering.** In a refund, the provider network call happens **before** any DB mutation (a provider failure returns `502` with zero DB writes). **Pending** refunds (`status:'pending'`) record `payments.raw.refund={status:'pending',…}` and **do not** flip status or release the slot — the `refund.updated=succeeded` webhook finalizes; `failed` clears the pending flag.
- **Refund `reason`** default = `requested_by_customer` (a single named constant, easy to change).
- **Local test environment (critical):**
  - Set `PAYMONGO_WEBHOOK_SECRET=whsec_test_localdev` in `supabase/functions/.env`; **restart** `supabase functions serve` after editing it.
  - **Do NOT set `PAYMONGO_SECRET_KEY` locally** — leaving it unset keeps checkout on the fake provider (`fake-checkout` page), so the suite runs without hitting real PayMongo. Real PayMongo refund + real webhook delivery are verified manually in test mode on the hosted deployment (see Task 5).
  - Tests compute webhook signatures with the same literal `whsec_test_localdev` (a test-only value; the real secret lives only in hosted function secrets and is never committed).
- **Seed fixtures (live backend):** org `…a1` (RWP, slug `race-pace`) · other org `…a2` (APO) · event `…e1` · category `…c4` (`10k`, `base_price` 100000, `slots_total` 200) · addon `…d1`.
- **Apply the migration before backend tests:** `supabase db reset` (wipes local data, reapplies migrations + seed) with the stack running.
- **Test commands:** full backend (root, live stack + functions serve) `pnpm test`; single backend file `pnpm exec vitest run supabase/tests/<file>`; web `pnpm --filter web test`; typecheck `pnpm -r typecheck`.
- **Commit after every task.** End commit messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Transactional money-transition RPCs

**Files:**
- Create: `supabase/migrations/20260723100000_money_txn_rpcs.sql`
- Create: `supabase/tests/money-txn.test.ts`

**Interfaces:**
- Consumes: `registrations`/`payments`/`categories` tables; `registration_status` enum.
- Produces: `confirm_payment_tx(p_registration_id uuid, p_method text, p_fee int, p_net int, p_token text, p_raw jsonb) returns text` (`'paid'`|`'already'`|`'not_pending'`|`'not_found'` — `not_pending` guards a refunded/cancelled reg from being re-confirmed by a replayed webhook); `refund_registration_tx(p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb) returns text` (`'refunded'`|`'already'`|`'not_paid'`|`'not_found'`). Both `service_role`-only.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/money-txn.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function makeUserId(email: string) {
  const c = await svc().auth.admin.createUser({ email, password: "password123", email_confirm: true });
  return c.data.user!.id;
}

// Fresh org/event/category/pending-registration+payment, isolated from seed data.
async function fixture(tag: string) {
  const s = svc();
  const uid = await makeUserId(`txn_${tag}_${Date.now()}@test.dev`);
  const org = (await s.from("organizations").insert({ name: "Txn Org", slug: `txn-${tag}-${Date.now()}` }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "Txn Race", status: "open" }).select().single()).data!;
  const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
  const reg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid, total_amount: 100000, status: "pending" }).select().single()).data!;
  await s.from("payments").insert({ org_id: org.id, registration_id: reg.id, amount: 100000, status: "pending", provider: "fake" });
  return { s, uid, org, ev, cat, reg };
}
async function cleanup(s: ReturnType<typeof svc>, orgId: string, regId: string, uid: string) {
  await s.from("payments").delete().eq("registration_id", regId);
  await s.from("registrations").delete().eq("id", regId);
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

describe("confirm_payment_tx", () => {
  it("atomically sets paid + ticket + fee/net + slot, and is idempotent", async () => {
    const { s, uid, org, cat, reg } = await fixture("confirm");
    const r1 = await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: { source: "test" } });
    expect(r1.data).toBe("paid");

    const regRow = (await s.from("registrations").select("status,ticket_token").eq("id", reg.id).single()).data!;
    const payRow = (await s.from("payments").select("status,method,platform_fee,net_to_org").eq("registration_id", reg.id).single()).data!;
    const catRow = (await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!;
    expect(regRow.status).toBe("paid");
    expect(regRow.ticket_token).toBe("tok.sig");
    expect(payRow).toMatchObject({ status: "paid", method: "gcash", platform_fee: 10000, net_to_org: 90000 });
    expect(catRow.slots_taken).toBe(1);

    // idempotent: second call is a no-op, slot NOT incremented again
    const r2 = await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
    expect(r2.data).toBe("already");
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);

    await cleanup(s, org.id, reg.id, uid);
  });

  it("returns not_found for an unknown registration and writes nothing", async () => {
    const s = svc();
    const r = await s.rpc("confirm_payment_tx", { p_registration_id: "00000000-0000-0000-0000-0000000000ff", p_method: "x", p_fee: 0, p_net: 0, p_token: "t", p_raw: {} });
    expect(r.data).toBe("not_found");
  });
});

describe("refund_registration_tx", () => {
  it("atomically refunds a paid reg, releases the slot, records provider_refund, idempotent", async () => {
    const { s, uid, org, cat, reg } = await fixture("refund");
    await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);

    const r1 = await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: "test note", p_provider_refund: { id: "ref_x", status: "succeeded" } });
    expect(r1.data).toBe("refunded");
    expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("refunded");
    const payRow = (await s.from("payments").select("status,raw").eq("registration_id", reg.id).single()).data!;
    expect(payRow.status).toBe("refunded");
    expect((payRow.raw as any).refunded_by).toBe(uid);
    expect((payRow.raw as any).provider_refund.id).toBe("ref_x");
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);

    // idempotent: second call -> already, slot NOT decremented below baseline
    const r2 = await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} });
    expect(r2.data).toBe("already");
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);

    await cleanup(s, org.id, reg.id, uid);
  });

  it("refuses a non-paid registration with not_paid and writes nothing", async () => {
    const { s, uid, org, cat, reg } = await fixture("guard");
    // reg is still pending (never confirmed)
    const r = await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} });
    expect(r.data).toBe("not_paid");
    expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("pending");
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
    await cleanup(s, org.id, reg.id, uid);
  });

  it("releases the slot exactly once under concurrent refunds", async () => {
    const { s, uid, org, cat, reg } = await fixture("race");
    await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
    const results = await Promise.all([
      s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} }),
      s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} }),
    ]);
    const outcomes = results.map((r) => r.data).sort();
    expect(outcomes).toEqual(["already", "refunded"]); // exactly one winner
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0); // released once
    await cleanup(s, org.id, reg.id, uid);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/money-txn.test.ts`
Expected: FAIL — `confirm_payment_tx`/`refund_registration_tx` do not exist (`Could not find the function public.confirm_payment_tx…`).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260723100000_money_txn_rpcs.sql`:

```sql
-- Atomic money-state transitions for confirm + refund. Each function body runs in a
-- single transaction (all writes commit or roll back together), replacing the prior
-- sequential, non-transactional Edge-Function writes. security definer + search_path=''
-- + fully schema-qualified + service_role-only. Row-locked for idempotency/race-safety.

create or replace function public.confirm_payment_tx(
  p_registration_id uuid, p_method text, p_fee int, p_net int, p_token text, p_raw jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.registration_status;
  v_category uuid;
begin
  select status, category_id into v_status, v_category
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;
  if v_status <> 'pending' then return 'not_pending'; end if;  -- refunded/cancelled: never re-confirm (replay-safe)

  update public.payments
     set status = 'paid', method = p_method, platform_fee = p_fee,
         net_to_org = p_net, raw = p_raw
   where registration_id = p_registration_id;

  update public.registrations
     set status = 'paid', ticket_token = p_token
   where id = p_registration_id;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  return 'paid';
end;
$$;

revoke all on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) from public;
grant execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) to service_role;

create or replace function public.refund_registration_tx(
  p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.registration_status;
  v_category uuid;
  v_raw jsonb;
begin
  select status, category_id into v_status, v_category
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;

  select raw into v_raw from public.payments where registration_id = p_registration_id;
  update public.payments
     set status = 'refunded',
         raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(),
                 'refunded_by', p_refunded_by,
                 'note', p_note,
                 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;

  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category;

  return 'refunded';
end;
$$;

revoke all on function public.refund_registration_tx(uuid, uuid, text, jsonb) from public;
grant execute on function public.refund_registration_tx(uuid, uuid, text, jsonb) to service_role;
```

- [ ] **Step 4: Apply the migration to the local stack**

Run: `supabase db reset`
Expected: migrations reapply (incl. `20260723100000_money_txn_rpcs`) + seed; no errors.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run supabase/tests/money-txn.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260723100000_money_txn_rpcs.sql supabase/tests/money-txn.test.ts
git commit -m "feat(db): atomic confirm_payment_tx + refund_registration_tx RPCs" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Route `confirmPayment` through `confirm_payment_tx`

**Files:**
- Modify: `supabase/functions/_shared/confirm.ts`
- Test: `supabase/tests/backend.test.ts` (extend the existing "payment confirmation (fake) e2e" case)

**Interfaces:**
- Consumes: `confirm_payment_tx` (Task 1); `mintTicketToken` (`_shared/ticket.ts`); `serviceClient` (`_shared/supabase.ts`).
- Produces: unchanged `confirmPayment(registrationId, method, raw) → { ok, registration_id, already? } | { ok:false, error, status }`. Now delegates the 3 writes to one RPC (atomic).

- [ ] **Step 1: Add a failing idempotency assertion to the e2e test**

In `supabase/tests/backend.test.ts`, inside the existing `describe("payment confirmation (fake) e2e", …)` test, **after** the block that asserts `after.data!.slots_taken` equals `before + 1` (currently around line 221) and **before** the cleanup, insert:

```ts
    // A duplicate confirmation is a no-op — slot stays at +1 (idempotent through confirm_payment_tx).
    await fetch(`${FN}/payments-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ registration_id: checkout.registration_id, method: "gcash" }),
    });
    const afterDup = await svc.from("categories").select("slots_taken").eq("id", "00000000-0000-0000-0000-0000000000c4").single();
    expect(afterDup.data!.slots_taken).toBe(before.data!.slots_taken + 1);
```

(At this task the `payments-webhook` still accepts the plain `{registration_id, method}` body — it is rewritten in Task 4.)

- [ ] **Step 2: Run it against the current implementation**

Run: `pnpm exec vitest run supabase/tests/backend.test.ts -t "checkout -> webhook -> paid"`
Expected: PASS already (the current sequential `confirmPayment` is idempotent). This assertion pins the behavior the refactor must preserve.

- [ ] **Step 3: Refactor `confirm.ts` to call the RPC**

Replace the write block in `supabase/functions/_shared/confirm.ts` (the three `await db.from(...).update(...)` / `db.rpc("increment_slot", …)` lines) so the full file reads:

```ts
import { serviceClient } from "./supabase.ts";
import { mintTicketToken } from "./ticket.ts";

export type ConfirmResult =
  | { ok: true; registration_id: string; already?: boolean }
  | { ok: false; error: string; status: number };

/** Mark a registration paid, mint its signed ticket, and increment the slot — in one
 *  atomic RPC. Idempotent: a second call on an already-paid registration is a no-op. */
export async function confirmPayment(
  registrationId: string,
  method: string,
  raw: unknown = {},
): Promise<ConfirmResult> {
  const db = serviceClient();
  const { data: reg } = await db
    .from("registrations")
    .select("id,event_id,category_id,total_amount,status,organizations(commission_rate)")
    .eq("id", registrationId)
    .single();
  if (!reg) return { ok: false, error: "not_found", status: 404 };
  if (reg.status === "paid") return { ok: true, registration_id: reg.id, already: true };
  if (reg.status !== "pending") return { ok: true, registration_id: reg.id, already: true }; // refunded/cancelled: no-op (replay-safe)

  const rate = (reg.organizations as { commission_rate: number } | null)?.commission_rate ?? 0.10;
  const fee = Math.round(reg.total_amount * rate);
  const net = reg.total_amount - fee;

  const secret = Deno.env.get("TICKET_SIGNING_SECRET") ?? "dev-secret";
  const token = await mintTicketToken(
    { rid: reg.id, eid: reg.event_id, iat: Math.floor(Date.now() / 1000) },
    secret,
  );

  const { data: result, error } = await db.rpc("confirm_payment_tx", {
    p_registration_id: reg.id,
    p_method: method,
    p_fee: fee,
    p_net: net,
    p_token: token,
    p_raw: (raw ?? {}) as Record<string, unknown>,
  });
  if (error) return { ok: false, error: "confirm_write_failed", status: 500 };
  return { ok: true, registration_id: reg.id, already: result === "already" || result === "not_pending" };
}
```

- [ ] **Step 4: Serve the updated function and run the paid-path tests**

Ensure `supabase functions serve` is running (restart to pick up the edit), then run:
`pnpm exec vitest run supabase/tests/backend.test.ts -t "checkout -> webhook -> paid"`
and `pnpm exec vitest run supabase/tests/backend.test.ts -t "fake-checkout sandbox"`
Expected: PASS — paid + ticket + fee/net + slot correct, duplicate confirmation stays +1.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/confirm.ts supabase/tests/backend.test.ts
git commit -m "refactor(payments): confirmPayment delegates to atomic confirm_payment_tx" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: PayMongo refund in the provider layer + atomic refund path

**Files:**
- Modify: `supabase/functions/_shared/paymongo.ts` (add `pmPaymentIdFromSession`, `pmCreateRefund`)
- Modify: `supabase/functions/_shared/payments.ts` (add `refund()` to the interface + both providers; add `getPaymentProviderByName`)
- Modify: `supabase/functions/_shared/refund.ts` (provider-first ordering, pending handling, RPC finalize)
- Modify: `supabase/functions/admin-refund/index.ts` (surface `pending` in the response)
- Test: `supabase/tests/backend.test.ts` (extend the existing "admin-refund" case)

**Interfaces:**
- Consumes: `refund_registration_tx` (Task 1); `pmGetCheckoutSession` (existing).
- Produces: `PaymentProvider.refund(input: RefundInput) → Promise<RefundResult>` where `RefundInput = { providerRef, amount, reason? }` and `RefundResult = { providerRefundId, status: "pending"|"succeeded"|"failed", raw }`; `getPaymentProviderByName(name: string): PaymentProvider`; `refundRegistration(id, refundedBy, note) → { ok:true, registration_id, already?, pending? } | { ok:false, error, status }`.

- [ ] **Step 1: Extend the admin-refund test (failing on the new assertion)**

In `supabase/tests/backend.test.ts`, inside the existing `describe("admin-refund", …)` first test, **after** the line asserting `raw.refunded_by === admin.id` (around line 315), add:

```ts
    // A1: the provider refund result is recorded under payments.raw.provider_refund
    expect((paidPay.data?.raw as Record<string, unknown>)?.provider_refund).toBeTruthy();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run supabase/tests/backend.test.ts -t "org admin refunds a paid registration"`
Expected: FAIL — `provider_refund` is absent (the current `refund.ts` writes only `refunded_at/by/note`).

- [ ] **Step 3: Add PayMongo refund primitives to `paymongo.ts`**

Append to `supabase/functions/_shared/paymongo.ts`:

```ts
/** Resolve the pay_… id captured by a paid checkout session (session.payments[].id). */
export function pmPaymentIdFromSession(session: PmSession): string | null {
  // deno-lint-ignore no-explicit-any
  const a = (session.raw as any)?.data?.attributes ?? {};
  // deno-lint-ignore no-explicit-any
  const payments: any[] = Array.isArray(a.payments) ? a.payments : [];
  const chosen = payments.find((p) => p?.attributes?.status === "paid") ?? payments[0];
  return chosen?.id ?? null;
}

export interface PmRefund { id: string; status: "pending" | "succeeded" | "failed"; raw: unknown }

/** POST /refunds — amount in centavos. PayMongo returns status pending|succeeded|failed. */
export async function pmCreateRefund(input: { paymentId: string; amount: number; reason?: string }): Promise<PmRefund> {
  const res = await fetch(`${BASE}/refunds`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader() },
    body: JSON.stringify({
      data: { attributes: { amount: input.amount, payment_id: input.paymentId, reason: input.reason ?? "requested_by_customer" } },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`paymongo_refund_failed: ${JSON.stringify(body?.errors ?? body)}`);
  const d = body?.data;
  return { id: d?.id, status: (d?.attributes?.status ?? "pending") as PmRefund["status"], raw: body };
}
```

- [ ] **Step 4: Add `refund()` to the provider abstraction in `payments.ts`**

Edit `supabase/functions/_shared/payments.ts`. Update the import line and interface, add `refund` to both providers, and add `getPaymentProviderByName`:

```ts
import { paymongoConfigured, pmCreateCheckoutSession, pmGetCheckoutSession, pmPaymentIdFromSession, pmCreateRefund } from "./paymongo.ts";

export interface CheckoutInput { registrationId: string; amount: number; description: string; returnUrl: string }
export interface CheckoutResult { checkoutUrl: string; providerRef: string }
export interface RefundInput { providerRef: string; amount: number; reason?: string }
export interface RefundResult { providerRefundId: string; status: "pending" | "succeeded" | "failed"; raw: unknown }
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}
```

In `FakePaymentProvider`, add:

```ts
  async refund(input: RefundInput): Promise<RefundResult> {
    // No real provider — the DB transition is the whole story for fake/seed/local rows.
    return { providerRefundId: `fake_refund_${input.providerRef}`, status: "succeeded", raw: { fake: true } };
  }
```

In `PayMongoProvider`, add:

```ts
  async refund(input: RefundInput): Promise<RefundResult> {
    // provider_ref is the checkout session id; resolve the pay_… id, then refund it.
    const session = await pmGetCheckoutSession(input.providerRef);
    const paymentId = pmPaymentIdFromSession(session);
    if (!paymentId) throw new Error("paymongo_refund_no_payment");
    const r = await pmCreateRefund({ paymentId, amount: input.amount, reason: input.reason });
    return { providerRefundId: r.id, status: r.status, raw: r.raw };
  }
```

At the bottom, alongside `getPaymentProvider`, add:

```ts
/** Pick the provider that TOOK a payment (payments.provider) — a refund must go back
 *  through the same rails, independent of the current env's checkout provider. */
export function getPaymentProviderByName(name: string): PaymentProvider {
  if (name === "paymongo") return new PayMongoProvider();
  const base = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? "http://127.0.0.1:54521/functions/v1";
  return new FakePaymentProvider(base);
}
```

- [ ] **Step 5: Rewrite `refund.ts` — provider first, then the atomic RPC**

Replace `supabase/functions/_shared/refund.ts` in full:

```ts
import { serviceClient } from "./supabase.ts";
import { getPaymentProviderByName } from "./payments.ts";

export type RefundResult =
  | { ok: true; registration_id: string; already?: boolean; pending?: boolean }
  | { ok: false; error: string; status: number };

const REFUND_REASON = "requested_by_customer";

/** Refund a paid registration. Calls the payment provider FIRST (network) so a provider
 *  failure returns before any DB write; a 'succeeded' refund is finalized atomically via
 *  refund_registration_tx; a 'pending' refund is parked in payments.raw.refund and the
 *  slot is held until the refund.updated webhook settles it. Idempotent + race-safe. */
export async function refundRegistration(
  registrationId: string,
  refundedBy: string,
  note: string | null = null,
): Promise<RefundResult> {
  const db = serviceClient();
  const { data: reg, error: regErr } = await db
    .from("registrations").select("id,category_id,status").eq("id", registrationId).single();
  if (regErr || !reg) return { ok: false, error: "not_found", status: 404 };
  if (reg.status === "refunded") return { ok: true, registration_id: reg.id, already: true };
  if (reg.status !== "paid") return { ok: false, error: "not_refundable", status: 409 };

  const { data: pay } = await db
    .from("payments").select("provider,provider_ref,amount,raw").eq("registration_id", reg.id).single();
  if (!pay) return { ok: false, error: "payment_not_found", status: 404 };

  // 1) Provider refund — network, BEFORE any DB mutation.
  const provider = getPaymentProviderByName(pay.provider);
  let refund;
  try {
    refund = await provider.refund({ providerRef: pay.provider_ref ?? "", amount: pay.amount, reason: REFUND_REASON });
  } catch (_e) {
    return { ok: false, error: "provider_refund_failed", status: 502 };
  }
  if (refund.status === "failed") return { ok: false, error: "provider_refund_declined", status: 502 };

  // 2) Pending — park it; the webhook finalizes. Do NOT flip status or release the slot.
  if (refund.status === "pending") {
    const raw = { ...((pay.raw as Record<string, unknown>) ?? {}), refund: { status: "pending", id: refund.providerRefundId, requested_at: new Date().toISOString(), refunded_by: refundedBy, note } };
    const { error: upErr } = await db.from("payments").update({ raw }).eq("registration_id", reg.id);
    if (upErr) return { ok: false, error: "refund_pending_write_failed", status: 500 };
    return { ok: true, registration_id: reg.id, pending: true };
  }

  // 3) Succeeded — finalize atomically.
  const { data: result, error: rpcErr } = await db.rpc("refund_registration_tx", {
    p_registration_id: reg.id, p_refunded_by: refundedBy, p_note: note, p_provider_refund: refund.raw as Record<string, unknown>,
  });
  if (rpcErr) return { ok: false, error: "refund_write_failed", status: 500 };
  if (result === "already") return { ok: true, registration_id: reg.id, already: true };
  if (result === "not_paid") return { ok: false, error: "not_refundable", status: 409 };
  if (result === "not_found") return { ok: false, error: "not_found", status: 404 };
  return { ok: true, registration_id: reg.id };
}
```

- [ ] **Step 6: Surface `pending` in the admin-refund response**

In `supabase/functions/admin-refund/index.ts`, change the success return to:

```ts
    return json({ ok: true, registration_id: r.registration_id, already: r.already, pending: r.pending });
```

- [ ] **Step 7: Serve + run the admin-refund tests**

Restart `supabase functions serve`, then run:
`pnpm exec vitest run supabase/tests/backend.test.ts -t "admin-refund"`
Expected: PASS — org admin refund → refunded + slot released + `raw.provider_refund` present; runner/other-org → 403; pending reg → 409; second refund idempotent (no double decrement). (The fake provider returns `succeeded`, so the RPC-finalize path is exercised.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/paymongo.ts supabase/functions/_shared/payments.ts supabase/functions/_shared/refund.ts supabase/functions/admin-refund/index.ts supabase/tests/backend.test.ts
git commit -m "feat(payments): real PayMongo refund via provider abstraction + atomic refund_registration_tx" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Signature-verified webhook (paid + refund reconciliation)

**Files:**
- Create: `supabase/functions/_shared/paymongo-webhook.ts` (`verifyWebhookSignature`)
- Modify: `supabase/functions/payments-webhook/index.ts` (replace the dev stub)
- Modify: `supabase/functions/.env.example` (document `PAYMONGO_WEBHOOK_SECRET`) — the real value lives in the **gitignored** `.env`, already configured by the test harness; never commit `.env`
- Test: `supabase/tests/backend.test.ts` (migrate the `paidRegistration` helper + the e2e case; add signed-webhook cases)

**Interfaces:**
- Consumes: `confirmPayment` (Task 2); `refund_registration_tx` (Task 1); `serviceClient`.
- Produces: `verifyWebhookSignature(rawBody: string, header: string | null, secret: string, maxAgeSec?: number): Promise<boolean>`; the webhook now returns `401` on bad signature, routes `checkout_session.payment.paid` → confirm and `refund.updated` → reconcile, `200`-ignores unknown types.

- [ ] **Step 1: Document the webhook secret (committed) — the real value is already set locally**

The gitignored `supabase/functions/.env` already has `PAYMONGO_WEBHOOK_SECRET=whsec_test_localdev` set and `PAYMONGO_SECRET_KEY` commented out (fake provider); the running `supabase functions serve` from this worktree already has it and recompiles per request — **do not edit `.env`, restart the serve, or run `supabase db reset`** (the harness manages them). Only document the new var in the committed example — append to `supabase/functions/.env.example`:

```
# Webhook signing secret from the PayMongo webhook resource (hosted); a test-only value locally.
PAYMONGO_WEBHOOK_SECRET=whsec_your_paymongo_webhook_secret
```

- [ ] **Step 2: Write the signed-webhook tests (failing) + migrate the helper**

In `supabase/tests/backend.test.ts`:

(a) Add near the top imports:

```ts
import { createHmac } from "node:crypto";
const WEBHOOK_SECRET = "whsec_test_localdev"; // must match supabase/functions/.env
function signHeader(rawBody: string): string {
  const t = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},te=${sig}`;
}
function postWebhook(payload: unknown, header?: string) {
  const raw = JSON.stringify(payload);
  return fetch(`${FN}/payments-webhook`, { method: "POST", headers: { "content-type": "application/json", "Paymongo-Signature": header ?? signHeader(raw) }, body: raw });
}
const paidEvent = (registrationId: string) => ({ data: { attributes: { type: "checkout_session.payment.paid", data: { attributes: { metadata: { registration_id: registrationId }, payments: [{ attributes: { source: { type: "gcash" } } }] } } } } });
const refundEvent = (refundId: string, status: string) => ({ data: { attributes: { type: "refund.updated", data: { id: refundId, attributes: { status } } } } });
```

(b) Replace the `paidRegistration` helper (around line 278) — confirm via the fake sandbox page (the webhook no longer takes a plain body):

```ts
async function paidRegistration(runnerToken: string) {
  const checkout = await fetch(`${FN}/registrations-checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${runnerToken}` },
    body: JSON.stringify({ event_id: E1_RF, category_id: C4_RF, custom_data: { blood_type: "A", shirt_size: "L" }, waiver_accepted: true, idempotency_key: `idem-rf-${Date.now()}` }),
  }).then((r) => r.json());
  await fetch(`${FN}/fake-checkout?rid=${checkout.registration_id}&return=${encodeURIComponent("racepace://cb")}&action=pay`);
  return checkout.registration_id as string;
}
```

(c) Replace the body of the `describe("payment confirmation (fake) e2e", …)` test's confirmation step: swap the plain-body `payments-webhook` POST for `await postWebhook(paidEvent(checkout.registration_id))` and assert `.status === 200`. Keep the paid/ticket/fee/net/slot assertions (and the duplicate-confirmation assertion from Task 2, also via `postWebhook(paidEvent(...))`).

(d) Add a new suite:

```ts
describe("payments-webhook (signed)", () => {
  it("rejects a bad signature with 401", async () => {
    const res = await postWebhook(paidEvent("00000000-0000-0000-0000-0000000000ff"), "t=123,te=deadbeef");
    expect(res.status).toBe(401);
  });

  it("ignores an unknown event type with 200", async () => {
    const res = await postWebhook({ data: { attributes: { type: "payment.failed", data: {} } } });
    expect(res.status).toBe(200);
  });

  it("reconciles refund.updated=succeeded on a pending refund -> refunded + slot released", async () => {
    const svc = service();
    const runner = await makeUser(`wh_rf_${Date.now()}@test.dev`);
    const rid = await paidRegistration(runner.token);
    const before = (await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken;

    // simulate a parked (pending) refund like refund.ts writes
    const refId = `ref_test_${Date.now()}`;
    const pay = (await svc.from("payments").select("raw").eq("registration_id", rid).single()).data!;
    await svc.from("payments").update({ raw: { ...(pay.raw ?? {}), refund: { status: "pending", id: refId, refunded_by: runner.id, note: null } } }).eq("registration_id", rid);

    const res = await postWebhook(refundEvent(refId, "succeeded"));
    expect(res.status).toBe(200);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data!.status).toBe("refunded");
    expect((await svc.from("payments").select("status").eq("registration_id", rid).single()).data!.status).toBe("refunded");
    expect((await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken).toBe(before - 1);

    await svc.from("registrations").delete().eq("id", rid);
    await svc.auth.admin.deleteUser(runner.id);
  });

  it("marks refund.updated=failed as failed and leaves the registration paid", async () => {
    const svc = service();
    const runner = await makeUser(`wh_rff_${Date.now()}@test.dev`);
    const rid = await paidRegistration(runner.token);
    const refId = `ref_fail_${Date.now()}`;
    const pay = (await svc.from("payments").select("raw").eq("registration_id", rid).single()).data!;
    await svc.from("payments").update({ raw: { ...(pay.raw ?? {}), refund: { status: "pending", id: refId, refunded_by: runner.id, note: null } } }).eq("registration_id", rid);

    const res = await postWebhook(refundEvent(refId, "failed"));
    expect(res.status).toBe(200);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data!.status).toBe("paid");
    const after = (await svc.from("payments").select("raw").eq("registration_id", rid).single()).data!;
    expect((after.raw as any).refund.status).toBe("failed");

    await svc.from("registrations").delete().eq("id", rid);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run supabase/tests/backend.test.ts -t "payments-webhook (signed)"`
Expected: FAIL — the current stub ignores the signature (no 401) and doesn't handle `refund.updated`.

- [ ] **Step 4: Write the signature verifier**

Create `supabase/functions/_shared/paymongo-webhook.ts`:

```ts
// Verify a PayMongo webhook signature. Header form: "t=<unix>,te=<testSig>,li=<liveSig>".
// Signed payload is `${t}.${rawBody}`; HMAC-SHA256(secret) hex, compared constant-time.
async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
export async function verifyWebhookSignature(
  rawBody: string, header: string | null, secret: string, maxAgeSec = 300,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) { const [k, v] = kv.split("="); if (k && v) parts[k.trim()] = v.trim(); }
  const t = parts["t"]; const provided = parts["te"] ?? parts["li"];
  if (!t || !provided) return false;
  const age = Math.floor(Date.now() / 1000) - Number(t);
  if (!Number.isFinite(age) || Math.abs(age) > maxAgeSec) return false; // bound replay
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, provided);
}
```

- [ ] **Step 5: Replace the webhook handler**

Replace `supabase/functions/payments-webhook/index.ts` in full:

```ts
import { confirmPayment } from "../_shared/confirm.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { verifyWebhookSignature } from "../_shared/paymongo-webhook.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// PayMongo webhook. Verifies the signature, then routes:
//   checkout_session.payment.paid -> confirmPayment (authoritative; idempotent)
//   refund.updated (succeeded/failed) -> reconcile the async refund parked in payments.raw
Deno.serve(async (req) => {
  try {
    const raw = await req.text();
    const secret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET") ?? "";
    if (!(await verifyWebhookSignature(raw, req.headers.get("Paymongo-Signature"), secret))) {
      return json({ error: "invalid_signature" }, 401);
    }

    const evt = JSON.parse(raw);
    const type = evt?.data?.attributes?.type as string | undefined;
    const resource = evt?.data?.attributes?.data;
    const db = serviceClient();

    if (type === "checkout_session.payment.paid" || type === "payment.paid") {
      const rid = resource?.attributes?.metadata?.registration_id as string | undefined;
      if (!rid) return json({ ok: true, ignored: "no_registration_id" });
      const method = resource?.attributes?.payments?.[0]?.attributes?.source?.type ?? "paymongo";
      const r = await confirmPayment(rid, method, { source: "webhook", event: evt });
      if (!r.ok) return json({ error: r.error }, r.status); // surface failures so PayMongo retries (don't 200 a stuck payment)
      return json({ ok: true, registration_id: r.registration_id });
    }

    if (type === "refund.updated") {
      const refundId = resource?.id as string | undefined;
      const status = resource?.attributes?.status as string | undefined;
      if (!refundId) return json({ ok: true, ignored: "no_refund_id" });
      const { data: pay } = await db.from("payments").select("registration_id,raw").filter("raw->refund->>id", "eq", refundId).maybeSingle();
      if (!pay) return json({ ok: true, ignored: "unknown_refund" });
      // deno-lint-ignore no-explicit-any
      const parked = (pay.raw as any)?.refund ?? {};
      if (status === "succeeded") {
        const { error: rpcErr } = await db.rpc("refund_registration_tx", { p_registration_id: pay.registration_id, p_refunded_by: parked.refunded_by ?? null, p_note: parked.note ?? null, p_provider_refund: resource });
        if (rpcErr) return json({ error: "refund_reconcile_failed" }, 500); // surface so PayMongo retries
      } else if (status === "failed") {
        const raw2 = { ...((pay.raw as Record<string, unknown>) ?? {}), refund: { ...parked, status: "failed" } };
        const { error: upErr } = await db.from("payments").update({ raw: raw2 }).eq("registration_id", pay.registration_id);
        if (upErr) return json({ error: "refund_flag_failed" }, 500);
      }
      return json({ ok: true });
    }

    return json({ ok: true, ignored: type ?? "unknown" });
  } catch (_e) {
    return json({ error: "server_error" }, 500);
  }
});
```

- [ ] **Step 6: Serve + run the webhook and paid-path tests**

Restart `supabase functions serve`, then run:
`pnpm exec vitest run supabase/tests/backend.test.ts -t "payments-webhook (signed)"`
and `pnpm exec vitest run supabase/tests/backend.test.ts -t "checkout -> webhook -> paid"`
and `pnpm exec vitest run supabase/tests/backend.test.ts -t "admin-refund"`
Expected: PASS — 401 on bad signature; unknown type ignored; `refund.updated` succeeded → refunded + slot released; failed → parked flag flipped; the migrated e2e + admin-refund suites still green.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/paymongo-webhook.ts supabase/functions/payments-webhook/index.ts supabase/functions/.env.example supabase/tests/backend.test.ts
git commit -m "feat(payments): signature-verified PayMongo webhook (paid + refund.updated reconciliation)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification, manual PayMongo check, roadmap

**Files:**
- Modify: `docs/README.md`

- [ ] **Step 1: Full backend suite (live stack + functions serve)**

Ensure `supabase start` + `supabase db reset` + `supabase functions serve` are running, then:
`pnpm test`
Expected: all green, including `money-txn` (4), the migrated `backend` e2e/admin-refund cases, and `payments-webhook (signed)` (4) — **no new reds** vs. the pre-existing baseline.

- [ ] **Step 2: Web suite + typecheck (regression — should be untouched)**

Run: `pnpm --filter web test`
Expected: PASS (A1 is backend-only; 51 tests green).
Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 3: Manual PayMongo test-mode verification (documented, operator-run)**

The automated suite exercises the fake provider + signed webhook locally. Real PayMongo refund + real webhook delivery are verified once against the hosted deployment (test mode). Record these steps in the PR description:
1. In the PayMongo dashboard (test mode), create a **webhook** pointing at the hosted `payments-webhook` function URL, subscribed to `checkout_session.payment.paid` and `refund.updated`; copy its signing secret.
2. Set hosted function secrets: `supabase secrets set PAYMONGO_WEBHOOK_SECRET=<from dashboard>` (keep the existing `PAYMONGO_SECRET_KEY`).
3. Complete a test-card checkout (`4343 4343 4343 4345`) → confirm the `payment.paid` webhook flips the registration to paid.
4. Issue an admin refund on that registration → confirm a PayMongo refund is created and the `refund.updated` webhook drives it to `refunded` with the slot released.

- [ ] **Step 4: Tick the Payments track in the roadmap**

In `docs/README.md`, under the "Admin web console (M3)" list, after the Plan 13 line, add:

```markdown
- [x] **Payments · A1 — Real money engine** — [spec](./specs/2026-07-23-payments-real-money-engine-design.md) · [plan](./plans/17-payments-real-money-engine.md) — real PayMongo refunds via the `PaymentProvider.refund()` abstraction (chosen by `payments.provider`), a signature-verified `payments-webhook` owning `checkout_session.payment.paid` + `refund.updated`, and atomic `confirm_payment_tx` / `refund_registration_tx` RPCs replacing the sequential money writes. First slice of the Payments track (A1 → A2 refund approval queue → A3 commission rollup).
```

- [ ] **Step 5: Commit**

```bash
git add docs/README.md
git commit -m "docs: mark Payments A1 (real money engine) complete in the roadmap" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §3 Component 1 (PayMongo refund in provider layer: `pmCreateRefund`, `pmPaymentIdFromSession`, `refund()` on both providers, `getPaymentProviderByName`, provider-by-row) → Task 3. ✓
- §4 Component 2 (signed webhook: HMAC verify, `payment.paid` → confirm, `refund.updated` succeeded/failed reconcile, unknown → 200) → Task 4. ✓
- §5 Component 3 (transactional RPCs + confirm/refund refactor, provider-call-outside-txn ordering) → Tasks 1, 2, 3. ✓
- §2.2 pending refunds wait for the webhook (no slot release; parked in `payments.raw.refund`) → Task 3 (park) + Task 4 (settle). ✓
- §6 data flow (paid via verify and/or webhook, both idempotent; refund succeeded now / pending later) → Tasks 2, 3, 4. ✓
- §7 edge cases (bad sig 401; provider fail 502 pre-DB; pending held; idempotent double-webhook; fake/legacy refund; duplicate delivery) → Tasks 3–4 tests. ✓
- §8 testing (RPC atomicity/idempotency/race; provider ordering via fake; webhook sig + routing; regression) → Tasks 1, 3, 4, 5. ✓
- §9 secrets & one-time setup (`PAYMONGO_WEBHOOK_SECRET`, webhook registration) → Task 4 Step 1 (local) + Task 5 Step 3 (hosted). ✓
- §10 out of scope (partial refunds, approval queue, commission rollup, payouts) → not implemented; A2/A3/later. ✓
- Global constraints (backend-only; additive; provider-by-row; ordering; local `PAYMONGO_SECRET_KEY` unset) → honored across tasks. ✓

**Placeholder scan:** none — every code/SQL/test/command block is concrete. The provider-error-before-DB ordering is proven by Task 3's fake path + the guard/idempotency tests; genuine mid-transaction rollback is guaranteed by plpgsql single-transaction semantics (a raised exception rolls back all prior writes in the call) and is not force-triggered via contortion.

**Type consistency:** `RefundInput`/`RefundResult` (Task 3) are consumed identically by both providers and `refund.ts`. `refundRegistration(id, refundedBy, note)` return type gains `pending?` (Task 3), surfaced by `admin-refund` (Task 3 Step 6). `confirm_payment_tx`/`refund_registration_tx` parameter names + return strings (`'paid'|'already'|'not_found'` / `'refunded'|'already'|'not_paid'|'not_found'`) defined in Task 1 match every `db.rpc(...)` call in Tasks 2, 3, 4. `verifyWebhookSignature(rawBody, header, secret, maxAgeSec?)` (Task 4) matches its single call site in the webhook. The webhook's `payments.raw.refund.id` lookup (Task 4) matches the shape `refund.ts` writes for a pending refund (Task 3). Seed ids (`…a1/a2/e1/c4/d1`) consistent with `backend.test.ts`.
```
