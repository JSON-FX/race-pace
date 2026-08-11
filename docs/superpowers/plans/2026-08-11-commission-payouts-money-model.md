# Three-Party Commission Money Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PayMongo an explicit third party in the payments ledger so Race Pace earns a clean 3% commission, organizers can be set to absorb or pass on processing costs, and every peso is traceable from what the runner paid to what the organizer receives.

**Architecture:** `payments` gains a processor-fee column written from PayMongo's own reported `fee` at confirmation, so the ledger records what was actually charged rather than what we predicted. A versioned `processor_rates` table predicts fees for two purposes only — computing the pass-on surcharge and showing humans estimates — and never touches the ledger. A drift view compares predicted against actual so rate changes are detected from real transactions.

**Tech Stack:** Postgres (Supabase migrations), Deno Edge Functions, Next.js 15 App Router (`apps/web` admin, `apps/site` runner), Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-11-commission-payouts-money-model-design.md`](../specs/2026-08-11-commission-payouts-money-model-design.md)

## Global Constraints

- **All money is integer centavos.** No floats anywhere in fee arithmetic. `₱2,000.00` is `200000`.
- **All processor rates are stored and displayed VAT-INCLUSIVE.** The commonly-quoted PayMongo figures are ex-VAT; × 1.12 gives the stored value. `percent_bps` is basis points: `350` = 3.50%.
- **Migrations are timestamp-named** `supabase/migrations/YYYYMMDDHHMMSS_name.sql` and must sort after `20260809150000_admin_registrations_v_registration_status.sql`. Use the `20260811*` prefixes given in each task verbatim so ordering is deterministic.
- **Every new function needs explicit grants.** `revoke all ... from public` does NOT lock a function — anon keeps EXECUTE via default privileges. Follow `20260808120000_fix_function_grants_default_privileges.sql`. This was a proven payment bypass.
- **Every RLS predicate wraps `auth.uid()` in `(select …)`** and uses sargable `org_id in (…)`. Unwrapped, it evaluates per row: 4.9ms → 1220ms → statement timeouts.
- **Historical `net_to_org` is never rewritten.** Rows with `processor_fee_source = 'historical'` deliberately violate the ledger invariant; that violation is the record that Race Pace absorbed the fee.
- **Run DB tests with:** `pnpm test` from the repo root (vitest, includes `supabase/**/*.test.ts`). Requires a running local Supabase: `pnpm exec supabase start`.
- **Tests requiring Edge Functions** additionally need `pnpm exec supabase functions serve`.

---

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `supabase/migrations/20260811090000_processor_fee_columns.sql` | `payments` fee columns, `organizations.fee_mode`, `payout_statements.processing_cents` |
| `supabase/migrations/20260811091000_processor_rates.sql` | Rate card table, seed, `processor_rate_at()` lookup |
| `supabase/migrations/20260811092000_backfill_processor_fees.sql` | One-shot backfill from `payments.raw` |
| `supabase/migrations/20260811093000_confirm_payment_tx_processor_fee.sql` | `confirm_payment_tx` accepts the processor fee |
| `supabase/migrations/20260811094000_refund_net_to_org.sql` | `refund_registration_tx` under the new refund rule |
| `supabase/migrations/20260811095000_payout_open_statement_v2.sql` | Statement arithmetic sums `net_to_org` |
| `supabase/migrations/20260811096000_processor_rate_drift.sql` | `processor_rate_drift_v` |
| `supabase/functions/_shared/processorFee.ts` | Gross-up + rate-card types. Pure functions, no I/O |
| `supabase/tests/processor-fee.test.ts` | Unit tests for `processorFee.ts` |
| `supabase/tests/processor-rates.test.ts` | Rate table, lookup, effective dates |
| `supabase/tests/processor-fee-ledger.test.ts` | Confirmation writes actual fee; integrity check |
| `supabase/tests/refund-net-to-org.test.ts` | Refund invariant + partial balance |
| `supabase/tests/payout-statements-v2.test.ts` | New statement arithmetic |
| `supabase/tests/processor-fee-backfill.test.ts` | Backfill leaves `net_to_org` untouched |
| `apps/web/lib/settlement-math.ts` | Pure settlement arithmetic — no server imports |
| `apps/web/lib/settlement-math.test.ts` | Totals + projected-range unit tests |
| `apps/web/lib/queries/settlement.ts` | Org-scoped settlement read model (server) |
| `apps/web/lib/settlement-csv.ts` | Pure CSV serialiser |
| `apps/web/lib/settlement-csv.test.ts` | CSV unit tests |
| `apps/site/lib/payment.test.ts` | Pass-on line unit tests (Task 14) |
| `apps/web/app/(admin)/events/[eventId]/settlement/page.tsx` | Organizer settlement view |
| `apps/web/app/(admin)/events/[eventId]/settlement/export-button.tsx` | Client CSV download |
| `apps/web/app/(admin)/commission/fee-mode-row.tsx` | Super-admin `fee_mode` control |

**Modified:**

| Path | Change |
| --- | --- |
| `supabase/functions/_shared/confirm.ts` | Read actual fee from payload, integrity check, pass to RPC |
| `supabase/functions/_shared/paymongo.ts` | Add `pmFeeFromAttributes()` |
| `supabase/functions/_shared/refund.ts` | `refundAmount` from `net_to_org`; drop `retainedFee` |
| `supabase/functions/payment-session/index.ts` | Pass-on gross-up |
| `apps/web/lib/queries/payouts.ts` | `processing_cents`, unreconciled count |
| `apps/web/app/(admin)/payouts/page.tsx` | Processing column, unreconciled warning |
| `apps/web/lib/queries/commission.ts` | Drift + absorbed totals |
| `apps/web/app/(admin)/commission/page.tsx` | Drift banner, fee-mode column |
| `apps/site/app/pay/[registrationId]/PayPanel.tsx` | Itemised breakdown in pass-on mode |
| `apps/site/lib/payment.ts` | `passOnLines` — display-only gross-up |
| `apps/site/lib/registration.ts` | Carry `fee_mode` through `REG_SELECT` |

---

## Task 1: Ledger columns

**Files:**
- Create: `supabase/migrations/20260811090000_processor_fee_columns.sql`
- Test: `supabase/tests/processor-fee-ledger.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `payments.processor_fee_cents int`, `payments.processor_fee_predicted_cents int null`, `payments.processor_fee_source text`, `organizations.fee_mode text`, `payout_statements.processing_cents bigint`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/processor-fee-ledger.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("processor fee columns", () => {
  it("defaults a new payment to zero fee from an unknown source", async () => {
    const s = svc();
    const stamp = `pfc-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Fee Col Org", slug: stamp,
      commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Fee Col Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
        base_price: 200000, slots_total: 10, slots_taken: 0,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 200000, status: "pending",
      }).select().single()).data!;
      const pay = (await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 200000,
      }).select("processor_fee_cents,processor_fee_predicted_cents,processor_fee_source").single()).data!;

      expect(pay.processor_fee_cents).toBe(0);
      expect(pay.processor_fee_predicted_cents).toBeNull();
      expect(pay.processor_fee_source).toBe("none");

      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });

  it("defaults an organization to absorb mode", async () => {
    const s = svc();
    const stamp = `fm-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "Mode Org", slug: stamp })
      .select("fee_mode").single()).data!;
    expect(org.fee_mode).toBe("absorb");
    await s.from("organizations").delete().eq("slug", stamp);
  });

  it("rejects an unknown fee mode", async () => {
    const s = svc();
    const stamp = `fmx-${Date.now()}`;
    const res = await s.from("organizations").insert({
      name: "Bad Mode Org", slug: stamp, fee_mode: "invoice_later",
    });
    expect(res.error).not.toBeNull();
  });

  it("rejects a negative processor fee", async () => {
    const s = svc();
    const stamp = `neg-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "Neg Org", slug: stamp })
      .select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Neg Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "5k", label: "5K",
        base_price: 100000, slots_total: 10, slots_taken: 0,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 100000, status: "pending",
      }).select().single()).data!;
      const res = await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 100000, processor_fee_cents: -1,
      });
      expect(res.error).not.toBeNull();
      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-fee-ledger.test.ts`
Expected: FAIL — `column payments.processor_fee_cents does not exist`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811090000_processor_fee_columns.sql`:

```sql
-- Three-party ledger. Design 2026-08-11 §3.
--
-- The ledger had two parties. PayMongo's processing fee appeared nowhere, so
-- Race Pace's commission silently absorbed it and the platform's real margin on
-- a card payment was 10% - 3.5% - ₱15 with no way to see that. A clean 3% is
-- not expressible while the processor's cost is invisible.

alter table payments
  add column if not exists processor_fee_cents integer not null default 0
    check (processor_fee_cents >= 0),
  add column if not exists processor_fee_predicted_cents integer
    check (processor_fee_predicted_cents is null or processor_fee_predicted_cents >= 0),
  add column if not exists processor_fee_source text not null default 'none'
    check (processor_fee_source in ('actual', 'predicted', 'historical', 'none'));

comment on column payments.processor_fee_cents is
  'What the processor actually took, in centavos. The only processor figure the ledger trusts.';
comment on column payments.processor_fee_predicted_cents is
  'What the rate card said this would cost. Kept ONLY to detect rate drift; never used in payout arithmetic.';
comment on column payments.processor_fee_source is
  '''actual'' read from the provider payload; ''predicted'' rate-card estimate awaiting reconciliation; '
  '''historical'' a real fee recovered by backfill but ABSORBED by the platform under pre-2026-08-11 terms; '
  '''none'' unknown. The invariant net_to_org = amount - processor_fee_cents - platform_fee holds for '
  '''actual'' and ''predicted'' ONLY — ''historical'' violates it deliberately, and that violation is the '
  'record that the platform paid for processing on that entry.';

-- Who bears the processing cost. Deliberately NOT folded into commission_type:
-- an org can be on a flat peso commission AND pass-on mode. Mode and rate are
-- negotiated separately, so they are stored separately.
alter table organizations
  add column if not exists fee_mode text not null default 'absorb'
    check (fee_mode in ('absorb', 'pass_on'));

comment on column organizations.fee_mode is
  '''absorb'': the runner pays the sticker price and the organizer bears processing. '
  '''pass_on'': the surcharge is grossed up onto the runner and the organizer receives the full sticker price. '
  'Super admin only.';

-- 3% for organizations created from here on. Existing rows keep their terms:
-- a default is for rows that do not exist yet. Same reasoning as
-- 20260807090100_commission_and_refund_policy.sql.
alter table organizations alter column commission_rate set default 0.03;

alter table payout_statements
  add column if not exists processing_cents bigint not null default 0;
```

- [ ] **Step 4: Apply and run tests**

Run:
```bash
pnpm exec supabase db reset && pnpm test -- supabase/tests/processor-fee-ledger.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811090000_processor_fee_columns.sql supabase/tests/processor-fee-ledger.test.ts
git commit -m "feat(db): add processor fee columns and org fee_mode"
```

---

## Task 2: Rate card table

**Files:**
- Create: `supabase/migrations/20260811091000_processor_rates.sql`
- Test: `supabase/tests/processor-rates.test.ts`

**Interfaces:**
- Consumes: Task 1 columns
- Produces: table `processor_rates`; function `public.processor_rate_at(p_provider text, p_method text, p_scope text, p_at timestamptz) returns table(percent_bps int, fixed_cents int)`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/processor-rates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("processor_rates", () => {
  it("seeds VAT-INCLUSIVE rates for the methods the checkout offers", async () => {
    const s = svc();
    const { data, error } = await s.from("processor_rates")
      .select("method,scope,percent_bps,fixed_cents")
      .eq("provider", "paymongo").is("effective_to", null);
    expect(error).toBeNull();
    const byKey = new Map(data!.map((r) => [`${r.method}:${r.scope}`, r]));

    // Quoted ex-VAT x 1.12. 3.125% -> 3.50%, ₱13.39 -> ₱15.00.
    expect(byKey.get("card:local")).toMatchObject({ percent_bps: 350, fixed_cents: 1500 });
    expect(byKey.get("card:international")).toMatchObject({ percent_bps: 450, fixed_cents: 1500 });
    expect(byKey.get("gcash:local")).toMatchObject({ percent_bps: 150, fixed_cents: 0 });
    expect(byKey.get("paymaya:local")).toMatchObject({ percent_bps: 150, fixed_cents: 0 });
  });

  it("returns the rate in force at a given time, not today's", async () => {
    const s = svc();
    const stamp = `rate-${Date.now()}`;
    // Close the current gcash row and open a new one, so there are two eras.
    const cut = "2026-09-01T00:00:00Z";
    await s.from("processor_rates").update({ effective_to: cut })
      .eq("provider", "paymongo").eq("method", "gcash").eq("scope", "local").is("effective_to", null);
    const inserted = (await s.from("processor_rates").insert({
      provider: "paymongo", method: "gcash", scope: "local",
      percent_bps: 200, fixed_cents: 0, effective_from: cut, note: stamp,
    }).select().single()).data!;
    try {
      const before = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: "gcash", p_scope: "local",
        p_at: "2026-08-15T00:00:00Z",
      });
      expect(before.data![0]).toMatchObject({ percent_bps: 150 });

      const after = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: "gcash", p_scope: "local",
        p_at: "2026-09-15T00:00:00Z",
      });
      expect(after.data![0]).toMatchObject({ percent_bps: 200 });
    } finally {
      await s.from("processor_rates").delete().eq("id", inserted.id);
      await s.from("processor_rates").update({ effective_to: null })
        .eq("provider", "paymongo").eq("method", "gcash").eq("scope", "local").eq("effective_to", cut);
    }
  });

  it("returns no row for a method with no rate card entry", async () => {
    const s = svc();
    const { data } = await s.rpc("processor_rate_at", {
      p_provider: "paymongo", p_method: "grab_pay", p_scope: "local",
      p_at: "2026-08-15T00:00:00Z",
    });
    expect(data ?? []).toHaveLength(0);
  });

  it("allows only one open-ended row per provider/method/scope", async () => {
    const s = svc();
    const res = await s.from("processor_rates").insert({
      provider: "paymongo", method: "gcash", scope: "local",
      percent_bps: 999, fixed_cents: 0,
    });
    expect(res.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-rates.test.ts`
Expected: FAIL — `relation "public.processor_rates" does not exist`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811091000_processor_rates.sql`:

```sql
-- The rate card. Design 2026-08-11 §3.3.
--
-- Data rather than code so it can be corrected without a deploy — and versioned
-- by effective date so a prediction made in August is still explainable in
-- December.
--
-- This table predicts. It NEVER decides. The ledger reads the provider's own
-- reported fee (§2), so a stale row here cannot make a report wrong; it can only
-- make a pass-on surcharge under- or over-collect, which §5 detects from actuals.

create table if not exists processor_rates (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null default 'paymongo',
  method         text not null,
  scope          text not null default 'local'
                   check (scope in ('local', 'international')),
  -- VAT-INCLUSIVE basis points. 350 = 3.50%. The commonly-quoted PayMongo
  -- figures are ex-VAT; every one of them x 1.12 lands on the published rate
  -- (3.125% -> 3.50%, 1.34% -> 1.50%). Storing ex-VAT and deducting VAT-inclusive
  -- is precisely the reconciliation failure this design exists to prevent.
  percent_bps    integer not null check (percent_bps >= 0),
  fixed_cents    integer not null default 0 check (fixed_cents >= 0),
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  note           text,
  created_by     uuid references auth.users(id),
  check (effective_to is null or effective_to > effective_from)
);

-- At most one CURRENT row per method. Historical rows accumulate with an
-- effective_to, which is what makes the lookup below unambiguous.
create unique index if not exists processor_rates_one_current
  on processor_rates (provider, method, scope) where effective_to is null;

create index if not exists processor_rates_lookup_idx
  on processor_rates (provider, method, scope, effective_from desc);

alter table processor_rates enable row level security;

drop policy if exists processor_rates_read on processor_rates;
-- Readable by any signed-in user: the pass-on breakdown on the pay screen is
-- rendered from it, and it is a published price list, not a secret.
create policy processor_rates_read on processor_rates for select to authenticated using (true);

drop policy if exists processor_rates_write on processor_rates;
create policy processor_rates_write on processor_rates
  for all using (auth_is_super_admin()) with check (auth_is_super_admin());

grant select on processor_rates to authenticated;
-- Tables created inside a migration do NOT inherit the default privileges that
-- dashboard-created tables get. Without this, every service-role read fails.
grant all on processor_rates to service_role;

-- Seed, VAT-INCLUSIVE.
--
-- Only card/gcash/paymaya are reachable today — METHOD_MAP in
-- payment-session/index.ts offers no others. The rest are seeded so enabling a
-- method is a UI change rather than a schema change.
--
-- GrabPay and ShopeePay are deliberately absent: their quoted 1.34-2.2% ex-VAT
-- is a range across integration tiers rather than a rate, so seeding either end
-- would be a guess in a table whose whole job is to be right.
insert into processor_rates (provider, method, scope, percent_bps, fixed_cents, note)
values
  ('paymongo', 'card',     'local',         350, 1500, 'Quoted 3.125% + ₱13.39 ex-VAT'),
  ('paymongo', 'card',     'international', 450, 1500, 'Quoted 4.02% + ₱13.39 ex-VAT'),
  ('paymongo', 'gcash',    'local',         150,    0, 'Quoted 1.34% ex-VAT'),
  ('paymongo', 'paymaya',  'local',         150,    0, 'Quoted 1.34% ex-VAT'),
  ('paymongo', 'qrph',     'local',         150,    0, 'Quoted 1.34% ex-VAT'),
  -- Least certain of the six. The source quotes "~0.71% OR ₱13.39, varies by
  -- partnered bank" — two different shapes, not a range. Seeded as a percentage
  -- and to be corrected from real settlements before the method is enabled.
  ('paymongo', 'dob',      'local',          80,    0, 'Quoted ~0.71% ex-VAT — UNCONFIRMED'),
  ('paymongo', 'billease', 'local',         150,    0, 'Quoted 1.34% ex-VAT')
on conflict do nothing;

-- The rate in force AT A GIVEN MOMENT — not today's.
--
-- Predicting a March payment with August's rate would make every historical
-- drift comparison meaningless, since the "disagreement" would just be the rate
-- change itself.
create or replace function public.processor_rate_at(
  p_provider text, p_method text, p_scope text, p_at timestamptz
) returns table (percent_bps integer, fixed_cents integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.percent_bps, r.fixed_cents
  from public.processor_rates r
  where r.provider = p_provider
    and r.method   = p_method
    and r.scope    = p_scope
    and r.effective_from <= p_at
    and (r.effective_to is null or r.effective_to > p_at)
  order by r.effective_from desc
  limit 1;
$$;

-- service_role ONLY. Every caller of this function is server-side: _shared/confirm.ts
-- and payment-session/index.ts both bind `db` to serviceClient(). The client-side
-- readers (Task 12's settlement view, Task 14's pay screen) read the TABLE directly
-- under processor_rates_read, not through this RPC.
--
-- An `authenticated` grant here would therefore have no caller — and adding one
-- forces an entry into function-grants.test.ts's closed allowlist, documenting a
-- call site that does not exist. A security allowlist is only worth as much as its
-- comments. If a client ever needs the RPC, grant it then, with a real justification.
revoke all on function public.processor_rate_at(text, text, text, timestamptz) from public;
grant execute on function public.processor_rate_at(text, text, text, timestamptz) to service_role;
```

> **Known gap, deferred by decision:** nothing prevents two CLOSED rows for the same `(provider, method, scope)` from having overlapping `[effective_from, effective_to)` ranges — the partial unique index only guarantees one OPEN row. `processor_rate_at`'s `order by effective_from desc limit 1` would silently pick one rather than error. Unreachable through any current code path (writes are `auth_is_super_admin()`-gated and follow close-then-insert), so a `tstzrange` + `EXCLUDE USING gist` constraint is left to the final review to triage.

- [ ] **Step 4: Apply and run tests**

Run:
```bash
pnpm exec supabase db reset && pnpm test -- supabase/tests/processor-rates.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Verify the grants canary still passes**

Run: `pnpm test -- supabase/tests/function-grants.test.ts`
Expected: PASS with **no edit to that file**. `processor_rate_at` is granted to `service_role` only, so it never enters the `authenticated` enumeration. If you find yourself adding an allowlist entry to make this pass, your grants are wrong — fix the migration, not the canary.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811091000_processor_rates.sql supabase/tests/processor-rates.test.ts
git commit -m "feat(db): add versioned processor rate card"
```

---

## Task 3: Gross-up math

**Files:**
- Create: `supabase/functions/_shared/processorFee.ts`
- Create: `supabase/tests/processor-fee.test.ts`

**Interfaces:**
- Consumes: nothing (pure module)
- Produces:
  - `export interface ProcessorRate { percent_bps: number; fixed_cents: number }`
  - `export function predictProcessorFee(amount: number, rate: ProcessorRate): number`
  - `export function grossUpCharge(target: number, rate: ProcessorRate): number`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/processor-fee.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { predictProcessorFee, grossUpCharge, type ProcessorRate } from "../functions/_shared/processorFee.ts";

const CARD: ProcessorRate = { percent_bps: 350, fixed_cents: 1500 };
const GCASH: ProcessorRate = { percent_bps: 150, fixed_cents: 0 };
const INTL: ProcessorRate = { percent_bps: 450, fixed_cents: 1500 };

describe("predictProcessorFee", () => {
  it("takes a percentage plus a fixed amount", () => {
    // 3.5% of ₱2,000 = ₱70, + ₱15 = ₱85
    expect(predictProcessorFee(200000, CARD)).toBe(8500);
  });

  it("takes a bare percentage when there is no fixed component", () => {
    expect(predictProcessorFee(200000, GCASH)).toBe(3000);
  });

  it("rounds to whole centavos", () => {
    expect(predictProcessorFee(33333, GCASH)).toBe(500); // 499.995 -> 500
  });

  it("charges nothing on a zero amount", () => {
    expect(predictProcessorFee(0, CARD)).toBe(0);
    expect(predictProcessorFee(0, GCASH)).toBe(0);
  });
});

describe("grossUpCharge", () => {
  it("covers the processor's cut on the LARGER total, not the base", () => {
    // Target ₱2,060 must survive a 3.5% + ₱15 deduction.
    // Naive addition gives ₱2,147.10 and comes up ₱3.16 short every time.
    expect(grossUpCharge(206000, CARD)).toBe(215026);
  });

  it("grosses up a percentage-only rate", () => {
    expect(grossUpCharge(206000, GCASH)).toBe(209138);
  });

  it("ROUND-TRIPS: charge minus the processor's actual cut always covers the target", () => {
    const rates = [CARD, GCASH, INTL, { percent_bps: 80, fixed_cents: 0 }];
    const targets = [1, 100, 5000, 206000, 1000000, 33333, 99999];
    for (const rate of rates) {
      for (const target of targets) {
        const charge = grossUpCharge(target, rate);
        const fee = predictProcessorFee(charge, rate);
        // Never a shortfall. The ceil puts the sub-centavo remainder on the
        // organizer's side, so at most ₱0.01 over — never under.
        expect(charge - fee).toBeGreaterThanOrEqual(target);
        expect(charge - fee).toBeLessThanOrEqual(target + 1);
      }
    }
  });

  it("returns zero for a zero target", () => {
    expect(grossUpCharge(0, CARD)).toBe(0);
  });

  it("throws rather than inverting when a rate is 100% or more", () => {
    // 1 / (1 - 1.0) is a division by zero; anything above is a NEGATIVE charge.
    // A silently negative charge is money moving the wrong way.
    expect(() => grossUpCharge(200000, { percent_bps: 10000, fixed_cents: 0 })).toThrow();
    expect(() => grossUpCharge(200000, { percent_bps: 12000, fixed_cents: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-fee.test.ts`
Expected: FAIL — cannot resolve `../functions/_shared/processorFee.ts`

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/processorFee.ts`:

```ts
/** A processor's price for one payment method, VAT-INCLUSIVE.
 *
 *  `percent_bps` is basis points: 350 = 3.50%. Basis points rather than a float
 *  rate so the whole calculation stays in integer arithmetic — a float rate
 *  reintroduces exactly the rounding drift this module exists to avoid. */
export interface ProcessorRate {
  percent_bps: number;
  fixed_cents: number;
}

/**
 * What the rate card says a payment of `amount` will cost, in centavos.
 *
 * PREDICTION ONLY. The ledger never uses this — it reads the provider's own
 * reported fee. This feeds the pass-on surcharge and the estimates shown to
 * humans, which are the only two surfaces a stale rate can affect.
 */
export function predictProcessorFee(amount: number, rate: ProcessorRate): number {
  if (amount <= 0) return 0;
  return Math.round((amount * rate.percent_bps) / 10000) + rate.fixed_cents;
}

/**
 * The amount to charge so that exactly `target` survives the processor's cut.
 *
 * THE GROSS-UP IS NOT OPTIONAL. PayMongo charges its percentage on the FINAL
 * amount, so adding the fee to the base under-collects on every transaction:
 * for a ₱2,060 target on a card, naive addition charges ₱2,147.10 and lands
 * ₱3.16 short, forever, silently.
 *
 *   charge = ceil((target + fixed) / (1 - rate))
 *
 * Expressed with a *10000 numerator so it is integer division throughout.
 *
 * `ceil` rather than `round`: it puts the sub-centavo remainder on the
 * organizer's side of the split — at most ₱0.01 per transaction, and never a
 * shortfall. Rounding down would make roughly half of all payments a penny
 * short, which is a reconciliation problem out of all proportion to a penny.
 */
export function grossUpCharge(target: number, rate: ProcessorRate): number {
  if (target <= 0) return 0;
  if (rate.percent_bps >= 10000) {
    // At exactly 100% this is a division by zero; above it the "charge" comes
    // out negative, which would move money the wrong way. Neither is a number
    // to hand a payment provider.
    throw new Error(`processor rate of ${rate.percent_bps}bps is not chargeable`);
  }
  return Math.ceil(((target + rate.fixed_cents) * 10000) / (10000 - rate.percent_bps));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- supabase/tests/processor-fee.test.ts`
Expected: PASS (9 tests, including the round-trip property across 28 rate/target combinations)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/processorFee.ts supabase/tests/processor-fee.test.ts
git commit -m "feat(payments): add gross-up and rate-card fee prediction"
```

---

## Task 4: Read PayMongo's actual fee

**Files:**
- Modify: `supabase/functions/_shared/paymongo.ts` (append after `pmMethodFromSession`)
- Test: `supabase/tests/processor-fee.test.ts` (append)

**Interfaces:**
- Consumes: nothing
- Produces: `export function pmFeeFromAttributes(attributes: any): { fee: number; netAmount: number; amount: number } | null`

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/processor-fee.test.ts`:

```ts
import { pmFeeFromAttributes } from "../functions/_shared/paymongo.ts";

const session = (payments: unknown[]) => ({ payments });
const payment = (status: string, amount: number, fee: number, net: number) => ({
  id: `pay_${status}`, attributes: { status, amount, fee, net_amount: net },
});

describe("pmFeeFromAttributes", () => {
  it("reads fee and net_amount off the PAID payment", () => {
    expect(pmFeeFromAttributes(session([payment("paid", 200000, 3000, 197000)])))
      .toEqual({ fee: 3000, netAmount: 197000, amount: 200000 });
  });

  it("prefers the paid payment over an earlier failed attempt", () => {
    // A session can carry an abandoned attempt followed by a successful one.
    // payments[0] would report the instrument and fee the runner did NOT use.
    const s = session([
      payment("failed", 200000, 0, 0),
      payment("paid", 200000, 8500, 191500),
    ]);
    expect(pmFeeFromAttributes(s)).toEqual({ fee: 8500, netAmount: 191500, amount: 200000 });
  });

  it("returns null when there is no payment at all", () => {
    expect(pmFeeFromAttributes(session([]))).toBeNull();
    expect(pmFeeFromAttributes({})).toBeNull();
    expect(pmFeeFromAttributes(null)).toBeNull();
  });

  it("returns null when the fee field is absent — a known-unknown, not a zero", () => {
    // Reporting 0 here would be indistinguishable from a genuinely free payment
    // and would write a wrong net_to_org.
    expect(pmFeeFromAttributes(session([
      { id: "pay_x", attributes: { status: "paid", amount: 200000 } },
    ]))).toBeNull();
  });

  it("returns null when any ONE of the three figures is missing or mistyped", () => {
    // Each checked independently. `amount` matters as much as the other two:
    // the caller's integrity check is `amount - fee === net_amount`, so a
    // fabricated amount would make that check compare an invented number.
    const attrs = (over: Record<string, unknown>) =>
      session([{ id: "pay_x", attributes: { status: "paid", ...over } }]);

    expect(pmFeeFromAttributes(attrs({ fee: 3000, net_amount: 197000 }))).toBeNull();   // no amount
    expect(pmFeeFromAttributes(attrs({ amount: 200000, net_amount: 197000 }))).toBeNull(); // no fee
    expect(pmFeeFromAttributes(attrs({ amount: 200000, fee: 3000 }))).toBeNull();       // no net_amount
    // A numeric STRING is not a number — never coerce money.
    expect(pmFeeFromAttributes(attrs({ amount: "200000", fee: 3000, net_amount: 197000 }))).toBeNull();
    expect(pmFeeFromAttributes(attrs({ amount: 200000, fee: null, net_amount: 197000 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-fee.test.ts`
Expected: FAIL — `pmFeeFromAttributes is not a function`

- [ ] **Step 3: Write the implementation**

Append to `supabase/functions/_shared/paymongo.ts`:

```ts
/**
 * What the processor actually charged, from a checkout session's attributes.
 *
 * PayMongo settles NET: on a ₱2,000 payment, ₱1,970 arrives. The payment object
 * reports both halves — `fee` and `net_amount`, integers in centavos — and
 * `payments.raw` has been storing this whole payload all along without anyone
 * reading it.
 *
 * This is what makes the ledger immune to rate drift. Recording what was
 * actually charged, rather than what a rate card predicted, means a PayMongo
 * pricing change is reflected the same day with nobody noticing anything.
 *
 * Takes `attributes` rather than a PmSession so both callers can use it, matching
 * pmMethodFromAttributes: payment-verify holds a parsed session, payments-webhook
 * holds only the raw event resource.
 *
 * Returns null rather than zero when ANY of the three figures is absent. A zero
 * fee is indistinguishable from a genuinely free payment, and would write a
 * net_to_org that overpays the organizer by exactly the processor's cut.
 *
 * `amount` is held to the same standard, and that is load-bearing rather than
 * tidiness. The caller's integrity check is `amount - fee === net_amount`; if a
 * missing `amount` were allowed to become 0, that check would be comparing a
 * fabricated number, and the guard that skips it for a zero amount would let an
 * unverified fee be recorded as 'actual'. The one safeguard that validates the
 * provider's own arithmetic would disarm itself in precisely the case where the
 * payload was malformed. PayMongo's payment object always carries `amount`, so
 * requiring it rejects only genuinely broken payloads.
 */
// deno-lint-ignore no-explicit-any
export function pmFeeFromAttributes(
  attributes: any,
): { fee: number; netAmount: number; amount: number } | null {
  const payments: unknown[] = Array.isArray(attributes?.payments) ? attributes.payments : [];
  // deno-lint-ignore no-explicit-any
  const chosen = (payments as any[]).find((p) => p?.attributes?.status === "paid") ?? payments[0];
  // deno-lint-ignore no-explicit-any
  const a = (chosen as any)?.attributes;
  if (
    !a || typeof a.fee !== "number" || typeof a.net_amount !== "number" ||
    typeof a.amount !== "number"
  ) return null;
  return { fee: a.fee, netAmount: a.net_amount, amount: a.amount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- supabase/tests/processor-fee.test.ts`
Expected: PASS (all tests green — 9 from Task 3 plus the pmFeeFromAttributes block)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/paymongo.ts supabase/tests/processor-fee.test.ts
git commit -m "feat(payments): read PayMongo's reported fee and net_amount"
```

---

## Task 5: Write the processor fee at confirmation

**Files:**
- Create: `supabase/migrations/20260811093000_confirm_payment_tx_processor_fee.sql`
- Modify: `supabase/functions/_shared/confirm.ts`
- Test: `supabase/tests/processor-fee-ledger.test.ts` (append)

**Interfaces:**
- Consumes: `pmFeeFromAttributes` (Task 4), `predictProcessorFee` (Task 3), `processor_rate_at` (Task 2)
- Produces: `confirm_payment_tx(p_registration_id uuid, p_method text, p_fee int, p_net int, p_token text, p_raw jsonb, p_processor_fee int, p_processor_fee_predicted int, p_processor_fee_source text)`

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/processor-fee-ledger.test.ts`:

```ts
describe("confirm_payment_tx with a processor fee", () => {
  /** Fresh org + event + category + pending registration + payment row. */
  async function fixture(tag: string, feeMode = "absorb") {
    const s = svc();
    const stamp = `${tag}-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Confirm Org", slug: stamp, fee_mode: feeMode,
      commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    const ev = (await s.from("events").insert({
      org_id: org.id, name: "Confirm Race", status: "published",
    }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
      base_price: 200000, slots_total: 100, slots_taken: 0,
    }).select().single()).data!;
    const user = (await s.auth.admin.createUser({
      email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
    })).data.user!;
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id,
      user_id: user.id, total_amount: 200000, status: "pending",
    }).select().single()).data!;
    await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 200000, status: "pending",
    });
    return {
      s, org, reg,
      cleanup: async () => {
        await s.from("organizations").delete().eq("id", org.id);
        await s.auth.admin.deleteUser(user.id);
      },
    };
  }

  it("stores the actual fee and leaves net_to_org = amount - fee - commission", async () => {
    const f = await fixture("cfa");
    try {
      // ₱2,000 GCash: RP 3% = ₱60, PayMongo 1.5% = ₱30, organizer ₱1,910.
      const { data } = await f.s.rpc("confirm_payment_tx", {
        p_registration_id: f.reg.id, p_method: "gcash",
        p_fee: 6000, p_net: 191000, p_token: "tok", p_raw: {},
        p_processor_fee: 3000, p_processor_fee_predicted: 3000, p_processor_fee_source: "actual",
      });
      expect(data).toBe("paid");

      const pay = (await f.s.from("payments")
        .select("amount,platform_fee,net_to_org,processor_fee_cents,processor_fee_source")
        .eq("registration_id", f.reg.id).single()).data!;
      expect(pay).toMatchObject({
        amount: 200000, platform_fee: 6000, net_to_org: 191000,
        processor_fee_cents: 3000, processor_fee_source: "actual",
      });
      // The ledger invariant.
      expect(pay.amount - pay.processor_fee_cents - pay.platform_fee).toBe(pay.net_to_org);
    } finally {
      await f.cleanup();
    }
  });

  it("records a predicted fee when the provider did not report one", async () => {
    const f = await fixture("cfp");
    try {
      await f.s.rpc("confirm_payment_tx", {
        p_registration_id: f.reg.id, p_method: "card",
        p_fee: 6000, p_net: 185500, p_token: "tok", p_raw: {},
        p_processor_fee: 8500, p_processor_fee_predicted: 8500, p_processor_fee_source: "predicted",
      });
      const pay = (await f.s.from("payments")
        .select("processor_fee_cents,processor_fee_source").eq("registration_id", f.reg.id).single()).data!;
      expect(pay).toMatchObject({ processor_fee_cents: 8500, processor_fee_source: "predicted" });
    } finally {
      await f.cleanup();
    }
  });

  it("keeps the old 6-arg behaviour available to callers not yet taught about fees", async () => {
    const f = await fixture("cfo");
    try {
      const { data, error } = await f.s.rpc("confirm_payment_tx", {
        p_registration_id: f.reg.id, p_method: "gcash",
        p_fee: 6000, p_net: 194000, p_token: "tok", p_raw: {},
      });
      expect(error).toBeNull();
      expect(data).toBe("paid");
      const pay = (await f.s.from("payments")
        .select("processor_fee_cents,processor_fee_source").eq("registration_id", f.reg.id).single()).data!;
      expect(pay).toMatchObject({ processor_fee_cents: 0, processor_fee_source: "none" });
    } finally {
      await f.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-fee-ledger.test.ts`
Expected: FAIL — `Could not find the function public.confirm_payment_tx(... p_processor_fee ...)`

- [ ] **Step 3: Dump the CURRENT function body**

**Do not write this function from scratch, and do not reconstruct it from the migration files.** `confirm_payment_tx` has been rewritten four times (`20260806*`, `20260808140000`, `20260809100300`) and the live body is the only authoritative version. `20260808140000_money_txn_audit.sql`'s header documents this exact trap and the procedure below is the one it used.

Run:
```bash
pnpm exec supabase db query --linked "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'confirm_payment_tx';"
```

Confirm the signature first:
```bash
pnpm exec supabase db query --linked "select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'confirm_payment_tx';"
```
Expected: `p_registration_id uuid, p_method text, p_fee integer, p_net integer, p_token text, p_raw jsonb`

- [ ] **Step 4: Write the migration around that body**

Create `supabase/migrations/20260811093000_confirm_payment_tx_processor_fee.sql`. Paste the dumped body **verbatim** and make exactly three edits to it:

1. Add the three new parameters to the signature, with defaults that preserve current behaviour.
2. Add the three `processor_fee_*` assignments to the existing `update public.payments` statement. Do not add a second UPDATE.
3. Leave everything else untouched — the `for update` row lock, the `expired`/`conflict` branch, the `tickets` insert, the `registration_audit` insert, `security definer`, `set search_path`.

The file's frame:

```sql
-- confirm_payment_tx records the processor's cut. Design 2026-08-11 §4.1.
--
-- Body pasted verbatim from pg_get_functiondef against the linked project, NOT
-- from any migration file — the same procedure and for the same reason as
-- 20260808140000_money_txn_audit.sql. This function has been rewritten four
-- times; only the live definition is authoritative.
--
-- The ONLY edits: three new parameters, and three assignments added to the
-- EXISTING `update public.payments`. No new statement, no changed logic.
--
-- Adding parameters with DEFAULTs creates an OVERLOAD, and Postgres resolves an
-- exact 6-arg call to the OLD function every time — so the new logic would never
-- run for any existing caller. The same trap 20260807090400_refund_policy_tx.sql
-- documented. Drop the old one; the defaults preserve its behaviour for any
-- 6-arg call site not yet updated.
drop function if exists public.confirm_payment_tx(uuid, text, int, int, text, jsonb);

create or replace function public.confirm_payment_tx(
  p_registration_id         uuid,
  p_method                  text,
  p_fee                     integer,
  p_net                     integer,
  p_token                   text,
  p_raw                     jsonb,
  p_processor_fee           integer default 0,
  p_processor_fee_predicted integer default null,
  p_processor_fee_source    text    default 'none'
) returns text
language plpgsql
security definer
set search_path = ''
as $function$
-- ⇩⇩ PASTE THE DUMPED BODY FROM STEP 3 HERE, declare … end, UNCHANGED ⇩⇩
-- except that its `update public.payments set …` gains these three lines:
--
--          processor_fee_cents           = coalesce(p_processor_fee, 0),
--          processor_fee_predicted_cents = p_processor_fee_predicted,
--          processor_fee_source          = coalesce(p_processor_fee_source, 'none'),
--
$function$;

revoke all on function public.confirm_payment_tx(uuid, text, integer, integer, text, jsonb, integer, integer, text) from public;
grant execute on function public.confirm_payment_tx(uuid, text, integer, integer, text, jsonb, integer, integer, text) to service_role;
```

- [ ] **Step 5: Apply and run the DB tests**

Run:
```bash
pnpm exec supabase db reset && pnpm test -- supabase/tests/processor-fee-ledger.test.ts supabase/tests/money-txn.test.ts supabase/tests/registration-audit.test.ts
```
Expected: PASS — the new fee tests, plus `money-txn` and `registration-audit`, which together prove the pasted body preserved the audit rows and the expired/conflict branch.

- [ ] **Step 6: Update the Edge Function caller**

In `supabase/functions/_shared/confirm.ts`:

Change the import block at the top to add the two new imports:

```ts
import { computeFee, type FeeTerms } from "./fee.ts";
import { predictProcessorFee, type ProcessorRate } from "./processorFee.ts";
import { pmFeeFromAttributes } from "./paymongo.ts";
```

Replace the block that computes `fee`/`net` and calls the RPC. Find:

```ts
  const fee = computeFee(reg.total_amount, terms);
  const net = reg.total_amount - fee;
```

Replace with:

```ts
  const fee = computeFee(reg.total_amount, terms);

  // What the processor actually took. PayMongo settles NET, and reports both
  // halves on the payment object we already store in payments.raw.
  //
  // Reading the ACTUAL fee rather than predicting it is what makes the ledger
  // immune to rate drift: if PayMongo changes its pricing tomorrow, this is
  // still exactly right the same day and nobody has to notice anything.
  // deno-lint-ignore no-explicit-any
  const attrs = (raw as any)?.data?.attributes ?? (raw as any)?.attributes ?? raw;
  const reported = pmFeeFromAttributes(attrs);

  let processorFee = 0;
  let processorFeeSource = "none";
  let processorFeePredicted: number | null = null;

  // The rate card's opinion, kept ONLY so drift is measurable. Never authoritative.
  const { data: rateRows } = await db.rpc("processor_rate_at", {
    p_provider: "paymongo", p_method: method, p_scope: "local",
    p_at: new Date().toISOString(),
  });
  const rate = (rateRows as ProcessorRate[] | null)?.[0] ?? null;
  if (rate) processorFeePredicted = predictProcessorFee(reg.total_amount, rate);

  if (reported) {
    // PayMongo's own arithmetic must hold. A figure that fails it is not one we
    // can defend to an organizer, so it does not get to be called 'actual'.
    // No `amount > 0` guard: pmFeeFromAttributes returns null unless all three
    // figures are real numbers, so `reported` here always carries a genuine
    // amount. Guarding on it would mean a malformed payload SKIPS this check and
    // records an unverified fee as 'actual' — disarming the safeguard in exactly
    // the case it exists for.
    if (reported.amount - reported.fee !== reported.netAmount) {
      console.error(
        `[confirm] FEE INTEGRITY FAILURE registration=${reg.id} — ` +
          `amount ${reported.amount} - fee ${reported.fee} != net_amount ${reported.netAmount}. ` +
          `Recording as predicted and flagging for manual review.`,
      );
      processorFee = processorFeePredicted ?? 0;
      processorFeeSource = processorFeePredicted === null ? "none" : "predicted";
    } else {
      processorFee = reported.fee;
      processorFeeSource = "actual";
    }
  } else if (processorFeePredicted !== null) {
    // No reported fee yet. Use the estimate so net_to_org is computable and the
    // organizer is never blocked, and mark it for reconciliation.
    processorFee = processorFeePredicted;
    processorFeeSource = "predicted";
  }

  const net = reg.total_amount - fee - processorFee;
```

Then extend the RPC call. Find:

```ts
  const { data: result, error } = await db.rpc("confirm_payment_tx", {
    p_registration_id: reg.id,
    p_method: method,
    p_fee: fee,
    p_net: net,
    p_token: token,
    p_raw: (raw ?? {}) as Record<string, unknown>,
  });
```

Replace with:

```ts
  const { data: result, error } = await db.rpc("confirm_payment_tx", {
    p_registration_id: reg.id,
    p_method: method,
    p_fee: fee,
    p_net: net,
    p_token: token,
    p_raw: (raw ?? {}) as Record<string, unknown>,
    p_processor_fee: processorFee,
    p_processor_fee_predicted: processorFeePredicted,
    p_processor_fee_source: processorFeeSource,
  });
```

- [ ] **Step 7: Run the full backend suite**

Run:
```bash
pnpm exec supabase functions serve &
pnpm test -- supabase/tests/backend.test.ts supabase/tests/payment-method.test.ts
```
Expected: PASS. If `backend.test.ts` reports "Edge Function returned a non-2xx status code", `functions serve` is not running.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260811093000_confirm_payment_tx_processor_fee.sql supabase/functions/_shared/confirm.ts supabase/tests/processor-fee-ledger.test.ts
git commit -m "feat(payments): record the processor's actual fee at confirmation"
```

---

## Task 6: Pass-on surcharge at checkout

**Files:**
- Modify: `supabase/functions/payment-session/index.ts`
- Test: `supabase/tests/processor-fee.test.ts` (append)

**Interfaces:**
- Consumes: `grossUpCharge`, `predictProcessorFee` (Task 3), `processor_rate_at` (Task 2), `organizations.fee_mode` (Task 1)
- Produces: `export function passOnBreakdown(baseTotal, platformFee, rate)` → `{ base, platformFee, processorFee, total }`

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/processor-fee.test.ts`:

```ts
import { passOnBreakdown } from "../functions/_shared/processorFee.ts";

describe("passOnBreakdown", () => {
  it("grosses up so the organizer receives the full base", () => {
    // ₱2,000 base, RP 3% = ₱60, GCash 1.5%.
    const b = passOnBreakdown(200000, 6000, GCASH);
    expect(b).toEqual({ base: 200000, platformFee: 6000, processorFee: 3137, total: 209138 });
    // What survives covers base + commission.
    expect(b.total - b.processorFee).toBeGreaterThanOrEqual(206000);
  });

  it("covers the fixed component on a card", () => {
    const b = passOnBreakdown(200000, 6000, CARD);
    expect(b).toEqual({ base: 200000, platformFee: 6000, processorFee: 9026, total: 215026 });
    expect(b.total - b.processorFee).toBe(206000);
  });

  it("keeps the lines summing to the total for every rate", () => {
    for (const rate of [CARD, GCASH, INTL]) {
      const b = passOnBreakdown(200000, 6000, rate);
      expect(b.base + b.platformFee + b.processorFee).toBe(b.total);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-fee.test.ts`
Expected: FAIL — `passOnBreakdown is not a function`

- [ ] **Step 3: Add the breakdown helper**

Append to `supabase/functions/_shared/processorFee.ts`:

```ts
/** The itemised lines a pass-on runner sees, and the total they are charged.
 *
 *  The processor line is derived as `total - base - platformFee` rather than
 *  predicted independently, so the three lines ALWAYS sum to the total. Showing
 *  a breakdown whose parts do not add up is worse than showing no breakdown. */
export function passOnBreakdown(
  baseTotal: number,
  platformFee: number,
  rate: ProcessorRate,
): { base: number; platformFee: number; processorFee: number; total: number } {
  const total = grossUpCharge(baseTotal + platformFee, rate);
  return { base: baseTotal, platformFee, processorFee: total - baseTotal - platformFee, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- supabase/tests/processor-fee.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Wire it into the session**

In `supabase/functions/payment-session/index.ts`:

Add to the imports at the top:

```ts
import { computeFee, type FeeTerms } from "../_shared/fee.ts";
import { passOnBreakdown, type ProcessorRate } from "../_shared/processorFee.ts";
```

The registration select currently reads:

```ts
    const { data: reg } = await db.from("registrations").select("id,user_id,status,total_amount,category_id,event_id,expires_at").eq("id", registrationId).single();
```

Replace with (adds the org's terms — all four columns, not just the mode; fetching only `fee_mode` would send a `fixed` org down the percent branch and charge it 10% instead of its flat fee, silently):

```ts
    const { data: reg } = await db.from("registrations")
      .select(
        "id,user_id,status,total_amount,category_id,event_id,expires_at," +
        "organizations(fee_mode,commission_type,commission_rate,commission_flat_cents)",
      )
      .eq("id", registrationId).single();
```

Then, immediately before the `provider.createCheckout` call, replace:

```ts
    const entry = category?.base_price ?? reg.total_amount;
    const addonTotal = reg.total_amount - entry;
    const lineItems = [{ name: category?.label ?? "Race registration", amount: entry }];
    if (addonTotal > 0) lineItems.push({ name: "Add-ons", amount: addonTotal });
```

with:

```ts
    const entry = category?.base_price ?? reg.total_amount;
    const addonTotal = reg.total_amount - entry;
    const lineItems = [{ name: category?.label ?? "Race registration", amount: entry }];
    if (addonTotal > 0) lineItems.push({ name: "Add-ons", amount: addonTotal });

    // Pass-on mode: the runner covers Race Pace's commission and the processing
    // cost, so the organizer receives the full sticker price.
    //
    // The surcharge is computed HERE — at the moment the method is known and the
    // scoped session is recreated — because PayMongo's cut depends on the method.
    // A ₱2,000 entry costs ₱30 on GCash and ₱85 on a card; one blended number
    // would over-collect on one and lose money on the other.
    const org = (reg.organizations as unknown as
      (FeeTerms & { fee_mode: string }) | null) ?? null;
    let chargeAmount = reg.total_amount;

    if (org?.fee_mode === "pass_on") {
      const { data: rateRows } = await db.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: pmMethod, p_scope: "local",
        p_at: new Date().toISOString(),
      });
      const rate = (rateRows as ProcessorRate[] | null)?.[0] ?? null;
      if (!rate) {
        // Pass-on mode CANNOT proceed without a rate: there is no honest amount
        // to charge. Absorb mode would be unaffected, which is why this refuses
        // here rather than globally.
        console.error(`[payment-session] no processor rate for method=${pmMethod} — pass-on org ${reg.event_id}`);
        return json({ error: "rate_card_missing" }, 503);
      }
      const platformFee = computeFee(reg.total_amount, org);
      const b = passOnBreakdown(reg.total_amount, platformFee, rate);
      chargeAmount = b.total;
      lineItems.push({ name: "Race Pace service fee", amount: b.platformFee });
      lineItems.push({ name: "Payment processing", amount: b.processorFee });
    }
```

Finally, change the `createCheckout` call's `amount` from `reg.total_amount` to `chargeAmount`:

```ts
    const checkout = await provider.createCheckout({
      registrationId: reg.id, amount: chargeAmount, description: category?.label ?? "Race registration",
      returnUrl, methods: [pmMethod], lineItems, billing,
    });
```

- [ ] **Step 6: Verify the function still serves**

Run:
```bash
pnpm exec supabase functions serve &
pnpm test -- supabase/tests/backend.test.ts
```
Expected: PASS — existing absorb-mode orgs are unaffected, since `fee_mode` defaults to `absorb`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/processorFee.ts supabase/functions/payment-session/index.ts supabase/tests/processor-fee.test.ts
git commit -m "feat(checkout): gross up the pass-on surcharge per payment method"
```

---

## Task 7: The refund rule

**Files:**
- Create: `supabase/migrations/20260811094000_refund_net_to_org.sql`
- Modify: `supabase/functions/_shared/refund.ts`
- Test: `supabase/tests/refund-net-to-org.test.ts`

**Interfaces:**
- Consumes: Task 1 columns
- Produces: `refund_registration_tx(p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb, p_refunded_amount int, p_retained_net int)` — note `p_retained_fee` is GONE

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/refund-net-to-org.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** A confirmed ₱2,000 GCash entry: RP ₱60, PayMongo ₱30, organizer ₱1,910. */
async function paidEntry(tag: string, refundPolicy = "full", refundFee = 0) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  const org = (await s.from("organizations").insert({
    name: "Refund Org", slug: stamp,
    commission_type: "percent", commission_rate: 0.03,
    refund_policy: refundPolicy, refund_fee_cents: refundFee,
  }).select().single()).data!;
  const ev = (await s.from("events").insert({
    org_id: org.id, name: "Refund Race", status: "published",
  }).select().single()).data!;
  const cat = (await s.from("categories").insert({
    org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
    base_price: 200000, slots_total: 100, slots_taken: 1,
  }).select().single()).data!;
  const user = (await s.auth.admin.createUser({
    email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
  })).data.user!;
  const reg = (await s.from("registrations").insert({
    org_id: org.id, event_id: ev.id, category_id: cat.id,
    user_id: user.id, total_amount: 200000, status: "paid",
  }).select().single()).data!;
  await s.from("payments").insert({
    org_id: org.id, registration_id: reg.id, amount: 200000, status: "paid", method: "gcash",
    platform_fee: 6000, processor_fee_cents: 3000, processor_fee_source: "actual",
    net_to_org: 191000,
  });
  return {
    s, org, reg, cat,
    cleanup: async () => {
      await s.from("organizations").delete().eq("id", org.id);
      await s.auth.admin.deleteUser(user.id);
    },
  };
}

describe("refund_registration_tx under the net_to_org rule", () => {
  it("FULL refund: returns exactly net_to_org and preserves the clawback figures", async () => {
    const f = await paidEntry("rfull");
    try {
      const { data } = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: "test",
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });
      expect(data).toBe("refunded");

      const pay = (await f.s.from("payments")
        .select("amount,platform_fee,processor_fee_cents,net_to_org,refunded_amount,status")
        .eq("registration_id", f.reg.id).single()).data!;

      // The runner got exactly what the organizer would have been paid.
      expect(pay.refunded_amount).toBe(191000);
      // Amount, commission and processor fee are IMMUTABLE — payout_open_statement
      // reads net_to_org off refunded rows to size a clawback.
      expect(pay).toMatchObject({
        amount: 200000, platform_fee: 6000, processor_fee_cents: 3000,
        net_to_org: 191000, status: "refunded",
      });

      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("refunded");
      const cat = (await f.s.from("categories").select("slots_taken").eq("id", f.cat.id).single()).data!;
      expect(cat.slots_taken).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("PARTIAL refund: the four-way split balances exactly and amount is NOT rewritten", async () => {
    const f = await paidEntry("rpart", "flat_fee", 30000);
    try {
      // Organizer retains ₱300 of their ₱1,910; runner gets ₱1,610.
      const { data } = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: "test",
        p_provider_refund: {}, p_refunded_amount: 161000, p_retained_net: 30000,
      });
      expect(data).toBe("partially_refunded");

      const pay = (await f.s.from("payments")
        .select("amount,platform_fee,processor_fee_cents,net_to_org,refunded_amount,status")
        .eq("registration_id", f.reg.id).single()).data!;

      expect(pay).toMatchObject({
        amount: 200000,          // NOT rewritten to the retained figure
        platform_fee: 6000,      // already earned — never re-struck
        processor_fee_cents: 3000,
        net_to_org: 30000,       // the organizer's retention
        refunded_amount: 161000,
        status: "partially_refunded",
      });

      // runner + organizer + Race Pace + PayMongo === what the runner paid
      expect(pay.refunded_amount + pay.net_to_org + pay.platform_fee + pay.processor_fee_cents)
        .toBe(pay.amount);

      // The entry survives: the runner keeps their place.
      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("paid");
      const cat = (await f.s.from("categories").select("slots_taken").eq("id", f.cat.id).single()).data!;
      expect(cat.slots_taken).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("is idempotent — a second full refund is a no-op", async () => {
    const f = await paidEntry("ridem");
    try {
      await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });
      const { data } = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });
      expect(data).toBe("already");
    } finally {
      await f.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/refund-net-to-org.test.ts`
Expected: FAIL — the 6-arg signature without `p_retained_fee` does not exist

- [ ] **Step 3: Dump the CURRENT function body**

Same rule as Task 5, same reason: `refund_registration_tx` was last rewritten by `20260808140000_money_txn_audit.sql`, whose header warns explicitly against reconstructing it from migration files.

```bash
pnpm exec supabase db query --linked "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'refund_registration_tx';"
```

Note in particular its `insert into public.registration_audit (registration_id, org_id, event_id, action, detail, actor_id, actor_role)` — the audit table is `registration_audit`, and both the partial and full branches must keep writing to it with the `action` values already in use.

- [ ] **Step 4: Write the migration around that body**

Create `supabase/migrations/20260811094000_refund_net_to_org.sql`. Take the dumped body and make exactly these edits:

1. Drop `p_retained_fee` from the signature.
2. Replace `v_amount` (which held `payments.amount`) with `v_net` holding `payments.net_to_org`, and key the partial/full decision on it.
3. Add the `refund_exceeds_net_to_org` guard.
4. In the partial branch, remove the `amount = v_amount - p_refunded_amount` and `platform_fee = p_retained_fee` assignments and the `'original_amount'` key. Keep everything else, including the `registration_audit` insert.
5. Leave the full branch's payments UPDATE, the `slots_taken` decrement and both audit inserts untouched.

The result should read as below — reconcile it against the dump before applying, and prefer the dump wherever they differ on anything other than the five edits above:

```sql
-- The refund rule. Design 2026-08-11 §6.
--
-- THE RUNNER IS REFUNDED EXACTLY WHAT THE ORGANIZER WOULD HAVE BEEN PAID.
--
-- That is not a coincidence: both quantities are
-- `amount - platform_fee - processor_fee_cents`, so `refund == net_to_org`
-- holds by definition. It is what lets the existing clawback — which already
-- reads net_to_org off refunded rows — keep working with no change.
--
-- This SUPERSEDES 2026-08-06 §5, which returned the commission on a refund so
-- neither party kept anything. Race Pace's commission is now an earned service
-- fee, retained. PayMongo does not return its fee under any circumstances.
--
-- The 'retained amount is a smaller sale' rule goes with it: Race Pace has
-- already kept its full commission, so re-striking commission on the organizer's
-- retention would charge twice for one sale. p_retained_fee is therefore GONE
-- rather than defaulted — a caller still passing it is a caller that has not
-- been updated, and should fail loudly rather than silently double-charge.
drop function if exists public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int);
drop function if exists public.refund_registration_tx(uuid, uuid, text, jsonb);

create or replace function public.refund_registration_tx(
  p_registration_id uuid,
  p_refunded_by     uuid,
  p_note            text,
  p_provider_refund jsonb,
  p_refunded_amount int,
  p_retained_net    int default 0
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   public.registration_status;
  v_category uuid;
  v_org      uuid;
  v_event    uuid;
  v_raw      jsonb;
  v_net      int;
  v_partial  boolean;
begin
  select r.status, r.category_id, r.org_id, r.event_id
    into v_status, v_category, v_org, v_event
    from public.registrations r where r.id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  select p.net_to_org, p.raw into v_net, v_raw
    from public.payments p where p.registration_id = p_registration_id;

  -- Nothing can refund more than the organizer received.
  if p_refunded_amount > v_net then
    raise exception 'refund_exceeds_net_to_org: % > %', p_refunded_amount, v_net
      using errcode = '22003';
  end if;

  v_partial := p_refunded_amount < v_net;

  if v_partial then
    -- The entry SURVIVES: the runner keeps their place, so the registration
    -- stays 'paid' and the slot stays taken.
    --
    -- `amount` is NOT rewritten. The old version overwrote it with the retained
    -- figure and stashed the original in raw.original_amount, which under the
    -- three-party ledger would permanently break
    -- `amount - processor_fee_cents = the provider's net_amount`.
    -- platform_fee is untouched for the same reason: it was earned at capture.
    update public.payments
       set status          = 'partially_refunded',
           refunded_amount = p_refunded_amount,
           net_to_org      = p_retained_net,
           raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                   'refunded_at', now(), 'refunded_by', p_refunded_by,
                   'note', p_note, 'partial', true,
                   'provider_refund', p_provider_refund)
     where registration_id = p_registration_id;

    -- Keep whatever the dumped body wrote here, verbatim.
    insert into public.registration_audit
      (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
    values (p_registration_id, v_org, v_event, 'refunded',
            jsonb_build_object('amount', p_refunded_amount, 'note', p_note, 'partial', true),
            p_refunded_by, 'admin');

    return 'partially_refunded';
  end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;

  -- A fully refunded row KEEPS amount / platform_fee / processor_fee_cents /
  -- net_to_org. Load-bearing: payout_open_statement reads net_to_org off
  -- refunded rows to size a clawback.
  update public.payments
     set status = 'refunded',
         refunded_amount = p_refunded_amount,
         raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(), 'refunded_by', p_refunded_by,
                 'note', p_note, 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;

  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category;

  -- Keep whatever the dumped body wrote here, verbatim.
  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
  values (p_registration_id, v_org, v_event, 'refunded',
          jsonb_build_object('amount', p_refunded_amount, 'note', p_note),
          p_refunded_by, 'admin');

  return 'refunded';
end;
$$;

revoke all on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int) from public;
grant execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int) to service_role;
```

> **Before running:** the audit table is `registration_audit`, and its `action` column is constrained. `20260808150000_partial_refund_audit.sql` added the partial-refund path; take the exact `action` value and `detail` shape from the Step 3 dump rather than from the sketch above. A new `action` string would violate the check constraint and fail at the first refund, not at apply time.

- [ ] **Step 5: Apply and run tests**

Run:
```bash
pnpm exec supabase db reset && pnpm test -- supabase/tests/refund-net-to-org.test.ts supabase/tests/registration-audit.test.ts
```
Expected: PASS — the refund invariants, plus `registration-audit` proving both branches still write their audit rows.

- [ ] **Step 6: Update the Edge Function caller**

In `supabase/functions/_shared/refund.ts`:

Delete the now-unused import — `computeFee` is no longer called here:

```ts
import { getPaymentProviderByName } from "./payments.ts";
```

(remove `import { computeFee, type FeeTerms } from "./fee.ts";` and change the `org` cast below accordingly)

Change the payment select to fetch `net_to_org` and drop the commission columns:

```ts
  const { data: pay } = await db
    .from("payments")
    .select(
      "provider,provider_ref,amount,net_to_org,raw," +
      "organizations!inner(refund_policy,refund_fee_cents)",
    )
    .eq("registration_id", reg.id).single();
  if (!pay) return { ok: false, error: "payment_not_found", status: 404 };

  const org = pay.organizations as unknown as
    { refund_policy: string; refund_fee_cents: number };
```

Then replace the retention block. Find:

```ts
  const retained = org.refund_policy === "flat_fee"
    ? Math.min(org.refund_fee_cents, pay.amount)
    : 0;
  const refundAmount = pay.amount - retained;
  const retainedFee = computeFee(retained, org);
  const retainedNet = retained - retainedFee;
```

Replace with:

```ts
  // The runner is refunded exactly what the organizer would have been paid.
  // Race Pace's commission is an earned service fee and is retained; PayMongo
  // does not return its fee under any circumstances. Both are already excluded
  // from net_to_org, so this one line IS the policy.
  //
  // Clamped to net_to_org rather than to amount: an organizer cannot retain
  // money they were never going to receive.
  const retained = org.refund_policy === "flat_fee"
    ? Math.min(org.refund_fee_cents, pay.net_to_org)
    : 0;
  const refundAmount = pay.net_to_org - retained;
  // No computeFee here. Race Pace already kept its full commission at capture,
  // so re-striking it on the organizer's retention would charge twice.
  const retainedNet = retained;
```

Update the parked-pending payload — drop `retained_fee`:

```ts
        refunded_amount: refundAmount, retained_net: retainedNet,
```

And the RPC call:

```ts
  const { data: result, error: rpcErr } = await db.rpc("refund_registration_tx", {
    p_registration_id: reg.id, p_refunded_by: refundedBy, p_note: note,
    p_provider_refund: refund.raw as Record<string, unknown>,
    p_refunded_amount: refundAmount, p_retained_net: retainedNet,
  });
```

- [ ] **Step 7: Update the webhook's parked-refund path**

`supabase/functions/payments-webhook/index.ts:59` passes `p_retained_fee: parked.retained_fee ?? 0`. Remove that line and ensure the call reads:

```ts
          p_refunded_amount: parked.refunded_amount,
          p_retained_net: parked.retained_net ?? 0,
```

- [ ] **Step 8: Run the refund suites**

Run:
```bash
pnpm exec supabase functions serve &
pnpm test -- supabase/tests/refund-net-to-org.test.ts supabase/tests/refund-policy.test.ts supabase/tests/commission-refund-policy.test.ts
```
Expected: PASS. `refund-policy.test.ts` and `commission-refund-policy.test.ts` encode the OLD rule (commission returned, retention re-struck) and **will fail**. Update their expectations to the new rule — the amounts change, the structure does not. Do not delete the tests.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260811094000_refund_net_to_org.sql supabase/functions/_shared/refund.ts supabase/functions/payments-webhook/index.ts supabase/tests/refund-net-to-org.test.ts supabase/tests/refund-policy.test.ts supabase/tests/commission-refund-policy.test.ts
git commit -m "feat(refunds): refund net_to_org, retain commission as an earned fee"
```

---

## Task 8: Payout statement arithmetic

**Files:**
- Create: `supabase/migrations/20260811095000_payout_open_statement_v2.sql`
- Test: `supabase/tests/payout-statements-v2.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 7
- Produces: `payout_open_statement(p_event_id uuid) returns uuid` (unchanged signature, new arithmetic); `payout_unreconciled_count(p_event_id uuid) returns integer`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/payout-statements-v2.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function signedInAs(email: string, password = "password123"): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** Org + event + N paid ₱2,000 GCash entries (RP ₱60, PayMongo ₱30, org ₱1,910),
 *  plus a super admin who can open and settle statements. */
async function fixture(tag: string, count: number) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  const org = (await s.from("organizations").insert({
    name: "PayoutV2 Org", slug: stamp,
    commission_type: "percent", commission_rate: 0.03,
  }).select().single()).data!;
  const ev = (await s.from("events").insert({
    org_id: org.id, name: "PayoutV2 Race", status: "draft",
  }).select().single()).data!;
  const cat = (await s.from("categories").insert({
    org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
    base_price: 200000, slots_total: 100, slots_taken: count,
  }).select().single()).data!;

  const adminEmail = `pv2_${stamp}@test.dev`;
  const admin = (await s.auth.admin.createUser({
    email: adminEmail, password: "password123", email_confirm: true,
  })).data.user!;
  await s.from("user_roles").insert({ user_id: admin.id, role: "super_admin", org_id: null });

  const users: string[] = [];
  const regIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const u = (await s.auth.admin.createUser({
      email: `pv2_r${i}_${stamp}@test.dev`, password: "password123", email_confirm: true,
    })).data.user!;
    users.push(u.id);
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id,
      user_id: u.id, total_amount: 200000, status: "paid",
    }).select().single()).data!;
    regIds.push(reg.id);
    await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 200000, status: "paid", method: "gcash",
      platform_fee: 6000, processor_fee_cents: 3000, processor_fee_source: "actual",
      net_to_org: 191000,
    });
  }

  return {
    s, org, ev, regIds, adminEmail,
    cleanup: async () => {
      await s.from("organizations").delete().eq("id", org.id);
      for (const id of [...users, admin.id]) await s.auth.admin.deleteUser(id);
    },
  };
}

describe("payout_open_statement v2", () => {
  it("sums net_to_org and breaks the total down into gross, commission and processing", async () => {
    const f = await fixture("pv2a", 3);
    try {
      const admin = await signedInAs(f.adminEmail);
      const { data: id, error } = await admin.rpc("payout_open_statement", { p_event_id: f.ev.id });
      expect(error).toBeNull();

      const st = (await f.s.from("payout_statements")
        .select("gross_cents,commission_cents,processing_cents,refunds_cents,net_owed_cents")
        .eq("id", id).single()).data!;

      expect(st).toMatchObject({
        gross_cents: 600000,       // 3 x ₱2,000
        commission_cents: 18000,   // 3 x ₱60
        processing_cents: 9000,    // 3 x ₱30
        refunds_cents: 0,
        net_owed_cents: 573000,    // 3 x ₱1,910
      });
      // The breakdown must explain the total, not merely accompany it.
      expect(st.gross_cents - st.commission_cents - st.processing_cents).toBe(st.net_owed_cents);
    } finally {
      await f.cleanup();
    }
  });

  it("subtracts an already-settled entry's net_to_org when it is later refunded", async () => {
    const f = await fixture("pv2b", 2);
    try {
      const admin = await signedInAs(f.adminEmail);
      const first = (await admin.rpc("payout_open_statement", { p_event_id: f.ev.id })).data;
      await admin.rpc("payout_mark_paid", {
        p_statement_id: first, p_reference: "ref-1", p_note: null,
      });

      // One of the two settled entries is refunded afterwards.
      await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });

      const second = (await admin.rpc("payout_open_statement", { p_event_id: f.ev.id })).data;
      const st = (await f.s.from("payout_statements")
        .select("net_owed_cents,refunds_cents").eq("id", second).single()).data!;

      // No new sales, one clawback: the organizer owes ₱1,910 back.
      expect(st.refunds_cents).toBe(191000);
      expect(st.net_owed_cents).toBe(-191000);
    } finally {
      await f.cleanup();
    }
  });

  it("counts payments whose processing fee is still an estimate", async () => {
    const f = await fixture("pv2c", 2);
    try {
      await f.s.from("payments").update({ processor_fee_source: "predicted" })
        .eq("registration_id", f.regIds[0]);
      const admin = await signedInAs(f.adminEmail);
      const { data } = await admin.rpc("payout_unreconciled_count", { p_event_id: f.ev.id });
      expect(data).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/payout-statements-v2.test.ts`
Expected: FAIL — `processing_cents` is 0 and `payout_unreconciled_count` does not exist

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811095000_payout_open_statement_v2.sql`:

```sql
-- Statement arithmetic on the three-party ledger. Design 2026-08-11 §7.
--
-- The old version computed `gross - commission - refunds`. With a processor line
-- that arithmetic is wrong, and reconstructing it as
-- `gross - commission - processing - refunds` would just add a fourth number
-- that has to agree with the other three.
--
-- Instead: net_to_org is ALREADY the authoritative per-payment answer, written
-- at confirmation. Sum it. Gross, commission and processing become presentational
-- columns that EXPLAIN the total rather than compute it. Two figures that must
-- agree cannot disagree when only one of them decides anything.

create or replace function public.payout_open_statement(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_gross   bigint;
  v_comm    bigint;
  v_proc    bigint;
  v_earn    bigint;
  v_refunds bigint;
  v_id      uuid;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select e.org_id into v_org from public.events e where e.id = p_event_id;
  if v_org is null then raise exception 'event_not_found'; end if;

  -- Amounts key on the STAMP, not on status alone:
  --   earn     = unsettled money we now owe   (paid/partial, no statement stamp)
  --   clawback = already-transferred money    (refunded, HAS a statement stamp,
  --              since refunded                no clawback stamp)
  -- A refund lands in exactly one of those, or neither. Never both.
  select
    coalesce(sum(p.amount)              filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    coalesce(sum(p.platform_fee)        filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    -- 'historical' rows are excluded: the platform absorbed processing on those,
    -- so counting them here would deduct from the organizer a cost they never bore.
    coalesce(sum(p.processor_fee_cents) filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null
                                                  and p.processor_fee_source in ('actual','predicted')), 0),
    coalesce(sum(p.net_to_org)          filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    coalesce(sum(p.net_to_org)          filter (where p.status = 'refunded'
                                                  and p.payout_statement_id is not null
                                                  and p.payout_clawback_id is null), 0)
  into v_gross, v_comm, v_proc, v_earn, v_refunds
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id;

  insert into public.payout_statements
    (org_id, event_id, gross_cents, commission_cents, processing_cents,
     refunds_cents, net_owed_cents, opened_by)
  values
    (v_org, p_event_id, v_gross, v_comm, v_proc,
     v_refunds, v_earn - v_refunds, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- How many of this event's payments still carry an ESTIMATED processing fee.
--
-- Surfaced as a warning rather than a block. Blocking would strand a payout
-- behind a provider outage; warning shows the risk without creating a new way
-- to be stuck.
create or replace function public.payout_unreconciled_count(p_event_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id
    and p.status in ('paid','partially_refunded')
    and p.payout_statement_id is null
    and p.processor_fee_source = 'predicted';
$$;

revoke all on function public.payout_open_statement(uuid)      from public;
revoke all on function public.payout_unreconciled_count(uuid)  from public;
grant execute on function public.payout_open_statement(uuid)     to authenticated;
grant execute on function public.payout_unreconciled_count(uuid) to authenticated;
```

- [ ] **Step 4: Apply and run tests**

Run:
```bash
pnpm exec supabase db reset && pnpm test -- supabase/tests/payout-statements-v2.test.ts supabase/tests/payout-statements.test.ts
```
Expected: The v2 suite PASSES (3 tests). The original `payout-statements.test.ts` asserts `net_owed = gross - commission - refunds` with no processor line; update its fixtures to set `processor_fee_cents` and its expectations to match. Do not delete it — it covers the two-stamp double-payment guard, which this change must not break.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811095000_payout_open_statement_v2.sql supabase/tests/payout-statements-v2.test.ts supabase/tests/payout-statements.test.ts
git commit -m "feat(payouts): sum net_to_org and break out processing costs"
```

---

## Task 9: Backfill

**Files:**
- Create: `supabase/migrations/20260811092000_backfill_processor_fees.sql`
- Test: `supabase/tests/processor-fee-backfill.test.ts`

**Interfaces:**
- Consumes: Task 1 columns
- Produces: nothing (one-shot data migration)

> **Ordering note:** this migration's timestamp (`092000`) places it before `093000`/`094000`/`095000` but after `091000`. It is written last because it is easiest to reason about once the rest exists; its filename must still be `20260811092000_*` so `db reset` applies it in the right order.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/processor-fee-backfill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** The shape _shared/paymongo.ts stores in payments.raw. */
const rawWithFee = (amount: number, fee: number) => ({
  data: { attributes: { payments: [
    { id: "pay_1", attributes: { status: "paid", amount, fee, net_amount: amount - fee } },
  ] } },
});

describe("processor fee backfill", () => {
  it("recovers the fee from raw and marks it historical WITHOUT repricing net_to_org", async () => {
    const s = svc();
    const stamp = `bf-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Backfill Org", slug: stamp, commission_type: "percent", commission_rate: 0.10,
    }).select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Backfill Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
        base_price: 200000, slots_total: 10, slots_taken: 1,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 200000, status: "paid",
      }).select().single()).data!;

      // A pre-migration row: 10% commission, platform absorbed the ₱30 processing.
      await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 200000, status: "paid", method: "gcash",
        platform_fee: 20000, net_to_org: 180000,
        processor_fee_cents: 0, processor_fee_source: "none",
        raw: rawWithFee(200000, 3000),
      });

      // Re-run the backfill statement (idempotent by design).
      await s.rpc("backfill_processor_fees_once");

      const pay = (await s.from("payments")
        .select("processor_fee_cents,processor_fee_source,net_to_org,platform_fee,amount")
        .eq("registration_id", reg.id).single()).data!;

      expect(pay.processor_fee_cents).toBe(3000);
      expect(pay.processor_fee_source).toBe("historical");
      // THE POINT OF THE TEST: settled money is not repriced.
      expect(pay.net_to_org).toBe(180000);
      expect(pay.platform_fee).toBe(20000);
      expect(pay.amount).toBe(200000);
      // A historical row deliberately violates the ledger invariant.
      expect(pay.amount - pay.processor_fee_cents - pay.platform_fee).not.toBe(pay.net_to_org);

      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });

  it("leaves a row with no recoverable fee as 'none'", async () => {
    const s = svc();
    const stamp = `bfn-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "BF None Org", slug: stamp })
      .select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "BF None Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "5k", label: "5K",
        base_price: 100000, slots_total: 10, slots_taken: 1,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 100000, status: "paid",
      }).select().single()).data!;
      await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 100000, status: "paid",
        platform_fee: 10000, net_to_org: 90000, raw: { fake: true },
      });

      await s.rpc("backfill_processor_fees_once");

      const pay = (await s.from("payments")
        .select("processor_fee_cents,processor_fee_source").eq("registration_id", reg.id).single()).data!;
      expect(pay).toMatchObject({ processor_fee_cents: 0, processor_fee_source: "none" });

      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-fee-backfill.test.ts`
Expected: FAIL — `Could not find the function public.backfill_processor_fees_once`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811092000_backfill_processor_fees.sql`:

```sql
-- Backfill. Design 2026-08-11 §10.
--
-- _shared/paymongo.ts has been storing PayMongo's entire payload in payments.raw
-- all along, and that payload carries the fee. So the real processing cost of
-- every historical payment is already in this database, unread.
--
-- HISTORICAL net_to_org IS NOT TOUCHED. Those entries were settled under terms
-- where Race Pace absorbed processing, and some of that money has already been
-- transferred. Recomputing it would invent debts against organizers for money
-- they were correctly paid.
--
-- That is why 'historical' is a distinct source rather than 'actual': the fee is
-- real, but it was NOT deducted from the organizer, so the ledger invariant
-- deliberately does not hold for these rows. A row claiming 'actual' would be a
-- lie the payout arithmetic would act on.

create or replace function public.backfill_processor_fees_once()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidate as (
    select
      p.registration_id,
      -- The PAID payment, matching pmFeeFromAttributes. A session can carry an
      -- abandoned attempt followed by a successful one, and element 0 would
      -- report the fee on the attempt the runner did not complete.
      (
        select elem
        from jsonb_array_elements(p.raw #> '{data,attributes,payments}') elem
        where elem #>> '{attributes,status}' = 'paid'
        limit 1
      ) as pay_elem
    from public.payments p
    where p.processor_fee_source = 'none'
      and jsonb_typeof(p.raw #> '{data,attributes,payments}') = 'array'
  )
  update public.payments p
     set processor_fee_cents  = (c.pay_elem #>> '{attributes,fee}')::integer,
         processor_fee_source = 'historical'
    from candidate c
   where p.registration_id = c.registration_id
     and c.pay_elem is not null
     and (c.pay_elem #>> '{attributes,fee}') ~ '^[0-9]+$';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.backfill_processor_fees_once() from public;
grant execute on function public.backfill_processor_fees_once() to service_role;

select public.backfill_processor_fees_once();
```

- [ ] **Step 4: Apply and run tests**

Run:
```bash
pnpm exec supabase db reset && pnpm test -- supabase/tests/processor-fee-backfill.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Verify the whole DB suite is green**

Run: `pnpm test`
Expected: PASS across all `supabase/tests/*.test.ts`. Fix any suite whose money expectations the earlier tasks changed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260811092000_backfill_processor_fees.sql supabase/tests/processor-fee-backfill.test.ts
git commit -m "feat(db): backfill historical processor fees without repricing them"
```

---

## Task 10: Drift detection

**Files:**
- Create: `supabase/migrations/20260811096000_processor_rate_drift.sql`
- Test: `supabase/tests/processor-rates.test.ts` (append)

**Interfaces:**
- Consumes: Tasks 1, 2, 5
- Produces: view `processor_rate_drift_v` with columns `method, scope, sample_size, disagreeing, median_implied_bps, card_bps, delta_cents, drifting boolean`

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/processor-rates.test.ts`:

```ts
describe("processor_rate_drift_v", () => {
  it("flags a method whose actual fees consistently exceed the rate card", async () => {
    const s = svc();
    const stamp = `drift-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Drift Org", slug: stamp, commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    const users: string[] = [];
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Drift Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
        base_price: 200000, slots_total: 100, slots_taken: 0,
      }).select().single()).data!;

      // 14 card payments that each cost 3.80% + ₱15 while the card says 3.50%.
      for (let i = 0; i < 14; i++) {
        const u = (await s.auth.admin.createUser({
          email: `drift${i}_${stamp}@test.dev`, password: "password123", email_confirm: true,
        })).data.user!;
        users.push(u.id);
        const reg = (await s.from("registrations").insert({
          org_id: org.id, event_id: ev.id, category_id: cat.id,
          user_id: u.id, total_amount: 200000, status: "paid",
        }).select().single()).data!;
        await s.from("payments").insert({
          org_id: org.id, registration_id: reg.id, amount: 200000, status: "paid", method: "card",
          platform_fee: 6000, net_to_org: 184900,
          processor_fee_cents: 9100,            // 3.8% of ₱2,000 + ₱15
          processor_fee_predicted_cents: 8500,  // 3.5% + ₱15
          processor_fee_source: "actual",
        });
      }

      const { data } = await s.from("processor_rate_drift_v")
        .select("*").eq("method", "card").eq("scope", "local").single();

      expect(data!.sample_size).toBeGreaterThanOrEqual(14);
      expect(data!.card_bps).toBe(350);
      expect(data!.median_implied_bps).toBe(380);
      expect(data!.drifting).toBe(true);
      // 14 x ₱6.00 under-collected.
      expect(data!.delta_cents).toBe(8400);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
      for (const id of users) await s.auth.admin.deleteUser(id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- supabase/tests/processor-rates.test.ts`
Expected: FAIL — `relation "public.processor_rate_drift_v" does not exist`

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260811096000_processor_rate_drift.sql`:

```sql
-- Drift detection. Design 2026-08-11 §5.
--
-- The rate card touches exactly two things: the pass-on surcharge and estimates
-- shown to humans. It NEVER touches the ledger — so drift cannot make a report
-- wrong. It can only make a pass-on charge under- or over-collect.
--
-- Which means drift is measurable from the platform's own money: every
-- confirmation stores predicted alongside actual. A rate change is detected
-- within hours from real transactions, instead of depending on somebody reading
-- the provider's pricing page.

create or replace view processor_rate_drift_v
with (security_invoker = true)
as
with recent as (
  select
    p.method,
    'local'::text as scope,
    p.processor_fee_cents,
    p.processor_fee_predicted_cents,
    p.amount,
    row_number() over (partition by p.method order by p.created_at desc) as rn
  from public.payments p
  where p.processor_fee_source = 'actual'
    and p.processor_fee_predicted_cents is not null
    and p.amount > 0
),
sample as (
  select r.*, c.percent_bps as card_bps, c.fixed_cents as card_fixed
  from recent r
  join public.processor_rates c
    on c.provider = 'paymongo' and c.method = r.method and c.scope = r.scope
   and c.effective_to is null
  where r.rn <= 20
)
select
  s.method,
  s.scope,
  count(*)::integer as sample_size,
  count(*) filter (
    where abs(s.processor_fee_cents - s.processor_fee_predicted_cents) > 100
  )::integer as disagreeing,
  -- Solve the rate back out of what was actually charged. Median rather than
  -- mean so one unusual payment cannot move the reported figure.
  (percentile_cont(0.5) within group (
    order by ((s.processor_fee_cents - s.card_fixed)::numeric * 10000) / s.amount
  ))::integer as median_implied_bps,
  max(s.card_bps)::integer as card_bps,
  sum(s.processor_fee_cents - s.processor_fee_predicted_cents)::bigint as delta_cents,
  -- Flagged when at least 80% of the sample disagrees by more than ₱1. A single
  -- outlier is not a pricing change; fourteen of fourteen is.
  (count(*) >= 5 and count(*) filter (
    where abs(s.processor_fee_cents - s.processor_fee_predicted_cents) > 100
  ) >= (count(*) * 0.8)) as drifting
from sample s
group by s.method, s.scope;

comment on view processor_rate_drift_v is
  'Predicted vs actual processing fees over the last 20 payments per method. '
  'A positive delta_cents means the platform UNDER-collected in pass-on mode and '
  'absorbed the difference — the organizer always receives what was promised.';

-- security_invoker means the caller's RLS on `payments` applies, so an org admin
-- sees drift computed from their own rows only and a super admin sees all of it.
grant select on processor_rate_drift_v to authenticated;
```

- [ ] **Step 4: Apply and run tests**

Run:
```bash
pnpm exec supabase db reset && pnpm test -- supabase/tests/processor-rates.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260811096000_processor_rate_drift.sql supabase/tests/processor-rates.test.ts
git commit -m "feat(db): detect processor rate drift from actual transactions"
```

---

## Task 11: Settlement CSV serialiser

**Files:**
- Create: `apps/web/lib/settlement-csv.ts`
- Create: `apps/web/lib/settlement-csv.test.ts`

**Interfaces:**
- Consumes: nothing (pure module)
- Produces:
  - `export type SettlementRow = { registration_id: string; runner_name: string; category: string; paid_at: string | null; method: string | null; gross_paid: number; rp_commission: number; processing_fee: number; net_to_org: number; status: string; refunded_amount: number; refunded_at: string | null }`
  - `export function settlementCsv(rows: SettlementRow[]): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/settlement-csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { settlementCsv, type SettlementRow } from "./settlement-csv";

const row = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  registration_id: "r1", runner_name: "Ana Cruz", category: "40K",
  paid_at: "2026-08-01T02:00:00Z", method: "gcash",
  gross_paid: 200000, rp_commission: 6000, processing_fee: 3000, net_to_org: 191000,
  status: "paid", refunded_amount: 0, refunded_at: null, ...over,
});

describe("settlementCsv", () => {
  it("emits a header row followed by one row per registration", () => {
    const lines = settlementCsv([row()]).split("\n");
    expect(lines[0]).toBe(
      "registration_id,runner_name,category,paid_at,method,gross_paid,rp_commission,processing_fee,net_to_org,status,refunded_amount,refunded_at",
    );
    expect(lines).toHaveLength(2);
  });

  it("writes money in PESOS with two decimals, not centavos", () => {
    // A spreadsheet column of raw centavos gets read as pesos by a human and is
    // wrong by a factor of 100 — in a document about money owed.
    expect(settlementCsv([row()]).split("\n")[1]).toContain("2000.00,60.00,30.00,1910.00");
  });

  it("quotes and escapes a name containing a comma or a quote", () => {
    const csv = settlementCsv([row({ runner_name: 'Cruz, Ana "Bing"' })]);
    expect(csv.split("\n")[1]).toContain('"Cruz, Ana ""Bing"""');
  });

  it("renders a null paid_at and method as empty fields, not the string null", () => {
    const line = settlementCsv([row({ paid_at: null, method: null })]).split("\n")[1];
    expect(line).toBe("r1,Ana Cruz,40K,,,2000.00,60.00,30.00,1910.00,paid,0.00,");
  });

  it("emits only the header for an empty result", () => {
    expect(settlementCsv([]).split("\n")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- lib/settlement-csv.test.ts`
Expected: FAIL — cannot resolve `./settlement-csv`

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/settlement-csv.ts`:

```ts
/** One registration's money, as it appears in the settlement export. */
export type SettlementRow = {
  registration_id: string;
  runner_name: string;
  category: string;
  paid_at: string | null;
  method: string | null;
  /** All amounts are CENTAVOS in, PESOS out — see `peso` below. */
  gross_paid: number;
  rp_commission: number;
  processing_fee: number;
  net_to_org: number;
  status: string;
  refunded_amount: number;
  refunded_at: string | null;
};

const HEADER = [
  "registration_id", "runner_name", "category", "paid_at", "method",
  "gross_paid", "rp_commission", "processing_fee", "net_to_org",
  "status", "refunded_amount", "refunded_at",
] as const;

/** RFC 4180: wrap in quotes when the value contains a comma, quote or newline,
 *  and double any embedded quote. A single unescaped comma in a runner's name
 *  shifts every money column one place left for that row. */
function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Centavos to a plain decimal string. Never a currency symbol or thousands
 *  separator — both make the column text rather than a number on import. */
function peso(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * The per-registration settlement export.
 *
 * Transaction-level ONLY. The summary lives on the page, where it can be
 * printed: a summary block above the header breaks every spreadsheet import,
 * and this file exists specifically to be opened in a spreadsheet.
 */
export function settlementCsv(rows: SettlementRow[]): string {
  const lines = [HEADER.join(",")];
  for (const r of rows) {
    lines.push([
      cell(r.registration_id),
      cell(r.runner_name),
      cell(r.category),
      cell(r.paid_at ?? ""),
      cell(r.method ?? ""),
      peso(r.gross_paid),
      peso(r.rp_commission),
      peso(r.processing_fee),
      peso(r.net_to_org),
      cell(r.status),
      peso(r.refunded_amount),
      cell(r.refunded_at ?? ""),
    ].join(","));
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- lib/settlement-csv.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/settlement-csv.ts apps/web/lib/settlement-csv.test.ts
git commit -m "feat(admin): add settlement CSV serialiser"
```

---

## Task 12: Organizer settlement view

**Files:**
- Create: `apps/web/lib/settlement-math.ts` (PURE — no server imports)
- Create: `apps/web/lib/settlement-math.test.ts`
- Create: `apps/web/lib/queries/settlement.ts` (server read model)
- Create: `apps/web/app/(admin)/events/[eventId]/settlement/page.tsx`
- Create: `apps/web/app/(admin)/events/[eventId]/settlement/export-button.tsx`
- Test: `supabase/tests/processor-fee-ledger.test.ts` (append the RLS isolation test)

> **Why two modules.** `settlementTotals` and `projectedRange` are pure arithmetic and must be unit-testable, but `lib/queries/settlement.ts` imports `@/lib/supabase/server` and therefore `next/headers`. A test importing the query module would drag that in, and the client `export-button.tsx` would drag it into the browser bundle — a build error, not a size regression. This mirrors the existing `lib/commission-terms.ts` (pure) / `lib/queries/commission.ts` (server, re-exports) split, and that file's header documents exactly why.

**Interfaces:**
- Consumes: `SettlementRow`, `settlementCsv` (Task 11); Task 1 columns
- Produces, from `lib/settlement-math.ts`:
  - `export type ProcessorRateLite = { percent_bps: number; fixed_cents: number }`
  - `export type SettlementTotals = { gross: number; commission: number; processing: number; refunds: number; net: number }`
  - `export function settlementTotals(rows: SettlementRow[]): SettlementTotals`
  - `export function projectedRange(paidCount: number, avgEntry: number, commissionCents: number, rates: { cheap: ProcessorRateLite; dear: ProcessorRateLite }): { low: number; high: number }`
- Produces, from `lib/queries/settlement.ts`:
  - `export type EventSettlement = { event_name: string; org_name: string; rows: SettlementRow[]; totals: SettlementTotals; feeMode: "absorb" | "pass_on"; projected: { low: number; high: number } | null; unreconciled: number }`
  - `export async function getEventSettlement(eventId: string): Promise<EventSettlement | null>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/settlement-math.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { projectedRange, settlementTotals } from "./settlement-math";
import type { SettlementRow } from "@/lib/settlement-csv";

const row = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  registration_id: "r", runner_name: "R", category: "40K",
  paid_at: "2026-08-01T02:00:00Z", method: "gcash",
  gross_paid: 200000, rp_commission: 6000, processing_fee: 3000, net_to_org: 191000,
  status: "paid", refunded_amount: 0, refunded_at: null, ...over,
});

describe("settlementTotals", () => {
  it("sums each column independently", () => {
    expect(settlementTotals([row(), row()])).toEqual({
      gross: 400000, commission: 12000, processing: 6000, refunds: 0, net: 382000,
    });
  });

  it("counts a refunded entry's payout as zero but keeps its refund visible", () => {
    const t = settlementTotals([
      row(),
      row({ status: "refunded", refunded_amount: 191000, net_to_org: 191000 }),
    ]);
    // The refunded row contributed nothing to the organizer.
    expect(t.net).toBe(191000);
    expect(t.refunds).toBe(191000);
  });

  it("returns zeroes for an event with no payments", () => {
    expect(settlementTotals([])).toEqual({
      gross: 0, commission: 0, processing: 0, refunds: 0, net: 0,
    });
  });
});

describe("projectedRange", () => {
  it("spans cheapest to dearest payment method", () => {
    // 500 x ₱2,000 at 3% commission: GCash 1.5%, card 3.5% + ₱15.
    const r = projectedRange(500, 200000, 6000, {
      cheap: { percent_bps: 150, fixed_cents: 0 },
      dear: { percent_bps: 350, fixed_cents: 1500 },
    });
    expect(r).toEqual({ low: 92750000, high: 95500000 });
  });

  it("collapses to a point when both rates are the same", () => {
    const r = projectedRange(10, 200000, 6000, {
      cheap: { percent_bps: 150, fixed_cents: 0 },
      dear: { percent_bps: 150, fixed_cents: 0 },
    });
    expect(r.low).toBe(r.high);
  });

  it("is zero for an event with no paid entries", () => {
    const r = projectedRange(0, 200000, 6000, {
      cheap: { percent_bps: 150, fixed_cents: 0 },
      dear: { percent_bps: 350, fixed_cents: 1500 },
    });
    expect(r).toEqual({ low: 0, high: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- lib/settlement-math.test.ts`
Expected: FAIL — cannot resolve `./settlement-math`

- [ ] **Step 3: Write the pure math module**

Create `apps/web/lib/settlement-math.ts`:

```ts
import type { SettlementRow } from "@/lib/settlement-csv";

/**
 * Settlement arithmetic, deliberately server-free.
 *
 * No `@/lib/supabase/server`, no `next/headers`, no imports beyond a type —
 * so unit tests and the client export button can both use it. The read model
 * in `lib/queries/settlement.ts` re-exports everything here, which keeps the
 * page's import list short without dragging server-only modules into the
 * browser bundle. Same split, and same reason, as `lib/commission-terms.ts`.
 */

export type ProcessorRateLite = { percent_bps: number; fixed_cents: number };

export type SettlementTotals = {
  gross: number; commission: number; processing: number; refunds: number; net: number;
};

/**
 * Column sums for the settlement summary.
 *
 * `net` counts only rows that still owe the organizer something. A fully
 * refunded row KEEPS its net_to_org — that is what lets the payout clawback
 * size itself — so summing the column blindly would report money owed for an
 * entry the organizer has already given back.
 */
export function settlementTotals(rows: SettlementRow[]): SettlementTotals {
  const t: SettlementTotals = { gross: 0, commission: 0, processing: 0, refunds: 0, net: 0 };
  for (const r of rows) {
    t.gross += r.gross_paid;
    t.commission += r.rp_commission;
    t.processing += r.processing_fee;
    t.refunds += r.refunded_amount;
    if (r.status !== "refunded") t.net += r.net_to_org;
  }
  return t;
}

/**
 * What the organizer will be paid, cheapest to dearest payment method.
 *
 * In absorb mode the organizer bears processing, so their net genuinely depends
 * on how runners choose to pay: a ₱2,000 entry costs ₱30 on GCash and ₱85 on a
 * card. Across 500 entries that is ₱27,500 they cannot forecast.
 *
 * Stating the range up front is the whole point. An organizer who discovers the
 * swing at settlement experiences it as an unexplained shortfall.
 */
export function projectedRange(
  paidCount: number,
  avgEntry: number,
  commissionCents: number,
  rates: { cheap: ProcessorRateLite; dear: ProcessorRateLite },
): { low: number; high: number } {
  if (paidCount <= 0) return { low: 0, high: 0 };
  const per = (r: ProcessorRateLite) =>
    avgEntry - commissionCents - (Math.round((avgEntry * r.percent_bps) / 10000) + r.fixed_cents);
  return { low: per(rates.dear) * paidCount, high: per(rates.cheap) * paidCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- lib/settlement-math.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the server read model**

Create `apps/web/lib/queries/settlement.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { SettlementRow } from "@/lib/settlement-csv";
import {
  settlementTotals, projectedRange,
  type ProcessorRateLite, type SettlementTotals,
} from "@/lib/settlement-math";

// Re-exported so the page has one import for the whole read model, while the
// pure half stays importable without pulling in next/headers. Same pattern as
// lib/queries/commission.ts.
export * from "@/lib/settlement-math";

export type EventSettlement = {
  event_name: string;
  org_name: string;
  rows: SettlementRow[];
  totals: SettlementTotals;
  feeMode: "absorb" | "pass_on";
  /** Only meaningful in absorb mode, where the organizer's net depends on how
   *  runners happen to pay. Null in pass-on mode, where it is a fixed figure. */
  projected: { low: number; high: number } | null;
  unreconciled: number;
};

const SELECT =
  "registration_id,amount,platform_fee,processor_fee_cents,processor_fee_source," +
  "net_to_org,status,refunded_amount,method,created_at," +
  "registrations!inner(event_id,categories(label),profiles(full_name,bib_name))";

/**
 * One event's settlement, org-scoped.
 *
 * No explicit org filter: `payments_read_org_admin` already scopes SELECT to the
 * caller's own organizations (and to everything for a super admin), and already
 * does it with `(select auth.uid())` + a sargable `org_id in (…)`. Adding a
 * second filter here would duplicate a rule that RLS enforces, and duplicated
 * authorization rules drift apart.
 */
export async function getEventSettlement(eventId: string): Promise<EventSettlement | null> {
  const supabase = await createClient();

  const { data: ev, error: evErr } = await supabase
    .from("events")
    .select("name,organizations(name,fee_mode,commission_type,commission_rate,commission_flat_cents)")
    .eq("id", eventId)
    .maybeSingle();
  if (evErr) throw evErr;
  if (!ev) return null;

  const [{ data: pays, error: payErr }, { data: rates }, { data: unrec }] = await Promise.all([
    supabase.from("payments").select(SELECT).eq("registrations.event_id", eventId),
    supabase.from("processor_rates")
      .select("method,scope,percent_bps,fixed_cents")
      .eq("provider", "paymongo").is("effective_to", null),
    supabase.rpc("payout_unreconciled_count", { p_event_id: eventId }),
  ]);
  if (payErr) throw payErr;

  type Join = {
    registration_id: string; amount: number; platform_fee: number;
    processor_fee_cents: number; processor_fee_source: string; net_to_org: number;
    status: string; refunded_amount: number; method: string | null; created_at: string;
    registrations: {
      categories: { label: string } | null;
      profiles: { full_name: string | null; bib_name: string | null } | null;
    } | null;
  };

  const rows: SettlementRow[] = ((pays ?? []) as unknown as Join[]).map((p) => ({
    registration_id: p.registration_id,
    runner_name: p.registrations?.profiles?.full_name
      ?? p.registrations?.profiles?.bib_name ?? "Unknown runner",
    category: p.registrations?.categories?.label ?? "—",
    paid_at: p.created_at,
    method: p.method,
    gross_paid: p.amount,
    rp_commission: p.platform_fee,
    // A 'historical' fee was absorbed by the platform, not deducted from the
    // organizer. Reporting it in their column would show them a cost they never
    // paid — see the ledger-invariant note on payments.processor_fee_source.
    processing_fee: p.processor_fee_source === "historical" ? 0 : p.processor_fee_cents,
    net_to_org: p.net_to_org,
    status: p.status,
    refunded_amount: p.refunded_amount,
    refunded_at: null,
  }));

  const org = ev.organizations as unknown as {
    name: string; fee_mode: "absorb" | "pass_on";
    commission_type: string; commission_rate: number | null; commission_flat_cents: number;
  };
  const totals = settlementTotals(rows);

  let projected: { low: number; high: number } | null = null;
  if (org.fee_mode === "absorb" && rows.length > 0) {
    const local = (rates ?? []).filter((r) => r.scope === "local") as ProcessorRateLite[];
    if (local.length > 0) {
      const cost = (r: ProcessorRateLite) => r.percent_bps * 100 + r.fixed_cents;
      const cheap = local.reduce((a, b) => (cost(a) <= cost(b) ? a : b));
      const dear = local.reduce((a, b) => (cost(a) >= cost(b) ? a : b));
      const paid = rows.filter((r) => r.status !== "refunded");
      const avg = paid.length
        ? Math.round(paid.reduce((s, r) => s + r.gross_paid, 0) / paid.length) : 0;
      const comm = paid.length
        ? Math.round(paid.reduce((s, r) => s + r.rp_commission, 0) / paid.length) : 0;
      projected = projectedRange(paid.length, avg, comm, { cheap, dear });
    }
  }

  return {
    event_name: ev.name as string,
    org_name: org.name,
    rows, totals,
    feeMode: org.fee_mode,
    projected,
    unreconciled: (unrec as number | null) ?? 0,
  };
}
```

- [ ] **Step 6: Write the export button**

Create `apps/web/app/(admin)/events/[eventId]/settlement/export-button.tsx`:

```tsx
"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { settlementCsv, type SettlementRow } from "@/lib/settlement-csv";

/** Serialises client-side from rows the page already rendered, so the export
 *  and the table can never disagree — no second query, no second read model. */
export function ExportSettlementButton({
  rows, eventName,
}: { rows: SettlementRow[]; eventName: string }) {
  function download() {
    const blob = new Blob([settlementCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${eventName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-settlement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button size="sm" variant="outline" className="rounded-pill" onClick={download}>
      <Download className="size-4" strokeWidth={1.9} aria-hidden />
      Export CSV
    </Button>
  );
}
```

- [ ] **Step 7: Write the page**

Create `apps/web/app/(admin)/events/[eventId]/settlement/page.tsx`:

```tsx
import { notFound, redirect } from "next/navigation";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { getEventSettlement } from "@/lib/queries/settlement";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TableEmptyState } from "@/components/data-table";
import { peso, fmtDate } from "@/lib/format";
import { ExportSettlementButton } from "./export-button";

const MINUS = "−";
const deduction = (c: number) => (c === 0 ? peso(0) : `${MINUS}${peso(Math.abs(c))}`);

export default async function SettlementPage({
  params,
}: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const roles = await getMyRoles();
  // Org-scoped, unlike Commission and Payouts: an organizer SHOULD see their own
  // event's money. `manage_org` is the same capability the Payments page uses,
  // and redirect() rather than notFound() for the same reason it does — an org
  // page that exists but is not yours should say so, whereas a PLATFORM page
  // should not admit it exists at all. RLS on `payments` is the real boundary;
  // this is the capability half.
  if (!hasCapability(roles?.capabilities ?? [], "manage_org")) redirect("/no-access");

  const s = await getEventSettlement(eventId);
  if (!s) notFound();

  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[21px] font-bold tracking-[-0.02em]">Settlement · {s.event_name}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Gross → Race Pace commission → payment processing → refunds → net to you
          </p>
        </div>
        <ExportSettlementButton rows={s.rows} eventName={s.event_name} />
      </div>

      <Card className="mb-4 gap-0 rounded-xl border p-[15px] shadow-card">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-5">
          <div><dt className="text-muted-foreground">Gross collected</dt>
            <dd className="font-bold tabular-nums">{peso(s.totals.gross)}</dd></div>
          <div><dt className="text-muted-foreground">Race Pace commission</dt>
            <dd className="font-bold tabular-nums">{deduction(s.totals.commission)}</dd></div>
          <div><dt className="text-muted-foreground">Payment processing</dt>
            <dd className="font-bold tabular-nums">{deduction(s.totals.processing)}</dd></div>
          <div><dt className="text-muted-foreground">Refunds</dt>
            <dd className="font-bold tabular-nums">{deduction(s.totals.refunds)}</dd></div>
          <div><dt className="text-muted-foreground">Net to you</dt>
            <dd className="text-[15px] font-bold tabular-nums">{peso(s.totals.net)}</dd></div>
        </dl>
      </Card>

      {s.projected ? (
        <p className="mb-4 rounded-[9px] border border-l-[3px] border-l-primary bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          <b className="font-semibold text-foreground">
            Projected net {peso(s.projected.low)}–{peso(s.projected.high)}
          </b>{" "}
          depending on how runners pay. Your organization absorbs payment processing, and a card
          costs more to process than an e-wallet — so the final figure moves with the payment mix.
        </p>
      ) : null}

      {s.unreconciled > 0 ? (
        <p className="mb-4 rounded-[9px] border border-l-[3px] border-l-warning bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground">
          {s.unreconciled} payment{s.unreconciled === 1 ? " has" : "s have"} an{" "}
          <b className="font-semibold text-foreground">estimated</b> processing fee awaiting
          confirmation from the payment provider. The figures above may move by a few pesos.
        </p>
      ) : null}

      <Card className="gap-0 overflow-hidden rounded-xl border py-0 shadow-card">
        {s.rows.length === 0 ? (
          <TableEmptyState
            title="No payments yet"
            description="Money appears here as runners complete their registrations."
          />
        ) : (
          <Table className="text-[12.5px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Runner</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Processing</TableHead>
                <TableHead className="text-right">Net to you</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.rows.map((r) => (
                <TableRow key={r.registration_id} className={r.status === "refunded" ? "opacity-60" : undefined}>
                  <TableCell className="py-2.5 font-semibold">{r.runner_name}</TableCell>
                  <TableCell className="py-2.5">{r.category}</TableCell>
                  <TableCell className="py-2.5">{r.paid_at ? fmtDate(r.paid_at) : "—"}</TableCell>
                  <TableCell className="py-2.5">{r.method ?? "—"}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{peso(r.gross_paid)}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{deduction(r.rp_commission)}</TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">{deduction(r.processing_fee)}</TableCell>
                  <TableCell className="py-2.5 text-right font-bold tabular-nums">
                    {r.status === "refunded" ? peso(0) : peso(r.net_to_org)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
```

> **Capability note:** the four capabilities are `manage_platform`, `manage_team`, `manage_org`, `check_in` — there is no reporting-specific one, and inventing one would mean touching `capabilitiesFor`, `BY_ROLE` and the nav filters for no gain. `manage_org` covers Dashboard, Events, Registrations and Payments, which is exactly the audience for this page. A marshal (`check_in` only) correctly cannot reach it.

- [ ] **Step 8: Add the RLS isolation test**

Append to `supabase/tests/processor-fee-ledger.test.ts`:

```ts
describe("settlement RLS isolation", () => {
  it("an org admin reads zero payment rows belonging to another org", async () => {
    const s = svc();
    const stamp = `iso-${Date.now()}`;

    const orgA = (await s.from("organizations").insert({ name: "Iso A", slug: `${stamp}-a` })
      .select().single()).data!;
    const orgB = (await s.from("organizations").insert({ name: "Iso B", slug: `${stamp}-b` })
      .select().single()).data!;
    const users: string[] = [];
    try {
      const evB = (await s.from("events").insert({
        org_id: orgB.id, name: "Iso B Race", status: "draft",
      }).select().single()).data!;
      const catB = (await s.from("categories").insert({
        org_id: orgB.id, event_id: evB.id, code: "10k", label: "10K",
        base_price: 100000, slots_total: 10, slots_taken: 1,
      }).select().single()).data!;
      const runner = (await s.auth.admin.createUser({
        email: `${stamp}-run@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      users.push(runner.id);
      const regB = (await s.from("registrations").insert({
        org_id: orgB.id, event_id: evB.id, category_id: catB.id,
        user_id: runner.id, total_amount: 100000, status: "paid",
      }).select().single()).data!;
      await s.from("payments").insert({
        org_id: orgB.id, registration_id: regB.id, amount: 100000, status: "paid",
        platform_fee: 3000, processor_fee_cents: 1500, processor_fee_source: "actual",
        net_to_org: 95500,
      });

      // An admin of org A only.
      const adminA = (await s.auth.admin.createUser({
        email: `${stamp}-admin@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      users.push(adminA.id);
      await s.from("user_roles").insert({ user_id: adminA.id, role: "admin", org_id: orgA.id });

      const { createClient: cc } = await import("@supabase/supabase-js");
      const { anonKey } = loadEnv();
      const asA = cc(url, anonKey, { auth: { persistSession: false } });
      await asA.auth.signInWithPassword({ email: `${stamp}-admin@test.dev`, password: "password123" });

      const { data } = await asA.from("payments")
        .select("id,processor_fee_cents").eq("org_id", orgB.id);
      expect(data ?? []).toHaveLength(0);
    } finally {
      await s.from("organizations").delete().eq("id", orgA.id);
      await s.from("organizations").delete().eq("id", orgB.id);
      for (const id of users) await s.auth.admin.deleteUser(id);
    }
  });
});
```

- [ ] **Step 9: Run both suites**

Run:
```bash
pnpm test -- supabase/tests/processor-fee-ledger.test.ts
cd apps/web && pnpm test -- lib/settlement-math.test.ts lib/settlement-csv.test.ts && pnpm typecheck
```
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/settlement-math.ts apps/web/lib/settlement-math.test.ts apps/web/lib/queries/settlement.ts "apps/web/app/(admin)/events/[eventId]/settlement" supabase/tests/processor-fee-ledger.test.ts
git commit -m "feat(admin): add per-event settlement view with CSV export"
```

---

## Task 13: Super-admin surfaces

**Files:**
- Create: `apps/web/app/(admin)/commission/fee-mode-row.tsx`
- Modify: `apps/web/lib/queries/payouts.ts`
- Modify: `apps/web/app/(admin)/payouts/page.tsx`
- Modify: `apps/web/lib/queries/commission.ts`
- Modify: `apps/web/app/(admin)/commission/page.tsx`
- Modify: `apps/web/lib/actions/commission.ts`
- Test: `apps/web/lib/queries/payouts.test.ts` (append)

**Interfaces:**
- Consumes: `processor_rate_drift_v` (Task 10), `processing_cents` (Task 8), `fee_mode` (Task 1)
- Produces: `PayoutStatementRow.processing_cents`, `setFeeMode(orgId, mode)` server action

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/queries/payouts.test.ts`:

```ts
describe("payoutKpis with processing costs", () => {
  const base = {
    id: "s1", event_id: "e1", org_id: "o1", event_name: "E", org_name: "O",
    event_date: "2026-01-01", end_date: null, event_status: "completed",
    gross_cents: 600000, commission_cents: 18000, processing_cents: 9000,
    refunds_cents: 0, net_owed_cents: 573000,
    status: "open" as const, reference: null, note: null,
    opened_at: "2026-01-02T00:00:00Z", paid_at: null, event_finished: true,
  };

  it("totals processing across ready statements", () => {
    const k = payoutKpis([base, { ...base, id: "s2" }]);
    expect(k.processingCents).toBe(18000);
  });

  it("keeps the breakdown explaining the net owed", () => {
    expect(base.gross_cents - base.commission_cents - base.processing_cents)
      .toBe(base.net_owed_cents);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- lib/queries/payouts.test.ts`
Expected: FAIL — `processingCents` is undefined

- [ ] **Step 3: Extend the payouts read model**

In `apps/web/lib/queries/payouts.ts`:

Add `processing_cents: number;` to `PayoutStatementRow` (after `commission_cents`).

Add `processing_cents` to `STATEMENT_SELECT`:

```ts
const STATEMENT_SELECT =
  "id,event_id,org_id,gross_cents,commission_cents,processing_cents,refunds_cents,net_owed_cents," +
  "status,reference,note,opened_at,paid_at," +
  "events(name,event_date,end_date,status),organizations(name)";
```

Add it to `StatementJoinRow` and to the mapper in `listPayoutStatements`:

```ts
    processing_cents: r.processing_cents,
```

Add `processingCents: number;` to `PayoutKpis`, initialise it to `0` in the `k` literal, and accumulate it in the `ready` branch:

```ts
      case "ready":
        k.readyCount += 1;
        k.totalOwedCents += r.net_owed_cents;
        k.processingCents += r.processing_cents;
        break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- lib/queries/payouts.test.ts`
Expected: PASS

- [ ] **Step 5: Add the processing column to the payouts table**

In `apps/web/app/(admin)/payouts/page.tsx`, add a header cell between Commission and Refunds:

```tsx
                <TableHead className="text-right">Processing</TableHead>
```

and the matching body cell:

```tsx
                    <TableCell className="py-2.5 text-right tabular-nums">{deduction(row.processing_cents)}</TableCell>
```

- [ ] **Step 6: Add the drift banner to Commission**

In `apps/web/lib/queries/commission.ts`, add to the module:

```ts
export type RateDrift = {
  method: string;
  scope: string;
  sample_size: number;
  disagreeing: number;
  median_implied_bps: number;
  card_bps: number;
  delta_cents: number;
  drifting: boolean;
};

/**
 * Methods whose ACTUAL processing cost has diverged from the rate card.
 *
 * The ledger is unaffected — it records what was really charged — so this is
 * never a "the reports are wrong" alert. It means the pass-on surcharge is
 * under- or over-collecting, and the difference is absorbed by Race Pace rather
 * than passed to organizers.
 */
export async function getRateDrift(): Promise<RateDrift[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("processor_rate_drift_v").select("*").eq("drifting", true);
  if (error) throw error;
  return (data ?? []) as RateDrift[];
}
```

In `apps/web/app/(admin)/commission/page.tsx`, add the import and fetch alongside the existing overview:

```tsx
import { getCommissionOverview, getRateDrift } from "@/lib/queries/commission";

  const [{ orgs, events, totals }, drift] = await Promise.all([
    getCommissionOverview(),
    getRateDrift(),
  ]);
```

and render the banner directly above the KPI row:

```tsx
      {drift.map((d) => (
        <p
          key={`${d.method}-${d.scope}`}
          className="mb-3 rounded-[9px] border border-l-[3px] border-l-destructive bg-card px-3.5 py-[11px] text-[13px] text-muted-foreground"
        >
          <b className="font-semibold text-foreground">
            {d.method} rate appears to have changed.
          </b>{" "}
          The last {d.disagreeing} of {d.sample_size} {d.method} payments cost{" "}
          {(d.median_implied_bps / 100).toFixed(2)}%; the rate card says{" "}
          {(d.card_bps / 100).toFixed(2)}%.{" "}
          {d.delta_cents > 0
            ? `Under-collected ${peso(d.delta_cents)} across those payments, absorbed by Race Pace.`
            : `Over-collected ${peso(Math.abs(d.delta_cents))} across those payments.`}{" "}
          Organizers were paid in full either way.
        </p>
      ))}
```

- [ ] **Step 7: Add the fee-mode control**

Create `apps/web/app/(admin)/commission/fee-mode-row.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setFeeMode } from "@/lib/actions/commission";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Who bears the payment processing cost. Super admin only — RLS on
 *  `organizations` and the server action both re-check, so this is the UI half
 *  of the rule rather than the rule itself. */
export function FeeModeSelect({
  orgId, mode,
}: { orgId: string; mode: "absorb" | "pass_on" }) {
  const [pending, start] = useTransition();

  return (
    <Select
      value={mode}
      disabled={pending}
      onValueChange={(next) =>
        start(async () => {
          const res = await setFeeMode(orgId, next as "absorb" | "pass_on");
          if (res?.error) toast.error(res.error);
          else {
            toast.success(
              next === "pass_on"
                ? "Runners now cover fees; this organizer receives the full entry price."
                : "This organizer now absorbs payment processing.",
            );
          }
        })
      }
    >
      <SelectTrigger size="sm" className="w-[168px] rounded-pill">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="absorb">Absorb · org pays fees</SelectItem>
        <SelectItem value="pass_on">Pass on · runner pays fees</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

Append the server action to `apps/web/lib/actions/commission.ts` (match the file's existing action shape — auth guard, update, `revalidatePath`):

```ts
export async function setFeeMode(orgId: string, mode: "absorb" | "pass_on") {
  const roles = await getMyRoles();
  // A Server Action is a public endpoint. The console hides this control from
  // org staff; this is the boundary that actually enforces it, alongside the
  // organizations RLS policy underneath.
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) {
    return { error: "Not permitted" };
  }
  if (mode !== "absorb" && mode !== "pass_on") return { error: "Unknown fee mode" };

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ fee_mode: mode }).eq("id", orgId);
  if (error) return { error: error.message };
  revalidatePath("/commission");
  return {};
}
```

Add `fee_mode` to the org select in `getCommissionOverview`, add `fee_mode: "absorb" | "pass_on";` to `OrgCommissionRow`, add a `Fee mode` column header to the org terms table in `commission/page.tsx`, and render `<FeeModeSelect orgId={o.id} mode={o.fee_mode} />` in its cell.

> **Check before running:** `apps/web/lib/actions/commission.ts` may not currently import `getMyRoles`/`hasCapability`/`revalidatePath`. Add whichever imports are missing, matching how the file's existing actions guard themselves. If `organizations` has no super-admin UPDATE policy covering `fee_mode`, add one — and scope-check with `has_column_privilege` first, since this table has had table-level UPDATE grant drift before (see `20260806180000_org_name_update_grant.sql`).

- [ ] **Step 8: Verify**

Run:
```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm build
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/queries/payouts.ts apps/web/lib/queries/payouts.test.ts "apps/web/app/(admin)/payouts/page.tsx" apps/web/lib/queries/commission.ts "apps/web/app/(admin)/commission/page.tsx" "apps/web/app/(admin)/commission/fee-mode-row.tsx" apps/web/lib/actions/commission.ts
git commit -m "feat(admin): surface processing costs, rate drift and fee mode"
```

---

## Task 14: Runner-facing breakdown

**Files:**
- Modify: `apps/site/lib/payment.ts` (add `passOnLines`)
- Create: `apps/site/lib/payment.test.ts`
- Modify: `apps/site/lib/registration.ts` (`REG_SELECT` + `RegistrationRow` gain `feeMode`)
- Modify: `apps/site/app/pay/[registrationId]/PayPanel.tsx`
- Test: `apps/site/app/pay/[registrationId]/__tests__/PayPanel.test.tsx` (append)

> **Read these three files before writing anything.** `PayPanel` takes only `registrationId` and loads everything client-side through `useRegistration`; it already holds `method` in `useState` and already calls `breakdown(total, basePrice)` from `@/lib/payment`. So the fee lines belong in that same client path — **not** as new props from the server page. Passing them as props would freeze the processing line at whatever method was current on the server render, and the whole point is that it moves when the runner switches method.

**Interfaces:**
- Consumes: `fee_mode` (Task 1), `processor_rates` (Task 2)
- Produces: `export function passOnLines(baseTotal: number, platformFee: number, rate: { percent_bps: number; fixed_cents: number }): { base: number; platformFee: number; processorFee: number; total: number }`

> **Why this duplicates `passOnBreakdown` from Task 6.** `apps/site` cannot import from `supabase/functions/` — different runtime, different tsconfig, no path alias. This is display-only and the server recomputes the authoritative amount in `payment-session`. The duplication is therefore deliberate and must be marked as such in a comment, with the test below asserting both implementations agree on the same worked examples.

- [ ] **Step 1: Write the failing test**

Create `apps/site/lib/payment.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { passOnLines } from "./payment";

const CARD = { percent_bps: 350, fixed_cents: 1500 };
const GCASH = { percent_bps: 150, fixed_cents: 0 };

describe("passOnLines", () => {
  it("matches the server's gross-up for GCash", () => {
    // Must equal supabase/functions/_shared/processorFee.ts passOnBreakdown.
    expect(passOnLines(200000, 6000, GCASH)).toEqual({
      base: 200000, platformFee: 6000, processorFee: 3138, total: 209138,
    });
  });

  it("matches the server's gross-up for a local card", () => {
    expect(passOnLines(200000, 6000, CARD)).toEqual({
      base: 200000, platformFee: 6000, processorFee: 9026, total: 215026,
    });
  });

  it("keeps the three lines summing to the total", () => {
    for (const rate of [CARD, GCASH, { percent_bps: 450, fixed_cents: 1500 }]) {
      const l = passOnLines(200000, 6000, rate);
      expect(l.base + l.platformFee + l.processorFee).toBe(l.total);
    }
  });

  it("returns a zero total for a zero base", () => {
    expect(passOnLines(0, 0, CARD).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/site && pnpm test -- lib/payment.test.ts`
Expected: FAIL — `passOnLines is not a function`

- [ ] **Step 3: Add `passOnLines`**

Append to `apps/site/lib/payment.ts`:

```ts
/**
 * The itemised lines a pass-on runner sees, and the total they will be charged.
 *
 * DISPLAY ONLY. `payment-session` recomputes the authoritative amount server-side
 * when the runner actually pays — this exists so the screen can show the total
 * BEFORE that call, and so it updates when they switch payment method.
 *
 * DELIBERATE DUPLICATE of `passOnBreakdown` in
 * supabase/functions/_shared/processorFee.ts. apps/site cannot import from
 * supabase/functions (different runtime, no path alias), so the formula is
 * written twice on purpose. lib/payment.test.ts asserts both agree on the same
 * worked examples — if you change one, change the other and both tests.
 *
 * The gross-up is not optional: the processor charges its percentage on the
 * FINAL amount, so adding the fee to the base under-collects on every payment.
 * `ceil` puts the sub-centavo remainder on the organizer's side.
 */
export function passOnLines(
  baseTotal: number,
  platformFee: number,
  rate: { percent_bps: number; fixed_cents: number },
): { base: number; platformFee: number; processorFee: number; total: number } {
  if (baseTotal <= 0) return { base: 0, platformFee: 0, processorFee: 0, total: 0 };
  const target = baseTotal + platformFee;
  const total = Math.ceil(((target + rate.fixed_cents) * 10000) / (10000 - rate.percent_bps));
  return { base: baseTotal, platformFee, processorFee: total - baseTotal - platformFee, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/site && pnpm test -- lib/payment.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Carry `fee_mode` through the registration query**

In `apps/site/lib/registration.ts`:

Add `fee_mode` to the `organizations(...)` embed inside `REG_SELECT` — it currently reads `organizations(name)`:

```ts
organizations(name,fee_mode)
```

Add to `RegistrationRow`:

```ts
  feeMode: "absorb" | "pass_on";
```

and to the mapper beside `orgName`:

```ts
    feeMode: (r.organizations?.fee_mode ?? "absorb") as "absorb" | "pass_on",
```

Defaulting to `absorb` rather than throwing: a missing embed must render the sticker price, never an unpriced screen.

- [ ] **Step 6: Write the failing PayPanel test**

Append to `apps/site/app/pay/[registrationId]/__tests__/PayPanel.test.tsx`, following the file's existing mocking of `useRegistration` (read it first and mirror how the other tests stub `reg.data`):

```tsx
describe("fee breakdown", () => {
  it("shows only the total in absorb mode — the runner pays no fees", () => {
    renderWithRegistration({ total_amount: 200000, basePrice: 200000, feeMode: "absorb" });
    expect(screen.getByText("₱2,000.00")).toBeInTheDocument();
    expect(screen.queryByText(/service fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/payment processing/i)).not.toBeInTheDocument();
  });

  it("itemises every line in pass-on mode, because each one changes the total", () => {
    renderWithRegistration({ total_amount: 200000, basePrice: 200000, feeMode: "pass_on" });
    expect(screen.getByText(/Race Pace service fee/i)).toBeInTheDocument();
    expect(screen.getByText(/Payment processing/i)).toBeInTheDocument();
    // GCash is the default method.
    expect(screen.getByText("₱2,091.38")).toBeInTheDocument();
  });

  it("updates the processing line when the runner switches to card", async () => {
    const user = userEvent.setup();
    renderWithRegistration({ total_amount: 200000, basePrice: 200000, feeMode: "pass_on" });
    await user.click(screen.getByRole("button", { name: /card/i }));
    expect(screen.getByText("₱2,150.26")).toBeInTheDocument();
  });
});
```

> `renderWithRegistration` is a helper you add to this file if one does not already exist — it renders `<PayPanel registrationId="r1" />` with `useRegistration` mocked to return the given row merged over a valid default. Do not change PayPanel's props.

- [ ] **Step 7: Render the breakdown**

In `PayPanel.tsx`, fetch the current rate for the selected method and render the lines. The rate lookup is a client Supabase read of `processor_rates` (readable by any authenticated user per Task 2's policy), keyed on the `method` already in state.

Where the panel currently shows the total, branch on mode:

```tsx
{reg.data.feeMode === "pass_on" && rate ? (
  <dl className="space-y-1 text-sm">
    <div className="flex justify-between">
      <dt>Entry fee</dt>
      <dd className="tabular-nums">{formatPeso(lines.base)}</dd>
    </div>
    <div className="flex justify-between text-muted-foreground">
      <dt>Race Pace service fee</dt>
      <dd className="tabular-nums">{formatPeso(lines.platformFee)}</dd>
    </div>
    <div className="flex justify-between text-muted-foreground">
      <dt>Payment processing</dt>
      <dd className="tabular-nums">{formatPeso(lines.processorFee)}</dd>
    </div>
    <div className="mt-2 flex justify-between border-t pt-2 font-bold">
      <dt>Total to pay</dt>
      <dd className="tabular-nums">{formatPeso(lines.total)}</dd>
    </div>
  </dl>
) : (
  <div className="flex justify-between font-bold">
    <span>Total to pay</span>
    <span className="tabular-nums">{formatPeso(total)}</span>
  </div>
)}
```

Keep the existing `breakdown(total, basePrice)` entry/add-ons display in absorb mode exactly as it is — this task adds a branch, it does not restructure the panel.

The platform fee for `lines` comes from the org's commission terms. If `useRegistration` does not already carry them, add `commission_type,commission_rate,commission_flat_cents` to the `organizations(...)` embed in Step 5 and mirror `computeFee`'s rule — percent uses the rate (defaulting to 0.03), fixed uses the flat cents, both clamped at the total.

- [ ] **Step 8: Verify**

Run:
```bash
cd apps/site && pnpm test && pnpm typecheck && pnpm build
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/site/lib/payment.ts apps/site/lib/payment.test.ts apps/site/lib/registration.ts "apps/site/app/pay/[registrationId]"
git commit -m "feat(site): itemise the fee breakdown in pass-on mode"
```

---

## Task 15: Full verification

**Files:** none created; this task proves the whole thing works end to end.

- [ ] **Step 1: Reset and run every suite**

Run:
```bash
pnpm exec supabase db reset
pnpm exec supabase functions serve &
pnpm test
```
Expected: PASS across all `supabase/tests/*.test.ts`.

- [ ] **Step 2: Run both app suites and typechecks**

Run:
```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm build
cd ../site && pnpm test && pnpm typecheck && pnpm build
```
Expected: PASS

- [ ] **Step 3: Verify the grants canary**

Run: `pnpm test -- supabase/tests/function-grants.test.ts`
Expected: PASS. Every function added by this work (`processor_rate_at`, `payout_unreconciled_count`, `backfill_processor_fees_once`, the rewritten `confirm_payment_tx` and `refund_registration_tx`) must be absent from `anon`'s executable set. `revoke ... from public` alone does NOT achieve this — anon inherits EXECUTE via default privileges, which was a proven payment bypass.

- [ ] **Step 4: Manual end-to-end against a real PayMongo test payment**

This is the only step that proves `pmFeeFromAttributes` reads the real payload shape. Everything before it tests a payload we constructed ourselves.

1. Set an org to `absorb` with `commission_rate = 0.03`.
2. Register and pay with PayMongo test card `4343 4343 4343 4345`.
3. Query the payment:
   ```sql
   select amount, platform_fee, processor_fee_cents, processor_fee_source, net_to_org
     from payments where registration_id = '<rid>';
   ```
4. Confirm `processor_fee_source = 'actual'`, that `processor_fee_cents` is non-zero, and that `amount - processor_fee_cents - platform_fee = net_to_org`.
5. Confirm the fee matches the card rate card (3.50% + ₱15 VAT-inclusive) within a peso. **If it does not, the rate card seed is wrong — correct `processor_rates`, not the ledger.**
6. Switch the org to `pass_on`, register again, and confirm the amount charged is the grossed-up figure and the organizer's `net_to_org` equals the full entry price.

- [ ] **Step 5: Commit any fixes and open the PR**

```bash
git add -A
git commit -m "test: verify three-party ledger end to end"
```

---

## Self-Review

**Spec coverage:**

| Spec § | Task |
| --- | --- |
| §3.1 payments columns | 1 |
| §3.2 organizations.fee_mode, 3% default | 1 |
| §3.3 processor_rates + seed | 2 |
| §3.4 payout_statements.processing_cents | 1 |
| §4.1 absorb confirmation | 5 |
| §4.2 pass-on gross-up | 3, 6 |
| §4.3 international card gap | 6 (local prediction), 13 (absorbed total surfaced via drift banner) |
| §5 drift detection | 10 |
| §6 refund rule + §6.2 code changes | 7 |
| §7 payout statement arithmetic + unreconciled | 8 |
| §8 runner display | 14 |
| §9 organizer settlement, RLS test, CSV | 11, 12 |
| §9 super-admin surfaces | 13 |
| §10 backfill | 9 |
| §11 error handling | 5 (integrity, missing fee), 6 (missing rate), 7 (refund exceeds net) |
| §12 testing | every task; 15 verifies together |

**Known gap:** §4.3's "total absorbed by Race Pace" tile on the Commission page is covered only by the drift banner's `delta_cents`, which counts rate drift but not international-card shortfalls. Those are visible per-payment (`platform_fee` lands below 3% of base) but are not aggregated anywhere. Add a follow-up task if you want that as its own figure; it is deliberately not blocking, since no money is misdirected — the organizer is paid in full either way.

**Type consistency:** `ProcessorRate` is `{ percent_bps, fixed_cents }` in `processorFee.ts` and mirrored as `ProcessorRateLite` in `settlement.ts` (which cannot import from `supabase/functions/`). `SettlementRow` is defined once in `settlement-csv.ts` and imported by `settlement.ts`. `processor_rate_at` returns `(percent_bps, fixed_cents)` matching `ProcessorRate` exactly, so RPC results cast without a mapper.
