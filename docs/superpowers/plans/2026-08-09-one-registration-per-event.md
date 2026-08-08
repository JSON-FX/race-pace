# One Registration Per Event — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runner holds at most one live (`pending` or `paid`) registration per event, enforced by the database, with unpaid entries expiring after 24 hours or when the event closes.

**Architecture:** A partial unique index on `registrations (event_id, user_id) WHERE status IN ('pending','paid')` is the enforcement point — application checks race, indexes do not. A new `expired` status plus an `expires_at` column lets abandoned checkouts fall out of the index automatically, swept by pg_cron and backstopped by a lazy check in the checkout function. Every runner-facing surface reads the runner's existing entry and re-labels its CTA rather than letting them walk into a rejection.

**Tech Stack:** Postgres 17.6 (Supabase), pg_cron, Deno edge functions, Next.js 15 App Router (apps/site, apps/web), Expo/React Native + NativeWind (apps/mobile), Vitest.

## Global Constraints

- **Hold window is 24 hours.** Define it once as `interval '24 hours'` in the `expires_at` column default and reuse; never re-type the literal elsewhere.
- **Live statuses are exactly `pending` and `paid`.** `cancelled`, `refunded`, `expired` are not live and must stay outside the unique index predicate.
- **Never change `categories.slots_taken` on any expiry path.** `slots_taken` is incremented only in `confirm_payment_tx` and decremented only in `refund_registration_tx`. See the header comment of `supabase/migrations/20260806201000_admin_cancel_registration_rpc.sql` for the manufactured-capacity bug this rule prevents.
- **All new SQL functions:** `security definer`, `set search_path = ''`, fully schema-qualified identifiers. This matches `20260806202000_harden_auth_helper_search_path.sql` and closes the `pg_temp` shadowing attack documented there.
- **Tests must not hardcode seeded ids.** `supabase/seed.sql` no longer creates `00000000-0000-0000-0000-0000000000a1`; tests that assume it fail silently. Create your own org/event/category rows per test, as `supabase/tests/backend.test.ts` already does.
- **Known-failing baseline: 34 failed / 126 passed (160 tests, 8 files)** before this work starts. These are pre-existing seed-drift and `functions serve` failures. Do not fix them here; do not let the count grow.
- **Migration filenames** use the `YYYYMMDDHHMMSS_description.sql` convention already in `supabase/migrations/`.

---

## File Structure

**Create:**
- `supabase/migrations/20260809100000_registration_status_expired.sql` — adds the enum value, alone (see Task 1 for why it must be alone)
- `supabase/migrations/20260809100100_one_registration_per_event.sql` — dedupe + `expires_at` + the unique index
- `supabase/migrations/20260809100200_expire_stale_registrations.sql` — sweep function, event-close trigger, cron schedule
- `supabase/migrations/20260809100300_confirm_payment_tx_expired.sql` — resurrect/conflict path
- `supabase/tests/registration-gate.test.ts` — all database-level tests for this feature
- `apps/site/lib/entry.ts` — shared "does this runner already hold an entry" helper for apps/site

**Modify:**
- `supabase/functions/registrations-checkout/index.ts` — pre-check + `already_registered` response
- `apps/site/app/events/[id]/page.tsx` — fetch the viewer's existing entry
- `apps/site/components/event/EventPageBody.tsx:261-350` — `DistanceRow` CTA states
- `apps/site/app/register/[categoryId]/page.tsx:30-38` — redirect when an entry exists
- `apps/site/app/races/RacesList.tsx` — expiry countdown + cancel affordance
- `apps/mobile/app/event/[id].tsx:33,137-170` — CTA states
- `apps/mobile/app/register/[categoryId].tsx` — handle `already_registered`
- `apps/web/components/StatusBadge.tsx:34-39` — `expired` badge
- `apps/web/app/(admin)/registrations/registrations-table.tsx:16-24` — `expired` filter option

---

### Task 1: Add the `expired` registration status

This migration contains **one statement and nothing else**. Postgres allows `ALTER TYPE … ADD VALUE` inside a transaction block, but the new value cannot be *used* until that transaction commits — using it in the same migration raises `unsafe use of new value "expired" of enum type registration_status`. Supabase runs each migration file in a transaction, so the value must land in its own file, ahead of every file that references it.

**Files:**
- Create: `supabase/migrations/20260809100000_registration_status_expired.sql`

**Interfaces:**
- Consumes: nothing
- Produces: `public.registration_status` gains the value `'expired'`

- [ ] **Step 1: Write the migration**

```sql
-- An unpaid registration that ran out its hold window, or whose event closed
-- before it was paid. Distinct from 'cancelled', which is a deliberate act by
-- the runner or an organizer -- an organizer looking at a roster needs to tell
-- "gave up / never finished paying" apart from "actively withdrew".
--
-- ALONE IN THIS FILE ON PURPOSE. Postgres permits ALTER TYPE ... ADD VALUE
-- inside a transaction block but forbids *using* the new value until that
-- transaction commits; Supabase wraps each migration file in one transaction.
-- Adding 'expired' and referencing it in the same file fails with
-- 'unsafe use of new value "expired" of enum type registration_status'.
-- Everything that uses it lives in later migrations.
alter type public.registration_status add value if not exists 'expired';
```

- [ ] **Step 2: Apply and verify the value exists**

Run:
```bash
supabase db reset
```

Then:
```bash
supabase db query --db-url "postgresql://postgres:postgres@127.0.0.1:54522/postgres" "select string_agg(enumlabel, ',' order by enumsortorder) as labels from pg_enum where enumtypid = 'public.registration_status'::regtype;"
```

Expected: `pending,paid,refunded,cancelled,expired`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260809100000_registration_status_expired.sql
git commit -m "feat(db): add expired registration status"
```

---

### Task 2: Dedupe existing rows, add `expires_at`, create the gate

The unique index cannot be created while duplicates exist — on the hosted database it would abort `db push`. The dedupe therefore runs **inside this migration, immediately before the index**, rather than as a separate script: that makes the migration self-sufficient in every environment and removes any ordering hazard between "run the cleanup" and "push the schema".

*(This is a deliberate change from the spec, which proposed a standalone `scripts/` cleanup. Folding it in is strictly safer — a separate script can be forgotten, and `db push` would then fail partway.)*

**Files:**
- Create: `supabase/migrations/20260809100100_one_registration_per_event.sql`
- Create: `supabase/tests/registration-gate.test.ts`

**Interfaces:**
- Consumes: `'expired'` from Task 1
- Produces: `registrations.expires_at timestamptz`; index `registrations_one_live_per_event`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/registration-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** Seed ids drifted out of seed.sql once already (see the Global Constraints
 *  note). Every fixture here is created by the test that needs it. */
async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}

async function makeEvent(slug: string) {
  const svc = service();
  const org = await svc.from("organizations").insert({ name: `Gate ${slug}`, slug: `gate-${slug}` }).select().single();
  const ev = await svc.from("events")
    .insert({ org_id: org.data!.id, name: `Gate Race ${slug}`, status: "open" }).select().single();
  const cat = await svc.from("categories")
    .insert({ org_id: org.data!.id, event_id: ev.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 })
    .select().single();
  return { orgId: org.data!.id, eventId: ev.data!.id, categoryId: cat.data!.id };
}

function regRow(f: { orgId: string; eventId: string; categoryId: string }, userId: string) {
  return { org_id: f.orgId, event_id: f.eventId, category_id: f.categoryId, user_id: userId, total_amount: 100000 };
}

describe("one live registration per event", () => {
  it("rejects a second live registration for the same event", async () => {
    const svc = service();
    const f = await makeEvent(`dup${Date.now()}`);
    const runner = await makeUser(`gate_dup_${Date.now()}@test.dev`);

    const first = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(first.error).toBeNull();

    const second = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe("23505");
  });

  it("allows a new registration once the previous one is cancelled, refunded or expired", async () => {
    const svc = service();
    for (const exitStatus of ["cancelled", "refunded", "expired"] as const) {
      const f = await makeEvent(`re${exitStatus}${Date.now()}`);
      const runner = await makeUser(`gate_re_${exitStatus}_${Date.now()}@test.dev`);

      const first = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      expect(first.error).toBeNull();
      await svc.from("registrations").update({ status: exitStatus }).eq("id", first.data!.id);

      const again = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      expect(again.error, `re-entry after ${exitStatus} must be allowed`).toBeNull();
    }
  });

  it("scopes the gate to one event — the same runner may enter a different event", async () => {
    const svc = service();
    const a = await makeEvent(`ea${Date.now()}`);
    const b = await makeEvent(`eb${Date.now()}`);
    const runner = await makeUser(`gate_two_${Date.now()}@test.dev`);

    expect((await svc.from("registrations").insert(regRow(a, runner.id)).select().single()).error).toBeNull();
    expect((await svc.from("registrations").insert(regRow(b, runner.id)).select().single()).error).toBeNull();
  });

  it("stamps a 24-hour expiry on a new pending registration", async () => {
    const svc = service();
    const f = await makeEvent(`exp${Date.now()}`);
    const runner = await makeUser(`gate_exp_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select("created_at,expires_at").single();
    expect(reg.error).toBeNull();
    const hours = (Date.parse(reg.data!.expires_at!) - Date.parse(reg.data!.created_at)) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run supabase/tests/registration-gate.test.ts`

Expected: FAIL. The first test fails because the second insert succeeds (no `23505`); the expiry test fails because `expires_at` is not a column.

- [ ] **Step 3: Write the migration**

```sql
-- A runner may hold at most ONE live entry per event. Without this, a fresh
-- idempotency key on each attempt produced a fresh row -- the existing
-- unique (user_id, idempotency_key) bounds retries of a single checkout call,
-- not how many entries a runner accumulates. Every duplicate entry consumes a
-- slot another runner could have taken.
--
-- Enforced by a partial unique index rather than a check in
-- registrations-checkout, because an application-level "does a row already
-- exist" read races: two concurrent checkouts both read zero rows, both
-- insert, both succeed. The index makes Postgres the arbiter.

-- How long an unpaid entry survives before the sweep reclaims it. Also the
-- single source of truth for the hold window -- do not repeat this literal.
alter table public.registrations
  add column expires_at timestamptz default (now() + interval '24 hours');

comment on column public.registrations.expires_at is
  'When an unpaid entry stops holding the runner''s one-per-event slot. Set on '
  'insert, cleared when the registration is paid. Null means "no hold to expire".';

-- Existing pending rows predate the column and would otherwise never expire.
update public.registrations
   set expires_at = created_at + interval '24 hours'
 where status = 'pending' and expires_at is null;

-- A paid entry has no hold to run out.
update public.registrations set expires_at = null where status <> 'pending';

-- Pre-existing duplicates would abort the CREATE UNIQUE INDEX below, so they
-- are resolved here rather than in a separate script that could be skipped:
-- a standalone cleanup is one more thing to remember, and forgetting it fails
-- `db push` halfway. Keep the earliest entry per (event, runner) and expire
-- the rest.
--
-- slots_taken is deliberately NOT adjusted. Read
-- 20260806201000_admin_cancel_registration_rpc.sql before changing this: an
-- earlier version of that function decremented slots_taken when cancelling
-- unpaid registrations and manufactured capacity nobody had vacated. Rows
-- expired here that were 'paid' DID hold a slot, so those -- and only those --
-- are released, one decrement per released row.
with ranked as (
  select id, category_id, status,
         row_number() over (partition by event_id, user_id order by created_at, id) as rn
    from public.registrations
   where status in ('pending', 'paid')
),
losers as (
  select id, category_id, status from ranked where rn > 1
),
released as (
  update public.categories c
     set slots_taken = greatest(c.slots_taken - sub.n, 0)
    from (select category_id, count(*) as n from losers where status = 'paid' group by category_id) sub
   where c.id = sub.category_id
  returning c.id
)
update public.registrations r
   set status = 'expired', expires_at = null
  from losers l
 where r.id = l.id;

create unique index registrations_one_live_per_event
  on public.registrations (event_id, user_id)
  where status in ('pending', 'paid');
```

- [ ] **Step 4: Apply and run the tests**

Run:
```bash
supabase db reset
```

Then: `pnpm exec vitest run supabase/tests/registration-gate.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Confirm the pre-existing failure count has not grown**

Run: `pnpm test`

Expected: still `34 failed | 126 passed` on the *pre-existing* files, plus your 4 new passes — i.e. `34 failed | 130 passed (164)`. If any *new* file fails, stop and fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260809100100_one_registration_per_event.sql supabase/tests/registration-gate.test.ts
git commit -m "feat(db): one live registration per event"
```

---

### Task 3: Expire stale entries — sweep, trigger, schedule

**Files:**
- Create: `supabase/migrations/20260809100200_expire_stale_registrations.sql`
- Modify: `supabase/tests/registration-gate.test.ts`

**Interfaces:**
- Consumes: `registrations.expires_at`, `'expired'`
- Produces: `public.expire_stale_registrations() returns integer` (count of rows expired); trigger `events_close_expires_pending` on `public.events`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/tests/registration-gate.test.ts`:

```ts
describe("expiry of unpaid entries", () => {
  it("expires a pending entry past its hold window and fails its payment", async () => {
    const svc = service();
    const f = await makeEvent(`sweep${Date.now()}`);
    const runner = await makeUser(`gate_sweep_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({
      org_id: f.orgId, registration_id: reg.data!.id, amount: 100000, status: "pending",
    });
    await svc.from("registrations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", reg.data!.id);

    const swept = await svc.rpc("expire_stale_registrations");
    expect(swept.error).toBeNull();

    const after = await svc.from("registrations").select("status,expires_at").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("expired");
    expect(after.data!.expires_at).toBeNull();

    const pay = await svc.from("payments").select("status").eq("registration_id", reg.data!.id).single();
    expect(pay.data!.status).toBe("failed");
  });

  it("leaves slots_taken untouched — expiry must never manufacture capacity", async () => {
    const svc = service();
    const f = await makeEvent(`slots${Date.now()}`);
    const runner = await makeUser(`gate_slots_${Date.now()}@test.dev`);

    await svc.from("categories").update({ slots_taken: 4 }).eq("id", f.categoryId);
    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", reg.data!.id);

    await svc.rpc("expire_stale_registrations");

    const cat = await svc.from("categories").select("slots_taken").eq("id", f.categoryId).single();
    expect(cat.data!.slots_taken).toBe(4);
  });

  it("leaves a paid entry alone no matter how old", async () => {
    const svc = service();
    const f = await makeEvent(`paid${Date.now()}`);
    const runner = await makeUser(`gate_paid_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations")
      .update({ status: "paid", expires_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq("id", reg.data!.id);

    await svc.rpc("expire_stale_registrations");

    const after = await svc.from("registrations").select("status").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("paid");
  });

  it("expires pending entries the moment the event closes", async () => {
    const svc = service();
    const f = await makeEvent(`close${Date.now()}`);
    const runner = await makeUser(`gate_close_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();

    await svc.from("events").update({ status: "closed" }).eq("id", f.eventId);

    const after = await svc.from("registrations").select("status").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("expired");
  });

  it("frees the runner to register again after expiry", async () => {
    const svc = service();
    const f = await makeEvent(`free${Date.now()}`);
    const runner = await makeUser(`gate_free_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", reg.data!.id);
    await svc.rpc("expire_stale_registrations");

    const again = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(again.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run supabase/tests/registration-gate.test.ts`

Expected: FAIL with `Could not find the function public.expire_stale_registrations`.

- [ ] **Step 3: Write the migration**

```sql
-- Reclaim unpaid entries so an abandoned checkout does not hold a runner's
-- one-per-event slot forever.
--
-- WHY THIS DOES NOT COPY admin_cancel_registration's payment guard:
-- registrations-checkout upserts a payments row with status 'pending' and a
-- live PayMongo checkout_url in the SAME request that creates the
-- registration, so very nearly every pending registration has a pending
-- payment. admin_cancel_registration returns 'payment_in_flight' in exactly
-- that situation (20260806201000, line ~97) because an admin cancelling by
-- hand could race a capture that is seconds away. A sweep that adopted the
-- same guard would never expire anything at all.
--
-- The 24-hour window is what makes it safe instead: a PayMongo hosted checkout
-- session itself expires at 24 hours, so a session that old cannot capture.
-- The residual risk is handled rather than assumed away -- see
-- 20260809100300_confirm_payment_tx_expired.sql, which lets a late capture
-- resurrect an expired registration instead of stranding the money.
--
-- slots_taken IS NOT TOUCHED HERE. A pending registration never held a slot:
-- slots_taken is incremented only in confirm_payment_tx and decremented only
-- in refund_registration_tx. See 20260806201000's header for the
-- manufactured-capacity bug that decrementing here would recreate.
create or replace function public.expire_stale_registrations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.registrations
       set status = 'expired', expires_at = null
     where status = 'pending'
       and expires_at is not null
       and expires_at <= now()
    returning id
  ),
  -- The checkout session behind an expired entry can no longer capture; say so
  -- explicitly rather than leaving a 'pending' payment that looks in-flight
  -- forever on the payments screen.
  failed as (
    update public.payments p
       set status = 'failed'
      from expired e
     where p.registration_id = e.id
       and p.status = 'pending'
    returning p.id
  )
  select count(*) into v_count from expired;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_registrations() from public;
grant execute on function public.expire_stale_registrations() to service_role;

-- Closing registration early should not leave entries nominally alive until
-- their 24 hours happen to run out -- nobody can pay for a closed event.
create or replace function public.expire_pending_on_event_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.registrations
     set status = 'expired', expires_at = null
   where event_id = new.id
     and status = 'pending';

  update public.payments p
     set status = 'failed'
    from public.registrations r
   where p.registration_id = r.id
     and r.event_id = new.id
     and r.status = 'expired'
     and p.status = 'pending';

  return new;
end;
$$;

create trigger events_close_expires_pending
  after update of status on public.events
  for each row
  when (old.status is distinct from new.status
        and new.status in ('cancelled', 'closed', 'completed'))
  execute function public.expire_pending_on_event_close();

-- Belt and braces. The lazy check in registrations-checkout means correctness
-- does not depend on this running; the sweep exists so admin rosters and the
-- payments screen stop showing entries that are notionally dead.
select cron.schedule(
  'expire-stale-registrations',
  '*/15 * * * *',
  $$select public.expire_stale_registrations()$$
);
```

- [ ] **Step 4: Apply and run the tests**

Run:
```bash
supabase db reset
```

Then: `pnpm exec vitest run supabase/tests/registration-gate.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 5: Verify the cron job registered**

Run:
```bash
supabase db query --db-url "postgresql://postgres:postgres@127.0.0.1:54522/postgres" "select jobname, schedule, active from cron.job where jobname = 'expire-stale-registrations';"
```

Expected: one row, `*/15 * * * *`, `active: true`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260809100200_expire_stale_registrations.sql supabase/tests/registration-gate.test.ts
git commit -m "feat(db): expire unpaid registrations after 24h or on event close"
```

---

### Task 4: Let a late capture resurrect an expired registration

**Files:**
- Create: `supabase/migrations/20260809100300_confirm_payment_tx_expired.sql`
- Modify: `supabase/tests/registration-gate.test.ts`

**Interfaces:**
- Consumes: `public.confirm_payment_tx(uuid, text, int, int, text, jsonb) returns text` (existing, from `20260723100000_money_txn_rpcs.sql`)
- Produces: same signature; return value gains `'conflict'` alongside the existing `'paid' | 'already' | 'not_pending' | 'not_found'`

- [ ] **Step 1: Write the failing tests**

Append to `supabase/tests/registration-gate.test.ts`:

```ts
describe("late capture on an expired registration", () => {
  const confirmArgs = (id: string) => ({
    p_registration_id: id, p_method: "gcash", p_fee: 0, p_net: 100000,
    p_token: `tok_${id}`, p_raw: {},
  });

  it("resurrects an expired registration when the runner has no other entry", async () => {
    const svc = service();
    const f = await makeEvent(`resurrect${Date.now()}`);
    const runner = await makeUser(`gate_res_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({ org_id: f.orgId, registration_id: reg.data!.id, amount: 100000, status: "pending" });
    await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", reg.data!.id);

    const res = await svc.rpc("confirm_payment_tx", confirmArgs(reg.data!.id));
    expect(res.data).toBe("paid");

    const after = await svc.from("registrations").select("status").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("paid");
  });

  it("returns 'conflict' instead of confirming when a live entry already exists", async () => {
    const svc = service();
    const f = await makeEvent(`conflict${Date.now()}`);
    const runner = await makeUser(`gate_conf_${Date.now()}@test.dev`);

    const stale = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({ org_id: f.orgId, registration_id: stale.data!.id, amount: 100000, status: "pending" });
    await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", stale.data!.id);

    // The runner gave up and registered again; that new entry is the live one.
    const fresh = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(fresh.error).toBeNull();

    const res = await svc.rpc("confirm_payment_tx", confirmArgs(stale.data!.id));
    expect(res.data).toBe("conflict");

    const after = await svc.from("registrations").select("status").eq("id", stale.data!.id).single();
    expect(after.data!.status).toBe("expired");
  });

  it("still refuses to re-confirm a refunded registration", async () => {
    const svc = service();
    const f = await makeEvent(`replay${Date.now()}`);
    const runner = await makeUser(`gate_replay_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations").update({ status: "refunded" }).eq("id", reg.data!.id);

    const res = await svc.rpc("confirm_payment_tx", confirmArgs(reg.data!.id));
    expect(res.data).toBe("not_pending");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run supabase/tests/registration-gate.test.ts -t "late capture"`

Expected: FAIL. The first two return `not_pending` — the current function rejects any status other than `pending`.

- [ ] **Step 3: Write the migration**

```sql
-- A PayMongo capture that lands AFTER the sweep expired its registration.
--
-- The 24-hour hold is longer than a PayMongo hosted checkout session lives, so
-- this is close to unreachable -- but "close to unreachable" is not a reason to
-- silently swallow captured money. Before this change confirm_payment_tx
-- returned 'not_pending' for an expired row, which meant PayMongo had the
-- runner's money and the platform had no registration, no ticket, and no
-- refund record.
--
-- Two outcomes, decided by whether the runner has since moved on:
--   * no other live entry  -> resurrect the expired row to 'paid'. The runner
--     paid for this event and now holds exactly one entry. Correct outcome.
--   * a live entry exists  -> 'conflict'. Confirming would violate
--     registrations_one_live_per_event and give one runner two slots. The
--     webhook logs it for manual refund rather than failing on a raw 23505.
--
-- Everything else is unchanged from 20260723100000_money_txn_rpcs.sql:
-- 'paid' is still 'already' (replay-safe), refunded/cancelled still
-- 'not_pending' (never re-confirm).
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
  v_event uuid;
  v_user uuid;
  v_live integer;
begin
  select status, category_id, event_id, user_id
    into v_status, v_category, v_event, v_user
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  if v_status = 'expired' then
    select count(*) into v_live
      from public.registrations
     where event_id = v_event
       and user_id = v_user
       and id <> p_registration_id
       and status in ('pending', 'paid');
    if v_live > 0 then
      return 'conflict';
    end if;
  elsif v_status <> 'pending' then
    return 'not_pending';  -- refunded/cancelled: never re-confirm (replay-safe)
  end if;

  update public.payments
     set status = 'paid', method = p_method, platform_fee = p_fee,
         net_to_org = p_net, raw = p_raw
   where registration_id = p_registration_id;

  update public.registrations
     set status = 'paid', ticket_token = p_token, expires_at = null
   where id = p_registration_id;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  return 'paid';
end;
$$;

revoke all on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) from public;
grant execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) to service_role;
```

- [ ] **Step 4: Apply and run the tests**

Run:
```bash
supabase db reset
```

Then: `pnpm exec vitest run supabase/tests/registration-gate.test.ts`

Expected: PASS (12 tests).

- [ ] **Step 5: Make the webhook surface a conflict**

The webhook currently treats any non-`paid` return as a benign no-op. `conflict` means money was captured with nowhere to put it and a human must refund it, so it has to be loud.

Find the `confirm_payment_tx` call site:

```bash
grep -rn "confirm_payment_tx" supabase/functions/
```

In the file that calls it, after the RPC returns, add:

```ts
if (result === "conflict") {
  // Money captured against a registration that expired, and the runner has
  // since taken a live entry for the same event. Confirming would hand them
  // two slots; doing nothing silently keeps their money. Neither is
  // acceptable, so make it findable and refund by hand.
  console.error(
    `[webhook] CAPTURE CONFLICT registration=${registrationId} — payment captured on an expired registration ` +
      `while a live entry exists for the same runner+event. MANUAL REFUND REQUIRED.`,
  );
}
```

- [ ] **Step 6: Run the full suite**

Run: `pnpm test`

Expected: `34 failed | 138 passed (172)` — the 34 pre-existing failures, unchanged.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260809100300_confirm_payment_tx_expired.sql supabase/tests/registration-gate.test.ts supabase/functions/
git commit -m "feat(db): resurrect expired registrations on late capture, flag conflicts"
```

---

### Task 5: Reject a duplicate at checkout with a useful error

**Files:**
- Modify: `supabase/functions/registrations-checkout/index.ts`

**Interfaces:**
- Consumes: `registrations_one_live_per_event`
- Produces: HTTP `409 { error: "already_registered", registration_id: string, checkout_url: string | null, status: "pending" | "paid" }`

- [ ] **Step 1: Add the pre-check**

In `supabase/functions/registrations-checkout/index.ts`, immediately after the sold-out check (`if (category.slots_taken >= category.slots_total) …`), insert:

```ts
    // One live entry per event. The partial unique index
    // registrations_one_live_per_event is the real enforcement -- this read
    // races by nature (two concurrent calls both see zero rows) and the 23505
    // handler below is what actually holds the line. This exists so the common
    // case returns something the client can act on: the existing entry and its
    // checkout URL, so a runner who wandered off mid-payment lands back on the
    // pay screen instead of a dead end.
    //
    // `expires_at <= now()` is the lazy backstop: a pending row past its hold
    // window is already gone as far as the runner is concerned, whether or not
    // the 15-minute sweep has run yet. Correctness must not depend on cron.
    const { data: existing } = await db
      .from("registrations")
      .select("id,status,expires_at,payments(checkout_url)")
      .eq("event_id", input.event_id)
      .eq("user_id", userId)
      .in("status", ["pending", "paid"])
      .maybeSingle();

    const liveEntry =
      existing && !(existing.status === "pending" && existing.expires_at && Date.parse(existing.expires_at) <= Date.now())
        ? existing
        : null;

    if (liveEntry) {
      const pay = Array.isArray(liveEntry.payments) ? liveEntry.payments[0] : liveEntry.payments;
      return json(
        {
          error: "already_registered",
          registration_id: liveEntry.id,
          status: liveEntry.status,
          checkout_url: pay?.checkout_url ?? null,
        },
        409,
      );
    }
```

- [ ] **Step 2: Handle the race**

Replace the existing registration-insert error handling:

```ts
    if (regErr || !reg) return json({ error: "registration_failed", details: regErr?.message }, 500);
```

with:

```ts
    if (regErr || !reg) {
      // 23505 on registrations_one_live_per_event: a concurrent checkout won
      // the race between the pre-check above and this insert. Same outcome as
      // the pre-check, just discovered a moment later.
      if (regErr?.code === "23505" && (regErr.message ?? "").includes("registrations_one_live_per_event")) {
        const { data: winner } = await db
          .from("registrations")
          .select("id,status,payments(checkout_url)")
          .eq("event_id", input.event_id)
          .eq("user_id", userId)
          .in("status", ["pending", "paid"])
          .maybeSingle();
        const pay = winner && (Array.isArray(winner.payments) ? winner.payments[0] : winner.payments);
        return json(
          {
            error: "already_registered",
            registration_id: winner?.id ?? null,
            status: winner?.status ?? "pending",
            checkout_url: pay?.checkout_url ?? null,
          },
          409,
        );
      }
      return json({ error: "registration_failed", details: regErr?.message }, 500);
    }
```

- [ ] **Step 3: Write the test**

Append to `supabase/tests/registration-gate.test.ts`:

```ts
const FN = process.env.FUNCTIONS_URL ?? "http://127.0.0.1:54521/functions/v1";

describe("registrations-checkout duplicate handling", () => {
  it("returns already_registered with the existing entry", async () => {
    const svc = service();
    const f = await makeEvent(`co${Date.now()}`);
    const runner = await makeUser(`gate_co_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({
      org_id: f.orgId, registration_id: reg.data!.id, amount: 100000,
      status: "pending", checkout_url: "https://checkout.test/abc",
    });

    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${runner.token}` },
      body: JSON.stringify({
        event_id: f.eventId, category_id: f.categoryId, addon_ids: [],
        custom_data: {}, waiver_accepted: true, idempotency_key: `k_${Date.now()}`,
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_registered");
    expect(body.registration_id).toBe(reg.data!.id);
    expect(body.checkout_url).toBe("https://checkout.test/abc");
  });
});
```

- [ ] **Step 4: Run the test with functions serving**

This test needs the edge runtime. In a second terminal:

```bash
supabase functions serve
```

Then: `pnpm exec vitest run supabase/tests/registration-gate.test.ts -t "already_registered"`

Expected: PASS. If it fails with a connection error, `functions serve` is not running — that is the cause, not the code.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/registrations-checkout/index.ts supabase/tests/registration-gate.test.ts
git commit -m "feat(checkout): return already_registered instead of a duplicate entry"
```

---

### Task 6: apps/site — event page shows the runner's existing entry

**REQUIRED SKILL:** Invoke `ui-ux-pro-max` before writing any markup in this task, and follow its guidance on state communication and CTA hierarchy.

**Files:**
- Create: `apps/site/lib/entry.ts`
- Modify: `apps/site/app/events/[id]/page.tsx`
- Modify: `apps/site/components/event/EventPageBody.tsx`
- Modify: `apps/site/app/register/[categoryId]/page.tsx`

**Interfaces:**
- Consumes: `registrations.expires_at`, status `expired`
- Produces: `fetchMyEntry(db, eventId, userId): Promise<MyEntry | null>` where
  `type MyEntry = { id: string; status: "pending" | "paid"; categoryId: string; expiresAt: string | null }`

- [ ] **Step 1: Write the entry helper**

Create `apps/site/lib/entry.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** The one live entry a runner may hold for an event, if they hold one.
 *  `expiresAt` is only meaningful while `status` is "pending". */
export type MyEntry = {
  id: string;
  status: "pending" | "paid";
  categoryId: string;
  expiresAt: string | null;
};

/** Mirrors the lazy check in registrations-checkout: a pending entry past its
 *  hold window is already gone to the runner, whether or not the 15-minute
 *  sweep has caught up. Showing "finish payment" for an entry the server will
 *  refuse is worse than showing nothing. */
export async function fetchMyEntry(
  db: SupabaseClient,
  eventId: string,
  userId: string | null,
): Promise<MyEntry | null> {
  if (!userId) return null;

  const { data } = await db
    .from("registrations")
    .select("id,status,category_id,expires_at")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .in("status", ["pending", "paid"])
    .maybeSingle();

  if (!data) return null;
  if (data.status === "pending" && data.expires_at && Date.parse(data.expires_at) <= Date.now()) return null;

  return {
    id: data.id,
    status: data.status as "pending" | "paid",
    categoryId: data.category_id,
    expiresAt: data.expires_at ?? null,
  };
}
```

- [ ] **Step 2: Fetch it on the event page**

In `apps/site/app/events/[id]/page.tsx`, replace the body of `EventPage` between `if (!event) notFound();` and the `return`:

```tsx
  const { data: { user } } = await db.auth.getUser();

  // Independent reads — sequential awaits would stack round trips before the
  // first byte.
  const [categories, addons, myEntry] = await Promise.all([
    fetchCategories(db, id),
    fetchAddons(db, id),
    fetchMyEntry(db, id, user?.id ?? null),
  ]);
  // almost_full is still registerable — see lib/eventStatus.ts, mirrors
  // apps/mobile/app/event/[id].tsx's `registerable` rule.
  const closed = isRegistrationClosed(event.status);
```

Add the import:

```tsx
import { fetchMyEntry } from "@/lib/entry";
```

And pass it through:

```tsx
        <EventPageBody event={event} categories={categories} addons={addons} closed={closed} myEntry={myEntry} />
```

- [ ] **Step 3: Thread it into the CTA**

In `apps/site/components/event/EventPageBody.tsx`:

Add to the imports:

```tsx
import type { MyEntry } from "@/lib/entry";
```

Add `myEntry` to the component's props type and destructuring (alongside `closed`), then pass it down where `DistanceRow` is rendered (line ~206):

```tsx
              <DistanceRow key={c.id} category={c} index={i} trail={trail} closed={closed} myEntry={myEntry} />
```

Replace the `DistanceRow` signature and the CTA block (lines 261-346):

```tsx
function DistanceRow({
  category,
  index,
  trail,
  closed,
  myEntry,
}: {
  category: CategoryRow;
  index: number;
  trail: boolean;
  closed: boolean;
  /** The runner's existing entry for THIS event, on any distance. */
  myEntry: MyEntry | null;
}) {
  const remaining = Math.max(0, category.slots_total - category.slots_taken);
  const soldOut = remaining === 0;
  // Closed beats sold-out in the message: "Sold out" on a cancelled race tells
  // a runner to look for next year's edition of something that isn't running.
  const enterable = !soldOut && !closed && !myEntry;
  const scarce = !soldOut && remaining <= 15;
  const pct = Math.min(100, Math.round((category.slots_taken / Math.max(1, category.slots_total)) * 100));
  // An entry is one PER EVENT, so it re-labels every distance, not just the one
  // the runner picked. Leaving "Join" live on the other distances would walk
  // them into a 409 they could have been told about here.
  const mine = myEntry?.categoryId === category.id;
```

and the CTA cell:

```tsx
        <div className="col-span-2 sm:col-span-1">
          {myEntry ? (
            <Link
              href={myEntry.status === "paid" ? `/races` : `/pay/${myEntry.id}`}
              className={`inline-flex w-full items-center justify-center rounded-pill px-6 py-3 text-[14.5px] font-semibold ${
                myEntry.status === "paid"
                  ? "bg-paid-tint text-forest"
                  : "bg-amber-tint text-[#7A4A00]"
              }`}
            >
              {myEntry.status === "paid"
                ? mine ? "You're in — view entry" : "You're in on another distance"
                : mine ? "Finish payment" : "Unfinished entry on another distance"}
            </Link>
          ) : !enterable ? (
            <span
              className={`inline-flex w-full items-center justify-center rounded-pill px-6 py-3 text-[14.5px] font-semibold ${
                trail ? "bg-white/10 text-white/55" : "bg-black/5 text-black/45"
              }`}
            >
              {closed ? "Registration closed" : "Sold out"}
            </span>
          ) : (
            <RainbowButton asChild className="h-auto w-full rounded-pill px-6 py-3 text-[14.5px] font-semibold">
              <Link href={`/register/${category.id}`} aria-label={`Join ${category.label} — ${formatPeso(category.base_price)}`}>
                Join
              </Link>
            </RainbowButton>
          )}
        </div>
```

- [ ] **Step 4: Redirect from the register page**

In `apps/site/app/register/[categoryId]/page.tsx`, after the sold-out redirect (line ~38), add:

```tsx
  // One entry per event. Same reasoning as the closed/sold-out redirects above:
  // the authoritative rejection is registrations-checkout's 409, but there is
  // no reason to walk a runner through three steps to reach it.
  const myEntry = await fetchMyEntry(db, category.event_id, user.id);
  if (myEntry) {
    redirect(`/events/${category.event_id}?registered=${myEntry.id}`);
  }
```

Add the import:

```tsx
import { fetchMyEntry } from "@/lib/entry";
```

- [ ] **Step 5: Verify in the browser**

Run: `cd apps/site && pnpm dev`

Sign in as a runner with a paid registration, open that event's page, and confirm every distance shows "You're in", not "Join". Then visit `/register/<any category id of that event>` directly and confirm it redirects to the event page.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm -r typecheck`

```bash
git add apps/site
git commit -m "feat(site): surface an existing entry on the event page"
```

---

### Task 7: apps/site — expiry countdown and cancel on My Races

**REQUIRED SKILL:** Invoke `ui-ux-pro-max` before writing markup.

**Files:**
- Modify: `apps/site/lib/registration.ts`
- Modify: `apps/site/app/races/RacesList.tsx`

**Interfaces:**
- Consumes: `cancelRegistration(rid): Promise<void>` (existing, `apps/site/lib/registration.ts:144`)
- Produces: `RegistrationRow` gains `expiresAt: string | null`

- [ ] **Step 1: Carry `expires_at` through the query**

In `apps/site/lib/registration.ts`, add `expires_at` to `REG_SELECT` (line 77) — change the leading field list from `"id,status,total_amount,ticket_token,org_id,event_id,…"` to `"id,status,total_amount,ticket_token,org_id,event_id,expires_at,…"`.

Add to the `RegistrationRow` type (after `event_id`):

```ts
  /** When an unpaid entry stops holding this runner's one-per-event slot.
   *  Null once paid — a paid entry has no hold to run out. */
  expiresAt: string | null;
```

Add to `mapReg`:

```ts
    expiresAt: r.expires_at ?? null,
```

- [ ] **Step 2: Show the countdown**

In `apps/site/app/races/RacesList.tsx`, add a countdown helper near the top of the file:

```tsx
/** Coarse on purpose: a to-the-second countdown on a 24-hour window reads as
 *  panic, and the sweep runs every 15 minutes so second-level precision would
 *  be a lie anyway. */
function holdRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - Date.now();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left to pay`;
  return `${Math.max(1, Math.round(ms / 60_000))}m left to pay`;
}
```

Render it wherever a pending registration's status is shown in this file, alongside the existing "Continue payment" affordance:

```tsx
{r.status === "pending" && holdRemaining(r.expiresAt) ? (
  <span className="font-eyebrow rounded-full bg-amber-tint px-2.5 py-1 text-[10px] font-bold uppercase tracking-[1.5px] text-[#7A4A00]">
    {holdRemaining(r.expiresAt)}
  </span>
) : null}
```

- [ ] **Step 3: Verify the cancel affordance exists**

Run:

```bash
grep -n "cancelRegistration" apps/site/app/races/RacesList.tsx
```

If it is already wired, nothing to do — `cancelRegistration` already hard-deletes the row, which drops it out of the unique index and frees the runner immediately. If it is not wired, add a "Cancel entry" button on pending rows that calls `cancelRegistration(r.id)` and invalidates the `my-registrations` query.

- [ ] **Step 4: Verify in the browser**

Run: `cd apps/site && pnpm dev`

Sign in as a runner with a pending registration and confirm the countdown renders and cancelling removes the row.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm -r typecheck`

```bash
git add apps/site
git commit -m "feat(site): show the payment hold countdown on My Races"
```

---

### Task 8: apps/mobile — same states on the event and register screens

**REQUIRED SKILL:** Invoke `ui-ux-pro-max` before writing markup. Note the NativeWind constraint: lay out custom RN components with `className` (`flex-row`, `flex-1`), **not** StyleSheet `flex`/`width` — the latter silently does not apply.

**Files:**
- Modify: `apps/mobile/app/event/[id].tsx`
- Modify: `apps/mobile/app/register/[categoryId].tsx`

**Interfaces:**
- Consumes: the `already_registered` 409 from Task 5

- [ ] **Step 1: Fetch the runner's entry on the event screen**

In `apps/mobile/app/event/[id].tsx`, alongside the existing event/category queries, add a query for the viewer's live entry for this event:

```tsx
  // One entry per event, so this gates EVERY distance, not just the one the
  // runner picked. Mirrors apps/site/lib/entry.ts.
  const { data: myEntry } = useQuery({
    queryKey: ["my-entry", id],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase
        .from("registrations")
        .select("id,status,category_id,expires_at")
        .eq("event_id", id)
        .eq("user_id", auth.user.id)
        .in("status", ["pending", "paid"])
        .maybeSingle();
      if (!data) return null;
      // Lazy expiry check — matches registrations-checkout, so the button never
      // promises something the server will refuse.
      if (data.status === "pending" && data.expires_at && Date.parse(data.expires_at) <= Date.now()) return null;
      return data;
    },
  });
```

- [ ] **Step 2: Re-label the CTA**

At line ~33, `registerable` becomes:

```tsx
  const registerable = !["cancelled", "closed", "completed"].includes(event.status) && !myEntry;
```

And the footer button (line ~167) becomes:

```tsx
        {myEntry ? (
          <Pressable
            className="rounded-full bg-muted px-5 py-4 items-center"
            onPress={() =>
              router.push(myEntry.status === "paid" ? `/registration/${myEntry.id}` : `/pay/${myEntry.id}`)
            }
          >
            <Text className="text-[16px] font-semibold">
              {myEntry.status === "paid" ? "You're in — view entry" : "Finish payment"}
            </Text>
          </Pressable>
        ) : registerable ? (
```

Keep the existing `registerable` branch body unchanged after this.

- [ ] **Step 3: Handle the 409 on the register screen**

In `apps/mobile/app/register/[categoryId].tsx`, in the checkout error handler, add a branch before the generic error alert:

```tsx
      if (message === "already_registered") {
        Alert.alert(
          "You're already entered",
          "You can only hold one entry per race. We'll take you to it.",
          [{ text: "OK", onPress: () => router.replace(`/pay/${body.registration_id}`) }],
        );
        return;
      }
```

- [ ] **Step 4: Verify on a device**

JS edits do not Fast-Refresh in this project (embedded bundle). Rebuild:

```bash
cd apps/mobile && pnpm exec expo run:ios
```

Open an event the signed-in runner already holds an entry for and confirm the footer reads "You're in" / "Finish payment".

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm -r typecheck`

```bash
git add apps/mobile
git commit -m "feat(mobile): surface an existing entry on the event screen"
```

---

### Task 9: apps/web — `expired` as a first-class admin status

**Files:**
- Modify: `apps/web/components/StatusBadge.tsx`
- Modify: `apps/web/app/(admin)/registrations/registrations-table.tsx`

**Interfaces:**
- Consumes: registration status `expired`

- [ ] **Step 1: Add the badge**

In `apps/web/components/StatusBadge.tsx`, add to the `PAYMENT` map (line ~34):

```ts
  // Ran out its 24-hour payment hold, or its event closed while still unpaid.
  // Deliberately distinct from "Cancelled": an organizer reading a roster needs
  // to tell "never finished paying" apart from "actively withdrew".
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
```

- [ ] **Step 2: Add the filter option**

In `apps/web/app/(admin)/registrations/registrations-table.tsx`, add to `STATUS_FILTER.options` (line ~19):

```ts
    { value: "expired", label: "Expired" },
    { value: "cancelled", label: "Cancelled" },
```

- [ ] **Step 3: Verify**

Run: `cd apps/web && pnpm dev`

Open the registrations table, filter by Expired, and confirm the badge renders and the filter returns the expired rows.

- [ ] **Step 4: Run the admin tests, typecheck, commit**

Run: `pnpm exec vitest run apps/web` and `pnpm -r typecheck`

```bash
git add apps/web
git commit -m "feat(admin): distinguish expired registrations from cancelled"
```

---

### Task 10: Deploy to hosted and verify the cleanup

The dedupe runs as part of the Task 2 migration, so `db push` both fixes the existing duplicates and installs the gate in one step. Verify before and after.

**Files:** none — this task is deployment and verification.

- [ ] **Step 1: Record the pre-push state**

Run:
```bash
supabase db query --linked "select count(*) as total, count(distinct (user_id, event_id)) as distinct_pairs from registrations;"
```

Expected: `total: 5883`, `distinct_pairs: 5880` (3 duplicates). Write down whatever it actually returns — it is the number you check against in Step 4.

- [ ] **Step 2: Record the affected categories' slot counts**

Run:
```bash
supabase db query --linked "select c.id, c.slots_taken, count(*) filter (where r.status = 'paid') as paid_regs from categories c join registrations r on r.category_id = c.id where c.id in (select category_id from registrations where (user_id, event_id) in (select user_id, event_id from registrations group by 1,2 having count(*) > 1)) group by c.id, c.slots_taken;"
```

Save the output. The invariant `slots_taken == paid_regs` must still hold after the push.

- [ ] **Step 3: Push**

Run:
```bash
supabase db push
```

Expected: all four new migrations apply cleanly. If `CREATE UNIQUE INDEX` fails with a duplicate-key error, the dedupe CTE did not cover a case — stop and investigate rather than deleting rows by hand.

- [ ] **Step 4: Verify no duplicates remain**

Run:
```bash
supabase db query --linked "select count(*) as live_total, count(distinct (user_id, event_id)) as distinct_pairs from registrations where status in ('pending','paid');"
```

Expected: `live_total == distinct_pairs`.

- [ ] **Step 5: Verify the slot invariant survived**

Re-run the Step 2 query. Expected: `slots_taken == paid_regs` for every row.

- [ ] **Step 6: Verify the cron job is scheduled on hosted**

Run:
```bash
supabase db query --linked "select jobname, schedule, active from cron.job where jobname = 'expire-stale-registrations';"
```

Expected: one active row.

- [ ] **Step 7: Deploy the edge function**

Run:
```bash
supabase functions deploy registrations-checkout
```

- [ ] **Step 8: Commit any remaining changes**

```bash
git status
git commit -am "chore: deploy registration gate" || true
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 partial unique index | Task 2 |
| §2 `expired` enum, `expires_at`, sweep, cron, lazy backstop, early close | Tasks 1, 3 |
| §2 no `slots_taken` change | Tasks 2, 3 (asserted by a test in Task 3 Step 1) |
| §3 resurrect / conflict | Task 4 |
| §4 `already_registered` with existing id + checkout URL | Task 5 |
| §5 event cards, register redirect, My Races countdown, admin badge | Tasks 6, 7, 8, 9 |
| §6 hosted cleanup + slot decrement | Task 2 migration, verified in Task 10 |
| Testing section | Tasks 2-5 |

**Deviation from spec:** the hosted cleanup moved from a standalone `scripts/` file into the Task 2 migration. Rationale is recorded in Task 2's preamble — a separate script can be skipped, and `db push` then fails midway on the unique index.

**Type consistency:** `MyEntry` (`{ id, status, categoryId, expiresAt }`) is defined in Task 6 Step 1 and used identically in Tasks 6 and 7. `fetchMyEntry(db, eventId, userId)` keeps one signature throughout. `expire_stale_registrations()` returns `integer` in Task 3 and is called with no arguments in Tasks 3 and 10. `confirm_payment_tx` keeps its exact existing six-parameter signature in Task 4.
