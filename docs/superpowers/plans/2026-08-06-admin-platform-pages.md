# Admin Platform Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five `ComingSoon` stubs in `apps/web` — dashboard, check-in, organizations, commission, payouts — with working pages, and add the money model they need (flat-or-percent commission, per-org refund policy, event-based payout statements).

**Architecture:** Next.js 15 App Router Server Components read org-scoped data through `lib/queries/*` modules; money transitions go through security-definer Postgres RPCs so a read and its dependent write are never two round trips. A cookie carries the super admin's selected org so Server Components can resolve it without a client round trip. Phase 0 is sequential foundation — every page depends on it; Phase 1 pages are independent and parallelisable.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4, shadcn/ui, Supabase (Postgres + RLS + Edge Functions on Deno), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-06-admin-platform-pages-design.md`

## Global Constraints

- **Branch from `main`.** The worktree at `.claude/worktrees/event-registration-web-fff722` is 56 commits behind and still holds the pre-migration Vite `apps/web`. Do not build there.
- **All money is integer centavos.** `sum()` over integer yields bigint; cast explicitly (`::bigint`) so the wire shape is predictable.
- **`platform_fee + net_to_org == amount`** must hold on every payment row, including after a partial refund rewrites the split.
- **Views use `with (security_invoker = true)`** so the caller's own RLS applies. RPCs reading those views use `security invoker`; RPCs writing money use `security definer` with `set search_path = ''` and fully schema-qualified names.
- **Design tokens only.** `--color-x` in classes; never raw hex. `--x` is an RGB channel triple, not a colour.
- **Tabular numerals on every figure**: `tabular-nums`.
- **No JetBrains Mono for money.** It has no U+20B1 (₱). Use the sans stack.
- **Peso formatting** goes through `peso()` in `@/lib/format`.
- **Page shell**: `<div className="px-4 pb-10 pt-6 md:px-[30px]">`, title `text-[21px] font-bold tracking-[-0.02em]`.
- **Cards**: `rounded-xl border shadow-card`.
- **Org-scoped pages** must call `requireOrgId(roles)` and render `<NoOrgScope />` when null — never pass a null id to a query.
- **Commit after each task.**

## Execution order

```
Phase 0 (sequential — every page depends on it)
  T1 → T2 → T3 → T4 → T5 → T6

Phase 1 (parallel — independent once Phase 0 lands)
  T7 Dashboard    T8 Check-in    T9 Organizations
  T10 Commission  T11 Payouts    T12 Payments method column
```

---

# Phase 0 — Foundation

### Task 1: Commission shape, refund policy, and widened aggregates

**Files:**
- Create: `supabase/migrations/20260807090000_payment_status_partial.sql`
- Create: `supabase/migrations/20260807090100_commission_and_refund_policy.sql`
- Create: `supabase/migrations/20260807090200_widen_money_aggregates.sql`
- Test: `supabase/tests/commission-refund-policy.test.ts`

**Interfaces:**
- Produces: `organizations.commission_type` (`'percent'|'fixed'`), `organizations.commission_flat_cents` (int), `organizations.refund_policy` (`'full'|'none'|'flat_fee'`), `organizations.refund_fee_cents` (int), `payments.refunded_amount` (int), `payment_status` value `'partially_refunded'`.

- [ ] **Step 1: Add the enum value in its own migration**

`ALTER TYPE ... ADD VALUE` cannot run in the same transaction as statements that use the new value, so it must be alone in the earliest file.

```sql
-- supabase/migrations/20260807090000_payment_status_partial.sql
-- A flat-fee refund returns part of the payment and RETAINS the rest, which is
-- real revenue for both parties. 'refunded' cannot express that: it drops the
-- row out of every `status = 'paid'` sum, which would erase money the organizer
-- actually keeps.
--
-- Alone in this file deliberately: ALTER TYPE ... ADD VALUE cannot run in the
-- same transaction as any statement that references the new value, and the
-- Supabase CLI wraps each migration file in one transaction.
alter type payment_status add value if not exists 'partially_refunded';
```

- [ ] **Step 2: Add the commission and refund-policy columns**

```sql
-- supabase/migrations/20260807090100_commission_and_refund_policy.sql
-- Design 2026-08-06 §9.5, §9.6.
--
-- Commission is charged PER REGISTRATION (already true — _shared/confirm.ts
-- computes against one registration's total_amount). What is new is that the fee
-- may be a flat peso amount rather than only a percentage.
alter table organizations
  add column if not exists commission_type text not null default 'fixed'
    check (commission_type in ('percent', 'fixed')),
  add column if not exists commission_flat_cents integer not null default 0
    check (commission_flat_cents >= 0),
  add column if not exists refund_policy text not null default 'flat_fee'
    check (refund_policy in ('full', 'none', 'flat_fee')),
  add column if not exists refund_fee_cents integer not null default 0
    check (refund_fee_cents >= 0);

alter table payments
  add column if not exists refunded_amount integer not null default 0
    check (refunded_amount >= 0);

-- The column DEFAULT and this backfill deliberately disagree.
--
-- New organizations default to a flat fee and a flat-fee refund, as decided.
-- But the companion amounts default to 0, and a ₱0 flat commission earns the
-- platform nothing while a ₱0 retention is indistinguishable from a full
-- refund. Letting live orgs inherit the new defaults would silently drop Race
-- Pace's revenue on them to zero.
--
-- A default is for rows that do not exist yet. Rows that already exist keep the
-- terms they are actually operating under.
update organizations set commission_type = 'percent' where commission_type = 'fixed';
update organizations set refund_policy   = 'full'    where refund_policy   = 'flat_fee';
```

- [ ] **Step 3: Widen every money aggregate**

A `partially_refunded` row holds retained revenue. Any aggregate still filtering on `= 'paid'` silently under-reports it.

```sql
-- supabase/migrations/20260807090200_widen_money_aggregates.sql
-- Design 2026-08-06 §9.6. A partially_refunded payment retains real revenue for
-- both parties, so every place that meant "money we actually have" must count it.
-- Missing one makes a KPI disagree with the table beneath it — the exact failure
-- 20260806190000_admin_kpi_aggregates.sql was written to prevent.

create or replace view admin_org_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    count(*)::int                                                                as reg_count,
    count(*) filter (where p.status in ('paid','partially_refunded'))::int       as paid_count,
    count(*) filter (where p.status is distinct from 'paid'
                       and p.status is distinct from 'partially_refunded')::int  as pending_count,
    coalesce(sum(p.amount)       filter (where p.status in ('paid','partially_refunded')), 0)::bigint as gross_revenue,
    coalesce(sum(p.net_to_org)   filter (where p.status in ('paid','partially_refunded')), 0)::bigint as net_to_org,
    coalesce(sum(p.platform_fee) filter (where p.status in ('paid','partially_refunded')), 0)::bigint as platform_fee
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id;

create or replace view admin_event_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    r.event_id,
    count(*)::int as reg_count,
    coalesce(sum(p.amount) filter (where p.status in ('paid','partially_refunded')), 0)::bigint as gross_revenue
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id, r.event_id;

grant select on admin_org_totals_v   to authenticated;
grant select on admin_event_totals_v to authenticated;
```

Then update both KPI RPCs in the same file. Read `20260806190000_admin_kpi_aggregates.sql` and `20260806190000`'s payment sibling first, and re-emit each `create or replace function` verbatim except: every `filter (where v.payment_status = 'paid')` becomes `filter (where v.payment_status in ('paid','partially_refunded'))`. Do **not** change the `p_q` handling — read that migration's header comment on why the pattern arrives pre-wildcarded.

- [ ] **Step 4: Write the failing test**

```ts
// supabase/tests/commission-refund-policy.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("commission + refund policy columns", () => {
  it("defaults new orgs to a flat fee and a flat-fee refund", async () => {
    const s = svc();
    const slug = `defaults-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "Defaults", slug }).select().single()).data!;
    expect(org.commission_type).toBe("fixed");
    expect(org.refund_policy).toBe("flat_fee");
    await s.from("organizations").delete().eq("id", org.id);
  });

  it("rejects a negative flat fee", async () => {
    const s = svc();
    const r = await s.from("organizations")
      .insert({ name: "Bad", slug: `bad-${Date.now()}`, commission_flat_cents: -1 });
    expect(r.error).toBeTruthy();
  });

  it("counts a partially_refunded payment as revenue in admin_org_totals_v", async () => {
    const s = svc();
    const org = (await s.from("organizations").insert({ name: "Partial", slug: `partial-${Date.now()}` }).select().single()).data!;
    const ev = (await s.from("events").insert({ org_id: org.id, name: "R", status: "open" }).select().single()).data!;
    const u = await s.auth.admin.createUser({ email: `p_${Date.now()}@test.dev`, password: "password123", email_confirm: true });
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, user_id: u.data.user!.id, total_amount: 30000, status: "paid",
    }).select().single()).data!;
    await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 30000, platform_fee: 3000,
      net_to_org: 27000, status: "partially_refunded", refunded_amount: 170000, provider: "fake",
    });

    const t = (await s.from("admin_org_totals_v").select("gross_revenue,paid_count,pending_count").eq("org_id", org.id).single()).data!;
    expect(Number(t.gross_revenue)).toBe(30000);
    expect(t.paid_count).toBe(1);
    expect(t.pending_count).toBe(0);

    await s.from("payments").delete().eq("registration_id", reg.id);
    await s.from("registrations").delete().eq("id", reg.id);
    await s.from("organizations").delete().eq("id", org.id);
    await s.auth.admin.deleteUser(u.data.user!.id);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm vitest run supabase/tests/commission-refund-policy.test.ts`
Expected: FAIL — `commission_type` column does not exist.

- [ ] **Step 6: Apply the migrations**

```bash
npx supabase@2.109.1 db push --linked
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm vitest run supabase/tests/commission-refund-policy.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/2026080709*.sql supabase/tests/commission-refund-policy.test.ts
git commit -m "feat(db): flat-or-percent commission, per-org refund policy

New orgs default to flat on both; existing orgs are explicitly backfilled
to their current terms, because the companion amounts default to zero and
inheriting the new defaults would drop live revenue to nothing.

partially_refunded holds real retained revenue, so every money aggregate
widens to count it — missing one makes a KPI disagree with its table.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Payout statements

**Files:**
- Create: `supabase/migrations/20260807090300_payout_statements.sql`
- Test: `supabase/tests/payout-statements.test.ts`

**Interfaces:**
- Consumes: `payments.status` including `'partially_refunded'` (Task 1).
- Produces: table `payout_statements`; `payments.payout_statement_id`, `payments.payout_clawback_id`; RPCs `payout_open_statement(p_event_id uuid) returns uuid`, `payout_mark_paid(p_statement_id uuid, p_reference text, p_note text) returns text`.

- [ ] **Step 1: Write the table and RPCs**

```sql
-- supabase/migrations/20260807090300_payout_statements.sql
-- Design 2026-08-06 §8, §9.1.
--
-- Race Pace is the merchant of record: every payment lands in the platform's
-- PayMongo account and the organizer is settled afterwards, per EVENT. A
-- calendar period would split one race weekend's money across two statements.

create table if not exists payout_statements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  event_id         uuid not null references events(id) on delete cascade,
  gross_cents      bigint not null,
  commission_cents bigint not null,
  refunds_cents    bigint not null,
  net_owed_cents   bigint not null,
  status           text not null default 'open' check (status in ('open','paid')),
  reference        text,
  note             text,
  opened_by        uuid not null references auth.users(id),
  opened_at        timestamptz not null default now(),
  paid_at          timestamptz,
  paid_by          uuid references auth.users(id)
);

-- At most one OPEN statement per event; paid ones accumulate as history, which
-- is what lets a later top-up statement collect money that arrived after an
-- earlier settlement.
create unique index if not exists payout_statements_one_open_per_event
  on payout_statements (event_id) where status = 'open';

alter table payments
  add column if not exists payout_statement_id uuid references payout_statements(id),
  add column if not exists payout_clawback_id  uuid references payout_statements(id);

create index if not exists payments_payout_statement_idx on payments (payout_statement_id);
create index if not exists payments_payout_clawback_idx  on payments (payout_clawback_id);

alter table payout_statements enable row level security;

create policy payout_statements_super_admin on payout_statements
  for all using (auth_is_super_admin()) with check (auth_is_super_admin());

grant select on payout_statements to authenticated;

-- Open a statement for one event.
--
-- Amounts key on the STAMP, not on status alone. Keying on status was the
-- original (wrong) design: an entry refunded BEFORE its payout is no longer
-- 'paid', so it contributed 0 to gross while still subtracting its full
-- net_to_org — inventing a debt for money the organizer never received.
--
--   earn     = unsettled money we now owe
--   clawback = money already transferred, since refunded, not yet recovered
--
-- A refund therefore lands in exactly one place, or in neither. Never both.
create or replace function public.payout_open_statement(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_gross    bigint;
  v_comm     bigint;
  v_refunds  bigint;
  v_id       uuid;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select org_id into v_org from public.events where id = p_event_id;
  if v_org is null then raise exception 'event_not_found'; end if;

  select
    coalesce(sum(p.amount)       filter (where p.status in ('paid','partially_refunded')
                                           and p.payout_statement_id is null), 0),
    coalesce(sum(p.platform_fee) filter (where p.status in ('paid','partially_refunded')
                                           and p.payout_statement_id is null), 0),
    coalesce(sum(p.net_to_org)   filter (where p.status = 'refunded'
                                           and p.payout_statement_id is not null
                                           and p.payout_clawback_id is null), 0)
  into v_gross, v_comm, v_refunds
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id;

  insert into public.payout_statements
    (org_id, event_id, gross_cents, commission_cents, refunds_cents, net_owed_cents, opened_by)
  values
    (v_org, p_event_id, v_gross, v_comm, v_refunds, v_gross - v_comm - v_refunds, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Mark paid AND stamp every row the statement covered, in one transaction.
--
-- The stamps are what make double-payment structurally impossible regardless of
-- when a statement is opened: the next statement for this event only sees rows
-- that are still unstamped. payout_clawback_id exists so a refund is recovered
-- exactly once — without it, every later statement would re-subtract it forever.
create or replace function public.payout_mark_paid(
  p_statement_id uuid, p_reference text, p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_status text;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select event_id, status into v_event, v_status
    from public.payout_statements where id = p_statement_id for update;
  if v_event is null then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  update public.payments p
     set payout_statement_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('paid','partially_refunded')
     and p.payout_statement_id is null;

  update public.payments p
     set payout_clawback_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status = 'refunded'
     and p.payout_statement_id is not null
     and p.payout_clawback_id is null;

  update public.payout_statements
     set status = 'paid', paid_at = now(), paid_by = auth.uid(),
         reference = p_reference, note = p_note
   where id = p_statement_id;

  return 'paid';
end;
$$;

revoke all on function public.payout_open_statement(uuid) from public;
revoke all on function public.payout_mark_paid(uuid, text, text) from public;
grant execute on function public.payout_open_statement(uuid) to authenticated;
grant execute on function public.payout_mark_paid(uuid, text, text) to authenticated;
```

- [ ] **Step 2: Write the failing test**

The three refund cases are the whole point of this task — test them explicitly.

```ts
// supabase/tests/payout-statements.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** Fresh org+event with N paid payments, isolated from seed data. */
async function fixture(tag: string, count: number) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  const org = (await s.from("organizations").insert({ name: "Payout Org", slug: stamp }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "Payout Race", status: "open" }).select().single()).data!;
  const users: string[] = [];
  const regs: string[] = [];
  for (let i = 0; i < count; i++) {
    const u = await s.auth.admin.createUser({ email: `po_${stamp}_${i}@test.dev`, password: "password123", email_confirm: true });
    users.push(u.data.user!.id);
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, user_id: u.data.user!.id, total_amount: 200000, status: "paid",
    }).select().single()).data!;
    regs.push(reg.id);
    await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 200000,
      platform_fee: 20000, net_to_org: 180000, status: "paid", provider: "fake",
    });
  }
  return { s, org, ev, users, regs };
}

async function cleanup(s: ReturnType<typeof svc>, orgId: string, users: string[]) {
  await s.from("payout_statements").delete().eq("org_id", orgId);
  await s.from("organizations").delete().eq("id", orgId);
  for (const u of users) await s.auth.admin.deleteUser(u);
}

describe("payout statements", () => {
  it("sums unsettled paid payments", async () => {
    const { s, org, ev, users } = await fixture("sum", 3);
    const id = (await s.rpc("payout_open_statement", { p_event_id: ev.id })).data as string;
    const st = (await s.from("payout_statements").select("*").eq("id", id).single()).data!;
    expect(Number(st.gross_cents)).toBe(600000);
    expect(Number(st.commission_cents)).toBe(60000);
    expect(Number(st.refunds_cents)).toBe(0);
    expect(Number(st.net_owed_cents)).toBe(540000);
    await cleanup(s, org.id, users);
  });

  it("a refund BEFORE payout contributes nothing — not a negative", async () => {
    const { s, org, ev, users, regs } = await fixture("early", 2);
    // Refund one entry before any statement exists.
    await s.from("payments").update({ status: "refunded" }).eq("registration_id", regs[0]);

    const id = (await s.rpc("payout_open_statement", { p_event_id: ev.id })).data as string;
    const st = (await s.from("payout_statements").select("*").eq("id", id).single()).data!;
    // Only the surviving entry counts. The refunded one is invisible: the org
    // was never given that money, so there is nothing to claw back.
    expect(Number(st.gross_cents)).toBe(200000);
    expect(Number(st.refunds_cents)).toBe(0);
    expect(Number(st.net_owed_cents)).toBe(180000);
    await cleanup(s, org.id, users);
  });

  it("a refund AFTER payout is clawed back exactly once", async () => {
    const { s, org, ev, users, regs } = await fixture("late", 2);
    const first = (await s.rpc("payout_open_statement", { p_event_id: ev.id })).data as string;
    await s.rpc("payout_mark_paid", { p_statement_id: first, p_reference: "REF-1", p_note: null });

    // Now refund one already-settled entry.
    await s.from("payments").update({ status: "refunded" }).eq("registration_id", regs[0]);

    const second = (await s.rpc("payout_open_statement", { p_event_id: ev.id })).data as string;
    const st2 = (await s.from("payout_statements").select("*").eq("id", second).single()).data!;
    expect(Number(st2.gross_cents)).toBe(0);
    expect(Number(st2.refunds_cents)).toBe(180000);
    expect(Number(st2.net_owed_cents)).toBe(-180000); // organizer owes it back
    await s.rpc("payout_mark_paid", { p_statement_id: second, p_reference: "REC-1", p_note: null });

    // A THIRD statement must not re-subtract the same refund.
    const third = (await s.rpc("payout_open_statement", { p_event_id: ev.id })).data as string;
    const st3 = (await s.from("payout_statements").select("*").eq("id", third).single()).data!;
    expect(Number(st3.refunds_cents)).toBe(0);
    expect(Number(st3.net_owed_cents)).toBe(0);
    await cleanup(s, org.id, users);
  });

  it("allows only one open statement per event", async () => {
    const { s, org, ev, users } = await fixture("uniq", 1);
    await s.rpc("payout_open_statement", { p_event_id: ev.id });
    const second = await s.rpc("payout_open_statement", { p_event_id: ev.id });
    expect(second.error).toBeTruthy();
    await cleanup(s, org.id, users);
  });

  it("mark_paid is idempotent", async () => {
    const { s, org, ev, users } = await fixture("idem", 1);
    const id = (await s.rpc("payout_open_statement", { p_event_id: ev.id })).data as string;
    expect((await s.rpc("payout_mark_paid", { p_statement_id: id, p_reference: "A", p_note: null })).data).toBe("paid");
    expect((await s.rpc("payout_mark_paid", { p_statement_id: id, p_reference: "B", p_note: null })).data).toBe("already");
    await cleanup(s, org.id, users);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run supabase/tests/payout-statements.test.ts`
Expected: FAIL — relation `payout_statements` does not exist.

- [ ] **Step 4: Apply and re-run**

```bash
npx supabase@2.109.1 db push --linked
pnpm vitest run supabase/tests/payout-statements.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260807090300_payout_statements.sql supabase/tests/payout-statements.test.ts
git commit -m "feat(db): event-based payout statements with refund clawback

Statement amounts key on the payout stamp, not on payment status. Keying
on status alone made an entry refunded BEFORE its payout subtract money
the organizer was never given.

payout_clawback_id ensures a refund is recovered exactly once; without
it every later statement would re-subtract the same refund forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Flat-or-percent fee in `confirm.ts`

**Files:**
- Modify: `supabase/functions/_shared/confirm.ts:18-27`
- Create: `supabase/functions/_shared/fee.ts`
- Test: `supabase/tests/fee.test.ts`

**Interfaces:**
- Produces: `computeFee(total: number, org: FeeTerms): number` and `type FeeTerms = { commission_type: string; commission_rate: number | null; commission_flat_cents: number }`, exported from `supabase/functions/_shared/fee.ts`. Task 4 reuses it for retained-amount commission.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/tests/fee.test.ts
import { describe, it, expect } from "vitest";
import { computeFee } from "../functions/_shared/fee.ts";

const pct = (r: number) => ({ commission_type: "percent", commission_rate: r, commission_flat_cents: 0 });
const flat = (c: number) => ({ commission_type: "fixed", commission_rate: null, commission_flat_cents: c });

describe("computeFee", () => {
  it("takes a percentage of the entry", () => {
    expect(computeFee(200000, pct(0.10))).toBe(20000);
  });

  it("rounds a percentage to whole centavos", () => {
    expect(computeFee(33333, pct(0.10))).toBe(3333);
  });

  it("takes a flat amount regardless of entry price", () => {
    expect(computeFee(200000, flat(7500))).toBe(7500);
    expect(computeFee(150000, flat(7500))).toBe(7500);
  });

  it("CLAMPS a flat fee that exceeds the entry — net must never go negative", () => {
    // A ₱75 flat fee on a ₱60 entry would otherwise make net_to_org -₱15,
    // i.e. the organizer owing the platform money for a sale.
    expect(computeFee(6000, flat(7500))).toBe(6000);
  });

  it("charges nothing on a zero-value entry", () => {
    expect(computeFee(0, flat(7500))).toBe(0);
    expect(computeFee(0, pct(0.10))).toBe(0);
  });

  it("falls back to 10% when terms are missing", () => {
    expect(computeFee(200000, { commission_type: "percent", commission_rate: null, commission_flat_cents: 0 })).toBe(20000);
  });

  it("keeps fee + net === total for every case", () => {
    for (const [total, terms] of [
      [200000, pct(0.10)], [33333, pct(0.075)], [6000, flat(7500)], [0, flat(500)],
    ] as const) {
      const fee = computeFee(total, terms);
      expect(fee + (total - fee)).toBe(total);
      expect(fee).toBeGreaterThanOrEqual(0);
      expect(total - fee).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run supabase/tests/fee.test.ts`
Expected: FAIL — cannot resolve `../functions/_shared/fee.ts`

- [ ] **Step 3: Write the implementation**

```ts
// supabase/functions/_shared/fee.ts
/** The organization's commercial terms, as stored on `organizations`. */
export interface FeeTerms {
  commission_type: string;
  commission_rate: number | null;
  commission_flat_cents: number;
}

/**
 * The platform's commission on ONE registration, in centavos.
 *
 * The clamp is not optional. A flat fee larger than the entry price would make
 * `net_to_org` negative — the organizer owing the platform money for a sale
 * they made. `Math.min` floors net at zero, and incidentally handles a ₱0 entry
 * (a free event or a fully-discounted comp) with no special case.
 *
 * Callers pass the RETAINED amount, not the original, when a flat-fee refund
 * has reduced the sale — see _shared/refund.ts.
 */
export function computeFee(total: number, org: FeeTerms): number {
  if (total <= 0) return 0;
  if (org.commission_type === "fixed") {
    return Math.min(org.commission_flat_cents, total);
  }
  const rate = org.commission_rate ?? 0.10;
  return Math.min(Math.round(total * rate), total);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run supabase/tests/fee.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire it into `confirm.ts`**

The select must be widened, or a missed edit fails silently into the `?? 0.10` percent default rather than erroring.

In `supabase/functions/_shared/confirm.ts`, replace the select on line 18 and the fee calculation on lines 25-27:

```ts
import { computeFee, type FeeTerms } from "./fee.ts";
// ...
  const { data: reg } = await db
    .from("registrations")
    .select(
      "id,event_id,total_amount,status," +
      "organizations(commission_type,commission_rate,commission_flat_cents)",
    )
    .eq("id", registrationId)
    .single();
// ...
  const terms = (reg.organizations ?? {
    commission_type: "percent", commission_rate: 0.10, commission_flat_cents: 0,
  }) as FeeTerms;
  const fee = computeFee(reg.total_amount, terms);
  const net = reg.total_amount - fee;
```

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm -r typecheck
git add supabase/functions/_shared/fee.ts supabase/functions/_shared/confirm.ts supabase/tests/fee.test.ts
git commit -m "feat(payments): commission may be flat or a percentage

Clamps a flat fee at the entry total. Without it a flat fee larger than
a cheap entry makes net_to_org negative — the organizer owing the
platform for a sale they made.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Refund policy

**Files:**
- Create: `supabase/migrations/20260807090400_refund_policy_tx.sql`
- Modify: `supabase/functions/_shared/refund.ts:27-40`
- Test: `supabase/tests/refund-policy.test.ts`

**Interfaces:**
- Consumes: `computeFee` (Task 3); `organizations.refund_policy`, `refund_fee_cents` (Task 1).
- Produces: `refund_registration_tx(p_registration_id, p_refunded_by, p_note, p_provider_refund, p_refunded_amount int, p_retained_fee int, p_retained_net int) returns text` — returns `'refunded'`, `'partially_refunded'`, `'policy_forbids'`, `'already'`, `'not_paid'` or `'not_found'`.

- [ ] **Step 1: Extend the refund RPC**

```sql
-- supabase/migrations/20260807090400_refund_policy_tx.sql
-- Design 2026-08-06 §5, §9.6.
--
-- A refund returns the commission too: Race Pace gives back its platform_fee
-- alongside the organizer's net_to_org. Under a flat_fee policy the RETAINED
-- amount is treated as a smaller sale — the org's normal commission rule runs
-- against it — so the row keeps describing a real sale and every downstream sum
-- works unchanged.
--
-- The retained split is computed by the caller (functions/_shared/refund.ts via
-- computeFee) rather than here, so percent-vs-flat and its clamp live in exactly
-- one place instead of being reimplemented in PL/pgSQL.
create or replace function public.refund_registration_tx(
  p_registration_id uuid,
  p_refunded_by     uuid,
  p_note            text,
  p_provider_refund jsonb,
  p_refunded_amount int default null,
  p_retained_fee    int default 0,
  p_retained_net    int default 0
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status   public.registration_status;
  v_category uuid;
  v_raw      jsonb;
  v_amount   int;
  v_partial  boolean;
begin
  select r.status, r.category_id into v_status, v_category
    from public.registrations r where r.id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  select p.amount into v_amount
    from public.payments p where p.registration_id = p_registration_id;

  -- A partial refund leaves a real, smaller sale behind, so the registration
  -- stays 'paid' and the runner keeps their entry. Only a full refund cancels.
  v_partial := p_refunded_amount is not null and p_refunded_amount < v_amount;

  select p.raw into v_raw from public.payments p where p.registration_id = p_registration_id;

  if v_partial then
    update public.payments
       set status          = 'partially_refunded',
           refunded_amount = p_refunded_amount,
           amount          = v_amount - p_refunded_amount,
           platform_fee    = p_retained_fee,
           net_to_org      = p_retained_net,
           raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                   'refunded_at', now(), 'refunded_by', p_refunded_by,
                   'note', p_note, 'partial', true,
                   'original_amount', v_amount,
                   'provider_refund', p_provider_refund)
     where registration_id = p_registration_id;
    return 'partially_refunded';
  end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;
  update public.payments
     set status = 'refunded', refunded_amount = v_amount,
         raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(), 'refunded_by', p_refunded_by,
                 'note', p_note, 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;
  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category;

  return 'refunded';
end;
$$;

revoke all on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int) from public;
grant execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int) to service_role;
```

- [ ] **Step 2: Compute the policy in `refund.ts`**

Replace the payment fetch and provider call (`supabase/functions/_shared/refund.ts:27` and `:39`):

```ts
import { computeFee, type FeeTerms } from "./fee.ts";

// ...
  const { data: pay } = await db
    .from("payments")
    .select("provider,provider_ref,amount,raw,organizations!inner(refund_policy,refund_fee_cents,commission_type,commission_rate,commission_flat_cents)")
    .eq("registration_id", reg.id)
    .single();
  if (!pay) return { ok: false, error: "not_found", status: 404 };

  const org = pay.organizations as unknown as
    FeeTerms & { refund_policy: string; refund_fee_cents: number };

  // 'none' is refused here rather than in the UI alone: the console disables the
  // button, but the server is the boundary.
  if (org.refund_policy === "none") {
    return { ok: false, error: "policy_forbids", status: 409 };
  }

  // Retained becomes a smaller sale — the org's normal commission rule runs
  // against it, so nothing new has to be decided per refund.
  const retained = org.refund_policy === "flat_fee"
    ? Math.min(org.refund_fee_cents, pay.amount)
    : 0;
  const refundAmount = pay.amount - retained;
  const retainedFee = computeFee(retained, org);
  const retainedNet = retained - retainedFee;
```

then pass `amount: refundAmount` to `provider.refund(...)` and the three new args to the RPC.

- [ ] **Step 3: Write the failing test**

```ts
// supabase/tests/refund-policy.test.ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function fixture(tag: string, orgPatch: Record<string, unknown>) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  const org = (await s.from("organizations").insert({ name: "Refund Org", slug: stamp, ...orgPatch }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "R", status: "open" }).select().single()).data!;
  const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 200000, slots_total: 10, slots_taken: 1 }).select().single()).data!;
  const u = await s.auth.admin.createUser({ email: `rf_${stamp}@test.dev`, password: "password123", email_confirm: true });
  const reg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: u.data.user!.id, total_amount: 200000, status: "paid" }).select().single()).data!;
  await s.from("payments").insert({ org_id: org.id, registration_id: reg.id, amount: 200000, platform_fee: 20000, net_to_org: 180000, status: "paid", provider: "fake" });
  return { s, org, cat, reg, uid: u.data.user!.id };
}

describe("refund_registration_tx policy", () => {
  it("a full refund cancels the entry and frees the slot", async () => {
    const { s, org, cat, reg, uid } = await fixture("full", { refund_policy: "full" });
    const r = await s.rpc("refund_registration_tx", {
      p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
      p_refunded_amount: 200000, p_retained_fee: 0, p_retained_net: 0,
    });
    expect(r.data).toBe("refunded");
    const pay = (await s.from("payments").select("status,refunded_amount").eq("registration_id", reg.id).single()).data!;
    expect(pay.status).toBe("refunded");
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
    await s.from("organizations").delete().eq("id", org.id);
    await s.auth.admin.deleteUser(uid);
  });

  it("a flat-fee refund leaves a smaller sale, keeping fee + net === amount", async () => {
    const { s, org, cat, reg, uid } = await fixture("flat", {
      refund_policy: "flat_fee", refund_fee_cents: 30000,
      commission_type: "percent", commission_rate: 0.10,
    });
    // Retained ₱300 → fee ₱30, net ₱270. Runner gets ₱1,700 back.
    const r = await s.rpc("refund_registration_tx", {
      p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
      p_refunded_amount: 170000, p_retained_fee: 3000, p_retained_net: 27000,
    });
    expect(r.data).toBe("partially_refunded");
    const pay = (await s.from("payments").select("status,amount,platform_fee,net_to_org,refunded_amount").eq("registration_id", reg.id).single()).data!;
    expect(pay.status).toBe("partially_refunded");
    expect(pay.amount).toBe(30000);
    expect(pay.platform_fee + pay.net_to_org).toBe(pay.amount);
    expect(pay.refunded_amount).toBe(170000);
    // The entry survives, so the slot stays taken.
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);
    await s.from("organizations").delete().eq("id", org.id);
    await s.auth.admin.deleteUser(uid);
  });
});
```

- [ ] **Step 4: Apply, run, commit**

```bash
npx supabase@2.109.1 db push --linked
pnpm vitest run supabase/tests/refund-policy.test.ts
git add supabase/migrations/20260807090400_refund_policy_tx.sql supabase/functions/_shared/refund.ts supabase/tests/refund-policy.test.ts
git commit -m "feat(payments): per-org refund policy (full / none / flat fee)

A retained fee is treated as a smaller sale — the org's normal
commission rule runs against it, so the row keeps describing a real sale
and every downstream sum works unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Record the real payment method

**Files:**
- Modify: `supabase/functions/payment-verify/index.ts:52`
- Create: `supabase/migrations/20260807090500_backfill_payment_method.sql`

- [ ] **Step 1: Extract the instrument instead of the provider**

`payment-verify` already fetches the session; the webhook already parses the same shape (`payments-webhook/index.ts:28`). Replace line 52:

```ts
    // The INSTRUMENT the runner actually used (gcash / card / paymaya), not the
    // provider. This previously wrote the literal "paymongo", which made the
    // admin Payments method column useless for every redirect-confirmed row.
    // Same expression payments-webhook/index.ts uses, so both confirm paths
    // agree.
    const session = await pmGetCheckoutSession(ref);
    const method = (session as { attributes?: { payments?: { attributes?: { source?: { type?: string } } }[] } })
      ?.attributes?.payments?.[0]?.attributes?.source?.type ?? "paymongo";
    const r = await confirmPayment(registrationId, method, { source: "payment-verify", session_id: ref });
```

Reuse the existing `pmGetCheckoutSession(ref)` result already in scope if there is one rather than re-fetching — read the surrounding lines first.

- [ ] **Step 2: Backfill history from `payments.raw`**

```sql
-- supabase/migrations/20260807090500_backfill_payment_method.sql
-- Rows confirmed via the redirect path recorded the provider ("paymongo")
-- instead of the instrument. Each one stored the PayMongo session in
-- payments.raw, so the real value is recoverable rather than lost.
update payments
   set method = raw #>> '{event,data,attributes,payments,0,attributes,source,type}'
 where method = 'paymongo'
   and raw #>> '{event,data,attributes,payments,0,attributes,source,type}' is not null;

update payments
   set method = raw #>> '{attributes,payments,0,attributes,source,type}'
 where method = 'paymongo'
   and raw #>> '{attributes,payments,0,attributes,source,type}' is not null;
```

- [ ] **Step 3: Verify the backfill found something**

```bash
npx supabase@2.109.1 db push --linked
npx supabase@2.109.1 db query --linked "select method, count(*) from payments group by 1 order by 2 desc;"
```
Expected: any remaining `paymongo` rows are ones whose `raw` genuinely lacks the field. Report the counts — do not claim success without reading the output.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/payment-verify/index.ts supabase/migrations/20260807090500_backfill_payment_method.sql
git commit -m "fix(payments): record the instrument, not the provider

payment-verify hardcoded \"paymongo\" while the webhook correctly read
source.type, so the method depended on which path confirmed the payment.
Backfills history from payments.raw.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Super-admin org context (blocks Tasks 7 and 8)

**Files:**
- Create: `apps/web/lib/org-context.ts`
- Create: `apps/web/lib/org-context.test.ts`
- Create: `apps/web/components/OrgSwitcher.tsx`
- Create: `apps/web/lib/actions/set-active-org.ts`
- Modify: `apps/web/lib/queries/roles.ts`
- Modify: `apps/web/components/TopBar.tsx`

**Interfaces:**
- Produces: `pickActiveOrg(orgIds: string[], stored: string | null): string | null`; `ACTIVE_ORG_COOKIE = "rp-active-org"`; `getOrgContext(): Promise<{ availableOrgs: OrgOption[]; activeOrgId: string | null; isSuperAdmin: boolean; canSwitch: boolean }>` where `OrgOption = { orgId: string; name: string }`. `getMyRoles()` gains `orgId` resolved from the cookie for a super admin — every existing org-scoped page keeps working unchanged.

- [ ] **Step 1: Write the failing test for the pure selection rule**

Ported from the Vite worktree's `org-switcher.test.tsx`, which already covered this.

```ts
// apps/web/lib/org-context.test.ts
import { describe, it, expect } from "vitest";
import { pickActiveOrg } from "./org-context";

const IDS = ["org-a", "org-b"];

describe("pickActiveOrg", () => {
  it("honours a stored id that is still available", () => {
    expect(pickActiveOrg(IDS, "org-b")).toBe("org-b");
  });

  it("falls back to the first org when nothing is stored", () => {
    expect(pickActiveOrg(IDS, null)).toBe("org-a");
  });

  it("ignores a stored org that is no longer available", () => {
    // An org is deleted, or access revoked, between sessions. Trusting the
    // stored id pins the console to an org whose every query returns nothing,
    // which reads as "the app is broken" rather than "you lost that org".
    expect(pickActiveOrg(IDS, "org-deleted")).toBe("org-a");
  });

  it("returns null when there are no orgs at all", () => {
    expect(pickActiveOrg([], "org-a")).toBeNull();
    expect(pickActiveOrg([], null)).toBeNull();
  });

  it("is stable — re-picking with the resolved value keeps it put", () => {
    const first = pickActiveOrg(IDS, null);
    expect(pickActiveOrg(IDS, first)).toBe(first);
  });

  it("treats an empty stored string as absent", () => {
    expect(pickActiveOrg(IDS, "")).toBe("org-a");
  });

  it("pins to the single org when the caller cannot switch", () => {
    // Callers pass stored=null for an account that cannot switch, so a leftover
    // preference from a super-admin session on the same browser can never move
    // an org admin off their own org.
    expect(pickActiveOrg(["org-a"], null)).toBe("org-a");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && pnpm vitest run lib/org-context.test.ts`
Expected: FAIL — cannot resolve `./org-context`

- [ ] **Step 3: Implement the context module**

A **cookie**, not `localStorage`: `apps/web` resolves roles in Server Components, which cannot read `localStorage`. A cookie is readable server-side, so the selection survives SSR with no client round trip and no flash of the wrong org.

```ts
// apps/web/lib/org-context.ts
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

export const ACTIVE_ORG_COOKIE = "rp-active-org";

export type OrgOption = { orgId: string; name: string };

/**
 * Which org to open with. Pure so the rule is testable without a browser.
 *
 * `stored` is VALIDATED against the available list rather than trusted: an org
 * can be deleted, or access revoked, between sessions, and an unvalidated id
 * then pins the console to an org whose every query returns nothing.
 *
 * Callers pass `stored: null` when the account cannot switch — a remembered
 * preference is meaningless when there is no choice to remember, and it stops a
 * leftover super-admin preference moving an org admin off their own org.
 */
export function pickActiveOrg(orgIds: string[], stored: string | null): string | null {
  if (stored && orgIds.includes(stored)) return stored;
  return orgIds[0] ?? null;
}

/**
 * Cross-org switching is a super_admin capability by design
 * (docs/00-product-overview.md §8) — gated on the ROLE, not on how many
 * memberships a caller happens to hold.
 *
 * This is a UI affordance, not the security boundary. Every staff-facing policy
 * is `auth_can_admin_org(org_id)`, which the database enforces independently.
 * Hiding the switcher only stops the console offering a door the DB would slam.
 */
export const getOrgContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { availableOrgs: [], activeOrgId: null, isSuperAdmin: false, canSwitch: false };

  const { data: roleRows } = await supabase.from("user_roles").select("role, org_id").order("org_id");
  const rows = roleRows ?? [];
  const isSuperAdmin = rows.some((r) => r.role === "super_admin");

  const { data: orgRows } = await supabase.from("organizations").select("id,name").order("name");
  const allOrgs = orgRows ?? [];

  const managed = new Set(
    rows.filter((r) => r.org_id && (r.role === "admin" || r.role === "editor")).map((r) => r.org_id!),
  );
  const availableOrgs: OrgOption[] = (isSuperAdmin ? allOrgs : allOrgs.filter((o) => managed.has(o.id)))
    .map((o) => ({ orgId: o.id, name: o.name }));

  const canSwitch = isSuperAdmin && availableOrgs.length > 1;
  const stored = canSwitch ? (await cookies()).get(ACTIVE_ORG_COOKIE)?.value ?? null : null;

  return {
    availableOrgs,
    activeOrgId: pickActiveOrg(availableOrgs.map((o) => o.orgId), stored),
    isSuperAdmin,
    canSwitch,
  };
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && pnpm vitest run lib/org-context.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Resolve `orgId` for a super admin in `roles.ts`**

Today `getMyRoles()` returns `orgId: null` for a super admin with no org-scoped row, so every org-scoped page renders `<NoOrgScope />`. Fall back to the selected org — this alone unblocks Dashboard and Check-in for `admin@racepace.test`.

In `apps/web/lib/queries/roles.ts`, after `resolvedRow` is computed, replace the `orgId` field:

```ts
  // A super admin legitimately has no org-scoped admin/editor row. Rather than
  // leaving orgId null — which sends every org-scoped page to <NoOrgScope /> —
  // fall back to the org they have selected. This is the "KNOWN LIMITATION"
  // noted above finally being resolved for the super-admin case.
  const orgCtx = isSuperAdmin ? await getOrgContext() : null;

  return {
    role: isSuperAdmin ? "super_admin" : resolvedRow?.role ?? rows[0]?.role ?? null,
    orgId: resolvedRow?.org_id ?? orgCtx?.activeOrgId ?? null,
    // ... unchanged
```

with `import { getOrgContext } from "@/lib/org-context";` at the top. Both are `cache()`d, so this adds no extra round trip per request.

- [ ] **Step 6: Add the Server Action and the switcher**

```ts
// apps/web/lib/actions/set-active-org.ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ACTIVE_ORG_COOKIE } from "@/lib/org-context";
import { getOrgContext } from "@/lib/org-context";

/** Switching is re-authorized here, not just hidden in the UI: a Server Action
 *  is a public endpoint. The org must be one this caller may actually act as. */
export async function setActiveOrg(orgId: string) {
  const { availableOrgs, canSwitch } = await getOrgContext();
  if (!canSwitch || !availableOrgs.some((o) => o.orgId === orgId)) return;

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
```

`OrgSwitcher.tsx` is a Client Component rendering a `DropdownMenu` of `availableOrgs` that calls `setActiveOrg`. An org admin gets a plain `Badge` instead — a menu holding one already-selected item promises a choice it cannot keep. Port the markup from the Vite version at `.claude/worktrees/event-registration-web-fff722/apps/web/src/components/OrgSwitcher.tsx`, swapping `useOrgContext()` for props and `setActiveOrg` for the action.

Render it in `TopBar.tsx` to the right of the page title.

- [ ] **Step 7: Verify manually, then commit**

```bash
cd apps/web && pnpm typecheck && pnpm vitest run
```

Then sign in as `admin@racepace.test` and confirm `/dashboard` no longer shows "No organization on this account", and that switching orgs changes the Registrations list.

```bash
git add apps/web/lib/org-context.ts apps/web/lib/org-context.test.ts apps/web/components/OrgSwitcher.tsx apps/web/lib/actions/set-active-org.ts apps/web/lib/queries/roles.ts apps/web/components/TopBar.tsx
git commit -m "feat(admin): super-admin org switcher, cookie-backed

Server Components resolve roles and cannot read localStorage, so the
selection lives in a cookie — no client round trip, no flash of the
wrong org. The Server Action re-authorizes rather than trusting the UI.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 1 — Pages (parallelisable)

**Page markup is specified by the mockups, not by this plan.** Rather than inlining 200 lines
of JSX per page here, each page's layout, copy, states and empty states are defined precisely in:

- `docs/superpowers/specs/2026-08-06-platform-pages-design-directions.html` — **tab B** is the
  chosen direction (dashboard, scope band, table shapes)
- `docs/superpowers/specs/2026-08-06-checkin-scanner-first.html` — check-in
- `docs/superpowers/specs/2026-08-06-commission-payouts-money-flow.html` — commission, payouts,
  payments method column

Open the relevant file before writing a page. Translate its markup to shadcn/ui primitives and
design tokens — the mockups use raw CSS variables of the same names, so `background: var(--card)`
becomes `bg-card`, `#159a55` is `--color-primary`, and the dark check-in surface is
`--color-forest`. Do not invent layout the mockups do not show, and do not drop the explanatory
strips (the amber non-retroactive warning, the red flat-fee clamp warning, the "Held" reason) —
those carry the reasoning the page exists to communicate.

Each task below is independent once Phase 0 has landed. Every page follows the same shell:

```tsx
export default async function XPage() {
  const roles = await getMyRoles();
  const orgId = requireOrgId(roles);            // org-scoped pages only
  if (!orgId) return <NoOrgScope />;            // never query with a null id
  // ...
}
```

Super-admin pages instead guard on `roles?.isSuperAdmin` and render `notFound()` otherwise — the nav already hides them (`lib/nav-items.ts#visibleSuperItems`), but a typed URL must not reach the page.

---

### Task 7: Dashboard

**Files:**
- Create: `supabase/migrations/20260807090600_org_signups_daily.sql`
- Create: `apps/web/lib/queries/dashboard.ts`
- Create: `apps/web/lib/queries/dashboard.test.ts`
- Create: `apps/web/components/SignupsChart.tsx`
- Create: `apps/web/components/FillRatePanel.tsx`
- Modify: `apps/web/app/(admin)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getMyRoles`, `requireOrgId`, `KpiCard`, `KpiRow`, `peso`.
- Produces: `getOrgDashboard(orgId): Promise<DashboardData>`; `buildSparkPath(points: {d: string; n: number}[], w: number, h: number): { line: string; area: string }`.

- [ ] **Step 1: Add the time-series RPC**

```sql
-- supabase/migrations/20260807090600_org_signups_daily.sql
-- Daily sign-ups for the dashboard chart. generate_series so days with zero
-- registrations still produce a point — otherwise the line interpolates across
-- a quiet week and invents a trend that never happened.
create or replace function public.admin_org_signups_daily(p_org_id uuid, p_days int default 30)
returns table (d date, n int)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.d::date, coalesce(count(r.id), 0)::int
  from generate_series(current_date - (p_days - 1), current_date, interval '1 day') g(d)
  left join public.registrations r
    on r.org_id = p_org_id and r.created_at::date = g.d::date
  group by g.d
  order by g.d;
$$;

grant execute on function public.admin_org_signups_daily(uuid, int) to authenticated;
```

- [ ] **Step 2: Write the failing test for the chart geometry**

The SVG path builder is the only non-trivial pure logic on this page.

```ts
// apps/web/lib/queries/dashboard.test.ts
import { describe, it, expect } from "vitest";
import { buildSparkPath } from "./dashboard";

describe("buildSparkPath", () => {
  it("spans the full width and inverts y so higher values sit higher", () => {
    const { line } = buildSparkPath([{ d: "a", n: 0 }, { d: "b", n: 10 }], 100, 50);
    expect(line).toBe("M0 50 L100 0");
  });

  it("keeps a flat series on a mid-height line rather than dividing by zero", () => {
    const { line } = buildSparkPath([{ d: "a", n: 5 }, { d: "b", n: 5 }], 100, 50);
    expect(line).toBe("M0 25 L100 25");
  });

  it("closes the area path back to the baseline", () => {
    const { area } = buildSparkPath([{ d: "a", n: 0 }, { d: "b", n: 10 }], 100, 50);
    expect(area.endsWith("V50 H0 Z")).toBe(true);
  });

  it("returns empty paths for an empty series", () => {
    expect(buildSparkPath([], 100, 50)).toEqual({ line: "", area: "" });
  });

  it("handles a single point without NaN", () => {
    const { line } = buildSparkPath([{ d: "a", n: 3 }], 100, 50);
    expect(line).not.toContain("NaN");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/web && pnpm vitest run lib/queries/dashboard.test.ts`
Expected: FAIL — `buildSparkPath` is not exported

- [ ] **Step 4: Implement the query module**

```ts
// apps/web/lib/queries/dashboard.ts
import { createClient } from "@/lib/supabase/server";

export type SignupPoint = { d: string; n: number };
export type FillRow = { eventId: string; name: string; taken: number; total: number };
export type DashboardData = {
  regCount: number; grossRevenue: number; netToOrg: number; pendingCount: number;
  signups: SignupPoint[]; fill: FillRow[];
};

/**
 * SVG geometry for the sign-ups sparkline.
 *
 * Hand-rolled rather than pulling in a chart library: one series, no zoom, no
 * legend. Recharts is ~90 KB for this.
 *
 * A flat series is the case worth naming — max === min would divide by zero, so
 * it renders on a mid-height line instead of collapsing to the baseline (which
 * would read as "no sign-ups" rather than "a steady rate").
 */
export function buildSparkPath(points: SignupPoint[], w: number, h: number): { line: string; area: string } {
  if (points.length === 0) return { line: "", area: "" };
  const max = Math.max(...points.map((p) => p.n));
  const min = Math.min(...points.map((p) => p.n));
  const span = max - min;
  const x = (i: number) => (points.length === 1 ? 0 : (i / (points.length - 1)) * w);
  const y = (n: number) => (span === 0 ? h / 2 : h - ((n - min) / span) * h);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(p.n)}`).join(" ");
  return { line, area: `${line} V${h} H0 Z` };
}

export async function getOrgDashboard(orgId: string): Promise<DashboardData> {
  const supabase = await createClient();

  const [totals, signups, cats] = await Promise.all([
    supabase.from("admin_org_totals_v")
      .select("reg_count,paid_count,pending_count,gross_revenue,net_to_org")
      .eq("org_id", orgId).maybeSingle(),
    supabase.rpc("admin_org_signups_daily", { p_org_id: orgId, p_days: 30 }),
    supabase.from("categories")
      .select("event_id,slots_total,slots_taken,events!inner(id,name,status)")
      .eq("org_id", orgId),
  ]);

  // Capacity lives on categories, not events — an event's fill rate is the sum
  // across its categories. Events with no slots_total are omitted rather than
  // shown at 0%, which would read as "nobody signed up" for an uncapped race.
  const byEvent = new Map<string, FillRow>();
  for (const c of (cats.data ?? []) as unknown as
    { event_id: string; slots_total: number | null; slots_taken: number | null;
      events: { id: string; name: string; status: string } }[]) {
    if (!c.slots_total) continue;
    const row = byEvent.get(c.event_id) ?? { eventId: c.event_id, name: c.events.name, taken: 0, total: 0 };
    row.taken += c.slots_taken ?? 0;
    row.total += c.slots_total;
    byEvent.set(c.event_id, row);
  }

  return {
    regCount: totals.data?.reg_count ?? 0,
    grossRevenue: Number(totals.data?.gross_revenue ?? 0),
    netToOrg: Number(totals.data?.net_to_org ?? 0),
    pendingCount: totals.data?.pending_count ?? 0,
    signups: (signups.data ?? []) as SignupPoint[],
    fill: [...byEvent.values()].sort((a, b) => b.taken / b.total - a.taken / a.total).slice(0, 5),
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/web && pnpm vitest run lib/queries/dashboard.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Build the page**

`SignupsChart.tsx` renders the two paths inside an `<svg role="img" aria-label="...">` with a text summary for screen readers (charts alone are not screen-reader friendly). `FillRatePanel.tsx` renders one bullet bar per event: `text-primary` above 80%, `text-amber` 40-80%, `text-info` below.

`page.tsx` composes: `KpiRow` with Registrations / Gross revenue / Net to org / Awaiting payment, then the two-column chart + fill panel, then an upcoming-events table. A new org with no events renders a create-first-event prompt, not four zeros.

- [ ] **Step 7: Verify and commit**

```bash
cd apps/web && pnpm typecheck && pnpm vitest run && pnpm build
git add supabase/migrations/20260807090600_org_signups_daily.sql apps/web/lib/queries/dashboard.ts apps/web/lib/queries/dashboard.test.ts apps/web/components/SignupsChart.tsx apps/web/components/FillRatePanel.tsx "apps/web/app/(admin)/dashboard/page.tsx"
git commit -m "feat(admin): dashboard with sign-ups trend and fill rate

Sparkline is hand-rolled SVG, not a chart library — one series, no zoom,
no legend, and Recharts is ~90 KB for that. Fill rate sums categories,
since capacity lives there rather than on events.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Check-in

**Files:**
- Create: `supabase/migrations/20260807090700_checkin_undo.sql`
- Create: `apps/web/lib/checkin.ts`
- Create: `apps/web/lib/checkin.test.ts`
- Create: `apps/web/app/(admin)/check-in/scanner.tsx`
- Create: `apps/web/app/(admin)/check-in/roster.tsx`
- Modify: `apps/web/app/(admin)/check-in/page.tsx`
- Modify: `apps/web/package.json` (add `jsqr`)

**Interfaces:**
- Consumes: `checkin_events()`, `checkin_roster(p_event_id)`, the `check-in` Edge Function.
- Produces: `isTicketTokenShape(s: string): boolean`; `splitRoster(rows: RosterRow[]): { pending: RosterRow[]; done: RosterRow[] }`; `filterRoster(rows, q, category): RosterRow[]`.

- [ ] **Step 1: Add the undo RPC**

```sql
-- supabase/migrations/20260807090700_checkin_undo.sql
-- Mis-scans at a start line are common and there is no delete path today.
-- Authorized by the same helper the scan path uses, so undo can never be
-- available to someone who could not have checked the runner in.
create or replace function public.checkin_undo(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid; v_event uuid;
begin
  select r.org_id, r.event_id into v_org, v_event
    from public.registrations r where r.id = p_registration_id;
  if v_org is null then return 'not_found'; end if;
  if not public.auth_can_check_in_event(v_org, v_event) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.checkins where registration_id = p_registration_id;
  return 'undone';
end;
$$;

revoke all on function public.checkin_undo(uuid) from public;
grant execute on function public.checkin_undo(uuid) to authenticated;
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/lib/checkin.test.ts
import { describe, it, expect } from "vitest";
import { isTicketTokenShape, splitRoster, filterRoster } from "./checkin";

const row = (o: Partial<Parameters<typeof splitRoster>[0][0]>) => ({
  registration_id: "r", ticket_token: "t", runner: "Aleth Ramos", bib: "ALETH",
  category: "50K", status: "paid", checked_in_at: null, ...o,
} as Parameters<typeof splitRoster>[0][0]);

describe("isTicketTokenShape", () => {
  it("accepts a base64url payload.signature", () => {
    expect(isTicketTokenShape("eyJyaWQiOiJhYmMifQ.c2ln-X_9")).toBe(true);
  });

  it("rejects a token mangled by a non-US keyboard layout", () => {
    // A wedge scanner on the wrong layout mistranslates the - and _ that
    // base64url uses. Catching it here lets the UI say "check your scanner
    // layout" instead of the useless "invalid ticket".
    expect(isTicketTokenShape("eyJyaWQiOiJhYmMifQ.c2ln/X+9")).toBe(false);
  });

  it("rejects text with no separator", () => {
    expect(isTicketTokenShape("justsometext")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isTicketTokenShape("")).toBe(false);
  });
});

describe("splitRoster", () => {
  it("splits on checked_in_at", () => {
    const { pending, done } = splitRoster([
      row({ registration_id: "a" }),
      row({ registration_id: "b", checked_in_at: "2026-08-24T00:14:00Z" }),
    ]);
    expect(pending.map((r) => r.registration_id)).toEqual(["a"]);
    expect(done.map((r) => r.registration_id)).toEqual(["b"]);
  });

  it("orders the checked-in list most recent first", () => {
    const { done } = splitRoster([
      row({ registration_id: "a", checked_in_at: "2026-08-24T00:10:00Z" }),
      row({ registration_id: "b", checked_in_at: "2026-08-24T00:14:00Z" }),
    ]);
    expect(done.map((r) => r.registration_id)).toEqual(["b", "a"]);
  });
});

describe("filterRoster", () => {
  it("matches on runner name, case-insensitively", () => {
    expect(filterRoster([row({}), row({ runner: "Bea Molina" })], "bea", "all")).toHaveLength(1);
  });

  it("matches on bib", () => {
    expect(filterRoster([row({}), row({ bib: "MIGGY" })], "miggy", "all")).toHaveLength(1);
  });

  it("filters by category", () => {
    expect(filterRoster([row({}), row({ category: "21K" })], "", "21K")).toHaveLength(1);
  });

  it("returns everything for an empty query and 'all'", () => {
    expect(filterRoster([row({}), row({ runner: "X" })], "  ", "all")).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run to verify it fails, then implement**

Run: `cd apps/web && pnpm vitest run lib/checkin.test.ts` → FAIL

```ts
// apps/web/lib/checkin.ts
export type RosterRow = {
  registration_id: string; ticket_token: string; runner: string;
  bib: string | null; category: string; status: string; checked_in_at: string | null;
};

/**
 * Shape check for a scanned ticket, run BEFORE hitting the network.
 *
 * The token is base64url `payload.signature` (functions/_shared/ticket.ts). A
 * hardware wedge scanner on a non-US keyboard layout mistranslates the `-` and
 * `_` that base64url uses, producing `/` and `+`. Catching that here lets the UI
 * say "check your scanner's keyboard layout" instead of "invalid ticket", which
 * would send a marshal hunting for a problem with the runner's phone.
 *
 * This is NOT verification. The HMAC is checked server-side by the `check-in`
 * Edge Function — matching client-side against the roster's ticket_token would
 * accept a screenshot of someone else's QR.
 */
export function isTicketTokenShape(s: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
}

/** One roster query feeds both tables: split on whether the runner is in yet. */
export function splitRoster(rows: RosterRow[]): { pending: RosterRow[]; done: RosterRow[] } {
  const pending = rows.filter((r) => !r.checked_in_at);
  const done = rows.filter((r) => r.checked_in_at)
    .sort((a, b) => (b.checked_in_at ?? "").localeCompare(a.checked_in_at ?? ""));
  return { pending, done };
}

/** Client-side over rows already in memory — instant, and no round trip on a
 *  connection that may be barely alive at a mountain start line. */
export function filterRoster(rows: RosterRow[], q: string, category: string): RosterRow[] {
  const term = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (category !== "all" && r.category !== category) return false;
    if (!term) return true;
    return r.runner.toLowerCase().includes(term) || (r.bib ?? "").toLowerCase().includes(term);
  });
}
```

Run again → PASS (10 tests)

- [ ] **Step 4: Add jsQR and build the client components**

```bash
cd apps/web && pnpm add jsqr
```

`scanner.tsx` (Client Component):
- A permanently-focused visually-hidden `<input>` catches wedge keystrokes; `onKeyDown` Enter submits the buffer. This is the **primary** input — no driver, no permission, no library.
- A "Start camera" toggle opens `getUserMedia({ video: { facingMode: "environment" } })` and decodes frames with jsQR on `requestAnimationFrame`.
- Both funnel into one `submitScan(token)` that shape-checks (`isTicketTokenShape`), then POSTs to the `check-in` Edge Function.
- Result rendering: `ok` → green tick + runner name; `already: true` → **amber** "already checked in at HH:MM" (never green — a double-scan must not read as a fresh success); `not_paid` → blocked.

`roster.tsx` (Client Component) takes the roster as a prop, renders the two tables with a search box and category chips, a **Check in** button per pending row (disabled with "Blocked" for unpaid — the Edge Function already returns `not_paid` 409, so the row reflects a server rule), and **Undo** per checked-in row.

`page.tsx` (Server Component) resolves the event, calls `checkin_roster`, and renders the dark `--color-forest` scan bar above the two tables.

- [ ] **Step 5: Verify and commit**

```bash
cd apps/web && pnpm typecheck && pnpm vitest run && pnpm build
```

```bash
git add supabase/migrations/20260807090700_checkin_undo.sql apps/web/lib/checkin.ts apps/web/lib/checkin.test.ts "apps/web/app/(admin)/check-in" apps/web/package.json
git commit -m "feat(admin): race-day check-in, scanner first

A hardware 2D imager is the primary input — it is a keyboard wedge, so
no driver, no decode library, no camera permission. Camera and manual
roster are fallbacks that are always present, not modes.

Scans are verified server-side by the check-in function: the roster
carries ticket tokens, but matching locally would accept a screenshot of
someone else's QR.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Organizations

**Files:**
- Create: `supabase/functions/org-provision/index.ts`
- Create: `apps/web/lib/queries/organizations.ts`
- Create: `apps/web/app/(admin)/organizations/new-org-dialog.tsx`
- Modify: `apps/web/app/(admin)/organizations/page.tsx`

- [ ] **Step 1: Write the provisioning function**

Service role. Mirrors `org-members/index.ts:87` for the invite so the email path is identical and already SMTP-ready.

```ts
// supabase/functions/org-provision/index.ts
// Super-admin only. Creates an organization AND invites its first admin.
//
// Both halves are required: an org row nobody can log into is inert, and /team
// is unreachable until someone can. The invite uses the same
// auth.admin.inviteUserByEmail call as org-members, which sends through whatever
// SMTP Supabase is configured with — so the email path starts working the moment
// SMTP is set up, with no code change. Until then the action link is returned
// for manual delivery.
```

Reject non-super-admin callers. **Reject a flat commission of ₱0** — the column default is ₱0 and that is never what anyone means, so provisioning must not create an org Race Pace earns nothing from. Return `{ ok, org, invite_link }`.

- [ ] **Step 2: Build the page**

Super-admin guard, scope band, KPI row (orgs / platform GMV / commission earned / owed to orgs), then a table joining `organizations` with `admin_org_totals_v`. "+ New organization" opens a dialog collecting name, slug (availability checked on blur against the existing unique constraint), first admin email, commission type + value, refund policy + retention.

- [ ] **Step 3: Deploy, verify, commit**

```bash
npx supabase@2.109.1 functions deploy org-provision
cd apps/web && pnpm typecheck && pnpm build
git add supabase/functions/org-provision apps/web/lib/queries/organizations.ts "apps/web/app/(admin)/organizations"
git commit -m "feat(admin): organizations list and provisioning

Provisioning creates the org and invites its first admin in one step —
an org nobody can log into is inert, and /team is unreachable until
someone can. Rejects a zero flat commission rather than creating an
organization the platform earns nothing from.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Commission

**Files:**
- Create: `supabase/migrations/20260807090800_commission_update_policy.sql`
- Create: `apps/web/lib/queries/commission.ts`
- Create: `apps/web/lib/queries/commission.test.ts`
- Create: `apps/web/app/(admin)/commission/terms-row.tsx`
- Modify: `apps/web/app/(admin)/commission/page.tsx`

**Interfaces:**
- Produces: `rateToPercent(n: number): number`, `percentToRate(n: number): number`, `describeRefund(terms): string`.

- [ ] **Step 1: Add the UPDATE policy**

```sql
-- supabase/migrations/20260807090800_commission_update_policy.sql
-- 20260724140000_scope_org_update_grant.sql scoped the column-level UPDATE
-- grant. Verify with has_column_privilege before assuming it covers the new
-- columns — hosted `organizations` has had table-level grant drift before, which
-- is exactly how the branding editor broke.
grant update (commission_type, commission_rate, commission_flat_cents,
              refund_policy, refund_fee_cents)
  on organizations to authenticated;

create policy organizations_super_admin_terms on organizations
  for update using (auth_is_super_admin()) with check (auth_is_super_admin());
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/lib/queries/commission.test.ts
import { describe, it, expect } from "vitest";
import { rateToPercent, percentToRate, describeRefund } from "./commission";

describe("rate conversion", () => {
  it("shows a stored fraction as a percentage", () => {
    expect(rateToPercent(0.10)).toBe(10);
    expect(rateToPercent(0.085)).toBe(8.5);
  });

  it("stores a typed percentage as a fraction", () => {
    // The DB must never see 10 meaning 10% — that would be a 1000% fee.
    expect(percentToRate(10)).toBe(0.1);
    expect(percentToRate(8.5)).toBe(0.085);
  });

  it("round-trips without drift", () => {
    for (const p of [0, 2.5, 8.5, 10, 12.75, 100]) {
      expect(rateToPercent(percentToRate(p))).toBeCloseTo(p, 6);
    }
  });
});

describe("describeRefund", () => {
  it("spells out a flat-fee split in pesos", () => {
    expect(describeRefund({
      refund_policy: "flat_fee", refund_fee_cents: 30000,
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    }, 200000)).toBe("Gets ₱1,700.00 back. Of the ₱300.00 retained, ₱30.00 is commission and ₱270.00 goes to the organizer.");
  });

  it("says nobody keeps anything on a full refund", () => {
    expect(describeRefund({
      refund_policy: "full", refund_fee_cents: 0,
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    }, 150000)).toBe("Gets all ₱1,500.00 back. Neither the organizer nor Race Pace keeps anything.");
  });

  it("says refunds are refused under 'none'", () => {
    expect(describeRefund({
      refund_policy: "none", refund_fee_cents: 0,
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    }, 150000)).toBe("Refunds are not offered. The entry stands as a paid sale.");
  });
});
```

- [ ] **Step 3: Implement, run, then build the page**

`describeRefund` reuses the same clamp-and-commission logic as `computeFee` — a retained fee is a smaller sale.

The page renders: super-admin guard, scope band, KPI row (commission earned with `₱X returned on N refunds` as its caption, GMV, effective rate, passed to orgs), the **rate per organization** table with a `%`/`₱` toggle per row, a persistent amber strip naming the non-retroactive consequence in concrete terms, a red flag on any org at ₱0 flat, the **refund policy** table with the live worked example, and **commission by event**.

- [ ] **Step 4: Verify and commit**

```bash
cd apps/web && pnpm typecheck && pnpm vitest run && pnpm build
git add supabase/migrations/20260807090800_commission_update_policy.sql apps/web/lib/queries/commission.ts apps/web/lib/queries/commission.test.ts "apps/web/app/(admin)/commission"
git commit -m "feat(admin): commission and refund terms per organization

Says out loud that a rate change is never retroactive — the fee is
frozen onto each payment at confirmation, and an operator dropping a
rate will otherwise assume it applies to existing entries.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Payouts

**Files:**
- Create: `apps/web/lib/queries/payouts.ts`
- Create: `apps/web/lib/queries/payouts.test.ts`
- Create: `apps/web/app/(admin)/payouts/statement-actions.tsx`
- Modify: `apps/web/app/(admin)/payouts/page.tsx`

**Interfaces:**
- Consumes: `payout_open_statement`, `payout_mark_paid` (Task 2).
- Produces: `payoutRowState(row): "ready" | "held" | "paid" | "owed_back"`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/queries/payouts.test.ts
import { describe, it, expect } from "vitest";
import { payoutRowState } from "./payouts";

const base = { status: "open", net_owed_cents: 100000, event_finished: true };

describe("payoutRowState", () => {
  it("is ready when the event finished and money is owed", () => {
    expect(payoutRowState(base)).toBe("ready");
  });

  it("is held while the event is still running", () => {
    // Greyed with a reason rather than hidden: when an organizer asks "where's
    // my money for Dumalinao?", the operator should read the answer off screen.
    expect(payoutRowState({ ...base, event_finished: false })).toBe("held");
  });

  it("is paid once settled", () => {
    expect(payoutRowState({ ...base, status: "paid" })).toBe("paid");
  });

  it("is owed_back when clawbacks exceed new earnings", () => {
    // A negative row must never render as a payment instruction — that is how
    // someone transfers the money in the wrong direction.
    expect(payoutRowState({ ...base, net_owed_cents: -270000 })).toBe("owed_back");
  });

  it("treats a settled negative statement as paid, not owed_back", () => {
    expect(payoutRowState({ status: "paid", net_owed_cents: -270000, event_finished: true })).toBe("paid");
  });
});
```

- [ ] **Step 2: Run to verify it fails, implement, re-run**

Run: `cd apps/web && pnpm vitest run lib/queries/payouts.test.ts` → FAIL → implement → PASS (5 tests)

- [ ] **Step 3: Build the page**

Super-admin guard, scope band, KPI row (ready to pay / total owed / held / paid this month), then one row per event: gross → commission → refunds → net owed, with **Mark paid** on ready rows, a disabled **Locked** on held rows with the reason inline, and **Record recovery** on `owed_back` rows. Opening a statement for an unfinished event is allowed but confirms first via `AlertDialog`.

- [ ] **Step 4: Verify and commit**

```bash
cd apps/web && pnpm typecheck && pnpm vitest run && pnpm build
git add apps/web/lib/queries/payouts.ts apps/web/lib/queries/payouts.test.ts "apps/web/app/(admin)/payouts"
git commit -m "feat(admin): event-based payout statements

A negative balance renders as 'Owed back by org' with a Record recovery
action rather than as a payout of minus money — manual opening makes
that state reachable, and a negative row that reads as a payment
instruction is how someone transfers it the wrong way.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Payments method column

**Files:**
- Create: `apps/web/components/MethodBadge.tsx`
- Modify: `apps/web/app/(admin)/payments/payments-table.tsx`
- Modify: `apps/web/lib/queries/payments.ts`

**Depends on Task 5** — without the extraction fix the column reads "paymongo" on every redirect-confirmed row.

- [ ] **Step 1: Build the badge**

`admin_payments_v` already selects `p.method`, so no view change. `MethodBadge` maps `gcash` / `paymaya` / `card` / `visa` / `mastercard` to the same PNGs the public site uses (`apps/site/public/payments/`), copied into `apps/web/public/payments/` so one GCash mark appears across the product. An unpaid row renders "Not yet paid", not a blank cell.

- [ ] **Step 2: Add the column and filter**

Insert a Method column into the payments table. Add a method filter alongside the existing event/status filters, with values from the **distinct set actually present** rather than a hardcoded list — PayMongo can add instruments.

- [ ] **Step 3: Verify and commit**

```bash
cd apps/web && pnpm typecheck && pnpm vitest run && pnpm build
git add apps/web/components/MethodBadge.tsx "apps/web/app/(admin)/payments" apps/web/lib/queries/payments.ts apps/web/public/payments
git commit -m "feat(admin): show which method a runner paid with

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `pnpm -r typecheck`
- [ ] `pnpm test` (root — backend suites)
- [ ] `cd apps/web && pnpm vitest run`
- [ ] `cd apps/web && pnpm build`
- [ ] Sign in as `admin@racepace.test` (super admin): all five pages render, org switcher works
- [ ] Sign in as `muspo@racepace.test` (org admin): the three platform pages are absent from the nav and a typed URL 404s
- [ ] Cross-org probe: an org admin reading `payout_statements` gets zero rows
