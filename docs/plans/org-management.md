# Organization Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a super admin rename, manage-admins, suspend and delete on the Organizations page; make the provisioning invite link actually work; default the create dialog to 3%.

**Architecture:** Four new actions on the existing `org-provision` Edge Function, which already owns the super-admin gate. The delete cascade runs as one `delete_organization_tx` RPC because a plain `delete from organizations` can abort on a foreign-key ordering hazard. One migration widens two RLS policies so a suspended org stays visible to its own staff and the platform operator, and removes a suspended org's events from the storefront. The console gets a row-actions menu — no new route.

**Tech Stack:** Deno Edge Functions (`supabase/functions`), Postgres 17 + RLS, Next 15 App Router (`apps/web`), Vitest + Testing Library, supabase-js v2.

**Spec:** [docs/specs/2026-08-18-org-management-design.md](../specs/2026-08-18-org-management-design.md)

## Global Constraints

- **Never edit an applied migration.** `db push` skips a version it has recorded regardless of content. All schema work here is one NEW migration file.
- **New functions need explicit grants.** Postgres grants EXECUTE to PUBLIC on every newly created function by built-in default, so a revoke/grant pair is not optional. Grant in the same migration and verify with `has_function_privilege` — inspecting `pg_default_acl` is not proof. (An event trigger, `20260808120200`, once enforced this at DDL time; it was **reversed** by `20260808130000_replace_grant_trigger_with_test_guard.sql` because it fired on `CREATE OR REPLACE` too and silently stripped grants from existing functions. The guard now is `supabase/tests/function-grants.test.ts`, which enumerates every SECURITY DEFINER function in `public`.)
- **`is_active` and `slug` are never granted to `authenticated`.** RLS cannot be scoped to a column and `organizations_update_branding_org_admin` is column-agnostic, so a grant would let every org admin unsuspend or rename around the platform. `supabase/tests/processor-fee-ledger.test.ts:192` already asserts this and must stay green **unmodified**.
- **The slug is immutable.** Rename writes `name` only.
- **Delete is blocked by `paid`, `refunded` AND `partially_refunded` payments.** No override.
- **All amounts are integer centavos.** No floats anywhere in the money path.
- **Test discovery is a glob and differs per app.** `apps/web` runs only `{app,lib,components}/**/*.test.{ts,tsx}` and colocates tests next to the code. Backend tests live in `supabase/tests/` and run from the ROOT vitest.
- **Commit format:** `type(scope): imperative lowercase`.
- **There is no CI.** Every task runs its own tests locally.
- **Comment density:** migrations, the money path and auth carry the incident that produced the code. Ordinary UI does not.

**Local backend setup (needed from Task 2 onward):**

```bash
pnpm exec supabase start
pnpm exec supabase db reset
pnpm exec supabase status -o env > .env.local
```

---

### Task 1: Verify the invite-link mechanics before designing around them

The spec (§6.3) reasons from the documented shape of `generateLink`'s response rather than from code in this repo. This task is a throwaway probe. **Nothing it produces is committed.** If it fails, stop and report — the rest of Task 7 changes shape.

**Files:**
- Create: nothing. Work in your scratch directory.

**Interfaces:**
- Consumes: nothing.
- Produces: a yes/no answer that Task 7 depends on — does `generateLink` return `properties.hashed_token`, and does `verifyOtp({ token_hash, type: "magiclink" })` accept it?

- [ ] **Step 1: Write the probe against the LOCAL stack**

```ts
// scratch/probe-link.ts — run with: pnpm exec tsx scratch/probe-link.ts
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data, error } = await svc.auth.admin.generateLink({
  type: "magiclink",
  email: "admin@racepace.test",
});
if (error) throw error;

console.log("hashed_token present:", Boolean(data.properties?.hashed_token));
console.log("action_link:", data.properties?.action_link);

// The question that matters: can a SERVER exchange it without a browser?
const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const verified = await anon.auth.verifyOtp({
  token_hash: data.properties!.hashed_token!,
  type: "magiclink",
});
console.log("verifyOtp session:", Boolean(verified.data.session), verified.error?.message);
```

- [ ] **Step 2: Run it**

Run: `pnpm exec tsx scratch/probe-link.ts`
Expected: `hashed_token present: true` and `verifyOtp session: true`.

- [ ] **Step 3: Record the outcome and delete the probe**

If both are true, Task 7 proceeds as specified. If `verifyOtp` fails, **STOP and report** — the fallback is a client component reading the URL fragment, which is a different design and needs the spec amended first.

```bash
rm scratch/probe-link.ts
```

Nothing to commit.

---

### Task 2: The migration — policies, RPC, grants

**Files:**
- Create: `supabase/migrations/20260818120000_org_management.sql`
- Test: `supabase/tests/org-management.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `delete_organization_tx(p_org_id uuid) returns jsonb` — returns `{events, categories, registrations, payments, checkins, members, payout_statements}` as counts of what it deleted; raises `org_has_payments` (SQLSTATE P0001) when settled money exists, `org_not_found` (P0002) when the id matches no row. EXECUTE granted to `service_role` only. Task 5 calls it.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/tests/org-management.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

async function signedIn(email: string) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

const trash: string[] = [];
afterEach(async () => {
  // Best-effort: a test that already deleted its org leaves a no-op here.
  for (const id of trash.splice(0)) await svc().from("organizations").delete().eq("id", id);
});

/** An org with an event, TWO categories, and a registration in each.
 *  Two categories is the point: one category cannot reproduce the ordering
 *  hazard this RPC exists to avoid. */
async function makeOrg(slug: string) {
  const db = svc();
  const { data: org } = await db.from("organizations")
    .insert({ name: `T ${slug}`, slug, commission_type: "percent", commission_rate: 0.03 })
    .select("id").single();
  trash.push(org!.id);

  const { data: ev } = await db.from("events")
    .insert({ org_id: org!.id, name: "T Race", status: "open" }).select("id").single();

  const cats = [];
  for (const code of ["10k", "21k"]) {
    const { data: c } = await db.from("categories")
      .insert({ org_id: org!.id, event_id: ev!.id, code, label: code.toUpperCase(), base_price: 100000 })
      .select("id").single();
    cats.push(c!.id);
  }

  const regs = [];
  for (const [i, catId] of cats.entries()) {
    const { data: u } = await db.auth.admin.createUser({
      email: `t-${slug}-${i}@racepace.test`, password: "password123", email_confirm: true,
    });
    const { data: r } = await db.from("registrations")
      .insert({ org_id: org!.id, event_id: ev!.id, category_id: catId, user_id: u!.user!.id })
      .select("id").single();
    regs.push({ id: r!.id, userId: u!.user!.id });
  }

  return { orgId: org!.id, eventId: ev!.id, cats, regs };
}

describe("delete_organization_tx", () => {
  it("deletes an org whose registrations span several categories", async () => {
    const { orgId, regs } = await makeOrg("t-del-ok");

    const { data, error } = await svc().rpc("delete_organization_tx", { p_org_id: orgId });

    // A plain `delete from organizations` fails here: registrations.category_id
    // is ON DELETE NO ACTION while both tables cascade from the org, so
    // Postgres may reach the categories before the registrations.
    expect(error).toBeNull();
    expect(data).toMatchObject({ events: 1, categories: 2, registrations: 2 });

    const after = await svc().from("organizations").select("id").eq("id", orgId);
    expect(after.data).toHaveLength(0);
    const orphans = await svc().from("registrations").select("id").in("id", regs.map((r) => r.id));
    expect(orphans.data).toHaveLength(0);
  });

  it.each(["paid", "refunded", "partially_refunded"])(
    "refuses to delete an org with a %s payment", async (status) => {
      const { orgId, regs } = await makeOrg(`t-del-${status.slice(0, 6)}`);
      await svc().from("payments").insert({
        org_id: orgId, registration_id: regs[0].id, amount: 100000, status,
      });

      const { error } = await svc().rpc("delete_organization_tx", { p_org_id: orgId });

      expect(error?.message).toMatch(/org_has_payments/);
      const still = await svc().from("organizations").select("id").eq("id", orgId);
      expect(still.data).toHaveLength(1);
    });

  it.each(["pending", "failed"])("allows deletion when payments are only %s", async (status) => {
    const { orgId, regs } = await makeOrg(`t-del-${status}`);
    await svc().from("payments").insert({
      org_id: orgId, registration_id: regs[0].id, amount: 100000, status,
    });

    const { error } = await svc().rpc("delete_organization_tx", { p_org_id: orgId });
    expect(error).toBeNull();
  });

  it("raises org_not_found for an id that matches nothing", async () => {
    const { error } = await svc().rpc("delete_organization_tx", {
      p_org_id: "00000000-0000-0000-0000-0000000000ff",
    });
    expect(error?.message).toMatch(/org_not_found/);
  });
});

describe("a suspended organization", () => {
  const MUSPO = "00000000-0000-0000-0000-00000000a001";

  afterEach(async () => {
    await svc().from("organizations").update({ is_active: true }).eq("id", MUSPO);
  });

  it("is invisible to anon but still visible to its own admin and the super admin", async () => {
    await svc().from("organizations").update({ is_active: false }).eq("id", MUSPO);

    const asAnon = await anon().from("organizations").select("id").eq("id", MUSPO);
    expect(asAnon.data).toHaveLength(0);

    // The regression this guards: `orgs_read_active` used to be
    // `using (is_active = true)`, which hid a suspended org from the very page
    // a super admin would un-suspend it from, and broke the console for the
    // org's own staff.
    const asOrgAdmin = await (await signedIn("muspo@racepace.test"))
      .from("organizations").select("id").eq("id", MUSPO);
    expect(asOrgAdmin.data).toHaveLength(1);

    const asSuper = await (await signedIn("admin@racepace.test"))
      .from("organizations").select("id").eq("id", MUSPO);
    expect(asSuper.data).toHaveLength(1);
  });

  it("has its events removed from the storefront but not from its own console", async () => {
    const before = await anon().from("events").select("id").eq("org_id", MUSPO);
    expect(before.data!.length).toBeGreaterThan(0);

    await svc().from("organizations").update({ is_active: false }).eq("id", MUSPO);

    const asAnon = await anon().from("events").select("id").eq("org_id", MUSPO);
    expect(asAnon.data).toHaveLength(0);

    // events_read_org_admin is a separate permissive policy; policies are OR'd.
    const asOrgAdmin = await (await signedIn("muspo@racepace.test"))
      .from("events").select("id").eq("org_id", MUSPO);
    expect(asOrgAdmin.data!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec vitest run supabase/tests/org-management.test.ts`
Expected: FAIL — `delete_organization_tx` does not exist (`PGRST202`), and the suspended-org reads return 0 rows for the org admin.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260818120000_org_management.sql
--
-- Organization management: suspend and delete, from the platform console.
--
-- Three changes, each with an incident behind it. See
-- docs/specs/2026-08-18-org-management-design.md.

-- ---------------------------------------------------------------------------
-- 1. A suspended org must stay visible to the people who manage it
-- ---------------------------------------------------------------------------
-- `orgs_read_active` was `using (is_active = true)` — for EVERY authenticated
-- caller, super admin included. Suspending an org therefore removed it from the
-- one page a super admin would un-suspend it from, and blanked the console for
-- the org's own staff. Recorded as a KNOWN LIMITATION in
-- apps/web/lib/queries/organizations.ts before this migration existed.
--
-- auth_can_admin_org short-circuits on auth_is_super_admin(), so one predicate
-- covers both. Anonymous callers match neither branch, so the storefront still
-- cannot see a suspended organization.
drop policy if exists orgs_read_active on organizations;
create policy orgs_read_active on organizations
  for select using (is_active or auth_can_admin_org(id));

-- ---------------------------------------------------------------------------
-- 2. A suspended org's events leave the storefront
-- ---------------------------------------------------------------------------
-- `events_read_published` was `status <> 'draft'` and never looked at the org,
-- so suspending an organization left its whole catalog on sale. Hiding the org
-- row alone does nothing here: events are read by their own policy.
--
-- `events_read_org_admin` (auth_can_admin_org(org_id)) is a separate permissive
-- policy and is untouched — policies are OR'd, so org staff keep full sight of
-- their own events while suspended.
drop policy if exists events_read_published on events;
create policy events_read_published on events
  for select using (
    status <> 'draft'::event_status
    and exists (
      select 1 from organizations o
       where o.id = events.org_id and o.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Deleting an organization
-- ---------------------------------------------------------------------------
-- WHY THIS IS A FUNCTION AND NOT `delete from organizations`:
--
-- registrations.category_id -> categories is ON DELETE NO ACTION, while
-- registrations AND categories both cascade from organizations. Postgres does
-- not promise it reaches the registrations before the categories, so a plain
-- delete can abort with a foreign-key violation on any org that has both — it
-- works on an empty test org and fails on a real one.
--
-- The order below is explicit, and the whole thing is one transaction.
create or replace function delete_organization_tx(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_blocking int;
  v_counts   jsonb;
begin
  if not exists (select 1 from organizations where id = p_org_id) then
    raise exception 'org_not_found' using errcode = 'P0002';
  end if;

  -- The money guard is re-checked HERE, not only in the Edge Function, so the
  -- invariant survives any future caller. `refunded` and `partially_refunded`
  -- block as hard as `paid`: a refund is still money that moved and still a
  -- PayMongo record that may have to be reconciled.
  select count(*) into v_blocking
    from payments
   where org_id = p_org_id
     and status in ('paid', 'refunded', 'partially_refunded');
  if v_blocking > 0 then
    raise exception 'org_has_payments: % settled payment(s)', v_blocking
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'events',            (select count(*) from events            where org_id = p_org_id),
    'categories',        (select count(*) from categories        where org_id = p_org_id),
    'registrations',     (select count(*) from registrations     where org_id = p_org_id),
    'payments',          (select count(*) from payments          where org_id = p_org_id),
    'checkins',          (select count(*) from checkins          where org_id = p_org_id),
    'members',           (select count(*) from user_roles        where org_id = p_org_id),
    'payout_statements', (select count(*) from payout_statements where org_id = p_org_id)
  ) into v_counts;

  -- Registrations first: this is the ordering the NO ACTION constraint needs.
  -- Cascades registration_addons, registration_audit, payments, checkins.
  delete from registrations where org_id = p_org_id;
  delete from categories    where org_id = p_org_id;
  -- Cascades events, addons, form_fields, payout_statements, user_roles.
  delete from organizations where id = p_org_id;

  return v_counts;
end;
$fn$;

-- Postgres grants EXECUTE to PUBLIC on every newly created function by built-in
-- default, so this revoke/grant pair is not optional — and a missing grant has
-- bitten this repo three times. (20260808120200 once enforced this with an event
-- trigger; it was reversed by 20260808130000 and the guard is now
-- supabase/tests/function-grants.test.ts.) service_role ONLY: the org-provision
-- Edge Function is the sole caller, and nothing reachable by a browser should be
-- able to erase an organization.
revoke all on function delete_organization_tx(uuid) from public;
grant execute on function delete_organization_tx(uuid) to service_role;

-- Proof, not assumption. Inspecting pg_default_acl is not proof.
do $check$
begin
  if not has_function_privilege('service_role', 'delete_organization_tx(uuid)', 'EXECUTE') then
    raise exception 'delete_organization_tx: service_role EXECUTE grant missing';
  end if;
  if has_function_privilege('authenticated', 'delete_organization_tx(uuid)', 'EXECUTE') then
    raise exception 'delete_organization_tx: authenticated must not hold EXECUTE';
  end if;
  if has_function_privilege('anon', 'delete_organization_tx(uuid)', 'EXECUTE') then
    raise exception 'delete_organization_tx: anon must not hold EXECUTE';
  end if;
end
$check$;
```

- [ ] **Step 4: Apply it and run the tests**

```bash
pnpm exec supabase db reset
pnpm exec vitest run supabase/tests/org-management.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Run the two suites this migration could break**

```bash
pnpm exec vitest run supabase/tests/function-grants.test.ts supabase/tests/processor-fee-ledger.test.ts
```

Expected: PASS, both **unmodified**. `function-grants` asserts nothing new in `public` is authenticated-executable — `delete_organization_tx` must not appear in its `AUTHENTICATED_ALLOWLIST`. `processor-fee-ledger:192` asserts `authenticated` cannot write `is_active`; this migration adds no column grants, so it stays green.

- [ ] **Step 6: Run the whole backend suite**

Run: `pnpm test`
Expected: PASS. The `events_read_published` change is the risky one — anything that reads events as anon now depends on the parent org being active.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260818120000_org_management.sql supabase/tests/org-management.test.ts
git commit -m "feat(orgs): suspend-aware RLS and a transactional org delete"
```

---

### Task 3: Checkout refuses a suspended organization

**Files:**
- Modify: `supabase/functions/registrations-checkout/index.ts:42-46`
- Test: `supabase/tests/org-management.test.ts` (append)

**Interfaces:**
- Consumes: `organizations.is_active` from Task 2's migration.
- Produces: a `409 { error: "org_suspended" }` response from `registrations-checkout`.

RLS hides a suspended org's events from the storefront. It does not stop a POST carrying an event id someone already holds — this function runs on the service role, where RLS does not apply. The check belongs next to the closed-event refusal, which exists for exactly this reason.

- [ ] **Step 1: Write the failing test**

```ts
// append to supabase/tests/org-management.test.ts
describe("registrations-checkout on a suspended org", () => {
  const MUSPO = "00000000-0000-0000-0000-00000000a001";
  afterEach(async () => {
    await svc().from("organizations").update({ is_active: true }).eq("id", MUSPO);
  });

  it("refuses a direct call with an event id already in hand", async () => {
    const db = svc();
    const { data: cat } = await db.from("categories")
      .select("id,event_id").eq("org_id", MUSPO).limit(1).single();

    const { data: u } = await db.auth.admin.createUser({
      email: "t-suspended-checkout@racepace.test", password: "password123", email_confirm: true,
    });
    const runner = await signedIn("t-suspended-checkout@racepace.test");

    await db.from("organizations").update({ is_active: false }).eq("id", MUSPO);

    const { data, error } = await runner.functions.invoke("registrations-checkout", {
      body: {
        event_id: cat!.event_id, category_id: cat!.id,
        waiver_accepted: true, answers: {},
      },
    });

    const code = data?.error ?? await (error as { context?: Response })?.context
      ?.clone().json().then((b: { error?: string }) => b?.error).catch(() => undefined);
    expect(code).toBe("org_suspended");

    await db.auth.admin.deleteUser(u!.user!.id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

The function must be served locally for this test:

```bash
pnpm exec supabase functions serve --no-verify-jwt &
pnpm exec vitest run supabase/tests/org-management.test.ts -t "already in hand"
```

Expected: FAIL — the call succeeds or returns a different code, because nothing checks `is_active`.

- [ ] **Step 3: Add the gate**

In `supabase/functions/registrations-checkout/index.ts`, extend the existing event read (currently lines 42-46) and add the refusal directly under the closed-event one:

```ts
    // Authoritative: the page-level `isRegistrationClosed` check is a UX
    // nicety only, not a boundary — a cancelled/closed/completed event must
    // never accept a new registration or checkout, even via a direct call
    // with a stale category id already in hand.
    //
    // The org's is_active rides along for the same reason. RLS removes a
    // suspended org's events from the storefront, but this function holds the
    // service role and RLS does not apply to it — so a direct call with an
    // event id already in hand would still sell a slot for an organization the
    // platform has switched off.
    const { data: event } = await db
      .from("events")
      .select("status, registration_closes_at, organizations(is_active)")
      .eq("id", category.event_id)
      .single();
    if (!event) return json({ error: "category_not_found" }, 404);
    if (isRegistrationClosed(event.status, event.registration_closes_at)) {
      return json({ error: "registration_closed" }, 409);
    }
    const org = event.organizations as unknown as { is_active: boolean } | null;
    if (!org?.is_active) return json({ error: "org_suspended" }, 409);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run supabase/tests/org-management.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the checkout regression suites**

Run: `pnpm exec vitest run supabase/tests/registration-gate.test.ts supabase/tests/event-deadlines.test.ts`
Expected: PASS — the embedded select must not have changed the shape anything else reads.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/registrations-checkout/index.ts supabase/tests/org-management.test.ts
git commit -m "feat(checkout): refuse registrations for a suspended organization"
```

---

### Task 4: `org-provision` — rename and suspend

**Files:**
- Modify: `supabase/functions/org-provision/index.ts`
- Create: `supabase/functions/_shared/orgAdmin.ts`
- Test: `supabase/functions/_shared/orgAdmin.test.ts`

**Interfaces:**
- Consumes: the super-admin gate already at `org-provision/index.ts:124`, which runs before every action branch.
- Produces:
  - `validateRename(name: string): string | null` — error code or null.
  - `org-provision` actions `update` (`{org_id, name}` → `{ok, org}`) and `set_active` (`{org_id, is_active}` → `{ok, org}`).

The repo has no HTTP-level tests for Edge Functions. The established pattern is pure helpers in `_shared/*.test.ts` (see `_shared/team.test.ts`) plus DB-level integration tests. Follow it: the validator is unit-tested, the authorization boundary is already covered by the existing gate.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/orgAdmin.test.ts
import { describe, it, expect } from "vitest";
import { validateRename, orgStoragePrefixes, isDeleteBlocked } from "./orgAdmin";

describe("validateRename", () => {
  it("accepts an ordinary name", () => {
    expect(validateRename("Muspo Trail Events")).toBeNull();
  });
  // The slug is immutable and the name is not, so a rename to whitespace would
  // leave an organization with no readable identity anywhere in the console.
  it("rejects empty and whitespace-only names", () => {
    expect(validateRename("")).toBe("name_required");
    expect(validateRename("   ")).toBe("name_required");
  });
  it("rejects a name longer than 120 characters", () => {
    expect(validateRename("x".repeat(121))).toBe("name_too_long");
    expect(validateRename("x".repeat(120))).toBeNull();
  });
});

describe("isDeleteBlocked", () => {
  // Blocking on `refunded` is deliberate: a refund is still money that moved
  // and still a PayMongo record that may have to be reconciled.
  it("blocks on paid, refunded and partially_refunded", () => {
    expect(isDeleteBlocked({ paid: 1, refunded: 0, partially_refunded: 0 })).toBe(true);
    expect(isDeleteBlocked({ paid: 0, refunded: 2, partially_refunded: 0 })).toBe(true);
    expect(isDeleteBlocked({ paid: 0, refunded: 0, partially_refunded: 1 })).toBe(true);
  });
  it("does not block when nothing settled", () => {
    expect(isDeleteBlocked({ paid: 0, refunded: 0, partially_refunded: 0 })).toBe(false);
  });
});

describe("orgStoragePrefixes", () => {
  it("names the two buckets an organization owns files in", () => {
    expect(orgStoragePrefixes("abc")).toEqual([
      { bucket: "event-images", prefix: "abc" },
      { bucket: "org-images", prefix: "abc" },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run supabase/functions/_shared/orgAdmin.test.ts`
Expected: FAIL — `Cannot find module './orgAdmin'`.

- [ ] **Step 3: Write the helper**

```ts
// supabase/functions/_shared/orgAdmin.ts
//
// Pure helpers for the organization-management actions on org-provision.
// Split out for the same reason _shared/team.ts is: the Edge Function itself
// has no HTTP test harness in this repo, so anything with a decision in it
// lives here where it can be unit-tested.

/** Rename validation. The SLUG is immutable — it is in live event URLs and in
 *  any link an organizer has already shared — so `name` is the only field a
 *  rename may touch. */
export function validateRename(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "name_required";
  if (trimmed.length > 120) return "name_too_long";
  return null;
}

export type SettledCounts = { paid: number; refunded: number; partially_refunded: number };

/** Money moved, so the ledger cannot be erased. Suspend is the answer for a
 *  live organization; there is no override. */
export function isDeleteBlocked(c: SettledCounts): boolean {
  return c.paid + c.refunded + c.partially_refunded > 0;
}

/** The two buckets an organization owns files in. Objects are keyed
 *  <bucket>/<org_id>/<uuid>.<ext> — see 20260721110000_event_images_storage.sql
 *  and 20260724130000_org_images.sql. */
export function orgStoragePrefixes(orgId: string): { bucket: string; prefix: string }[] {
  return [
    { bucket: "event-images", prefix: orgId },
    { bucket: "org-images", prefix: orgId },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run supabase/functions/_shared/orgAdmin.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the two actions to `org-provision`**

Import at the top of `supabase/functions/org-provision/index.ts`:

```ts
import { validateRename } from "../_shared/orgAdmin.ts";
```

Insert both branches immediately after the `check_slug` branch and BEFORE the `if (action !== "create")` line — that line becomes the fall-through for unknown actions and must stay last:

```ts
    // Every branch below inherits the super_admin gate above. Service role on
    // purpose: `name` happens to be in the column grant today and `is_active`
    // deliberately is not, and a rename path that depended on that distinction
    // would break the moment the grant is tightened again.
    const ORG_COLUMNS =
      "id,name,slug,commission_type,commission_rate,commission_flat_cents,refund_policy,refund_fee_cents,is_active,created_at";

    if (action === "update") {
      const orgId = String(body.org_id ?? "");
      const name = String(body.name ?? "");
      if (!orgId) return json({ error: "bad_request" }, 400);
      const invalid = validateRename(name);
      if (invalid) return json({ error: invalid }, 400);

      const { data: org, error } = await db
        .from("organizations")
        .update({ name: name.trim() })
        .eq("id", orgId)
        .select(ORG_COLUMNS)
        .maybeSingle();
      if (error) return json({ error: "server_error" }, 500);
      if (!org) return json({ error: "not_found" }, 404);
      return json({ ok: true, org });
    }

    if (action === "set_active") {
      const orgId = String(body.org_id ?? "");
      if (!orgId || typeof body.is_active !== "boolean") return json({ error: "bad_request" }, 400);

      const { data: org, error } = await db
        .from("organizations")
        .update({ is_active: body.is_active })
        .eq("id", orgId)
        .select(ORG_COLUMNS)
        .maybeSingle();
      if (error) return json({ error: "server_error" }, 500);
      if (!org) return json({ error: "not_found" }, 404);
      return json({ ok: true, org });
    }
```

- [ ] **Step 6: Typecheck the function**

Run: `pnpm exec deno check supabase/functions/org-provision/index.ts`
Expected: no errors. (If `deno` is not installed, skip — `supabase functions deploy` typechecks on the way out.)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/orgAdmin.ts supabase/functions/_shared/orgAdmin.test.ts supabase/functions/org-provision/index.ts
git commit -m "feat(orgs): add rename and suspend actions to org-provision"
```

---

### Task 5: `org-provision` — delete preview and delete

**Files:**
- Modify: `supabase/functions/org-provision/index.ts`
- Test: `supabase/functions/_shared/orgAdmin.test.ts` (already covers the pure parts from Task 4)

**Interfaces:**
- Consumes: `delete_organization_tx` (Task 2), `isDeleteBlocked` and `orgStoragePrefixes` (Task 4).
- Produces:
  - `delete_preview` (`{org_id}`) → `{ok, counts, blocked, blocking}` where `counts` has `events, categories, registrations, payments, checkins, members, payout_statements` and `blocking` is `SettledCounts | null`.
  - `delete` (`{org_id, slug}`) → `{ok, deleted, storage_cleanup}` where `storage_cleanup` is `"complete" | "partial"`.

- [ ] **Step 1: Add the preview branch**

Import alongside Task 4's import:

```ts
import { validateRename, isDeleteBlocked, orgStoragePrefixes, type SettledCounts } from "../_shared/orgAdmin.ts";
```

Add after the `set_active` branch:

```ts
    /** Counts for the confirm dialog AND the guard decision. The browser
     *  renders the reason; it never decides it — `delete` re-runs the same
     *  check server-side before touching anything. */
    async function orgCounts(orgId: string) {
      const head = async (table: string) => {
        const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
        return count ?? 0;
      };
      const settled = async (status: string) => {
        const { count } = await db.from("payments")
          .select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", status);
        return count ?? 0;
      };
      const [events, categories, registrations, payments, checkins, members, payout_statements] =
        await Promise.all([
          head("events"), head("categories"), head("registrations"),
          head("payments"), head("checkins"), head("user_roles"), head("payout_statements"),
        ]);
      const blocking: SettledCounts = {
        paid: await settled("paid"),
        refunded: await settled("refunded"),
        partially_refunded: await settled("partially_refunded"),
      };
      return {
        counts: { events, categories, registrations, payments, checkins, members, payout_statements },
        blocking,
      };
    }

    if (action === "delete_preview") {
      const orgId = String(body.org_id ?? "");
      if (!orgId) return json({ error: "bad_request" }, 400);
      const { data: org } = await db.from("organizations").select("id").eq("id", orgId).maybeSingle();
      if (!org) return json({ error: "not_found" }, 404);

      const { counts, blocking } = await orgCounts(orgId);
      const blocked = isDeleteBlocked(blocking);
      return json({ ok: true, counts, blocked, blocking: blocked ? blocking : null });
    }
```

- [ ] **Step 2: Add the delete branch**

```ts
    if (action === "delete") {
      const orgId = String(body.org_id ?? "");
      const slug = String(body.slug ?? "");
      if (!orgId || !slug) return json({ error: "bad_request" }, 400);

      const { data: org } = await db
        .from("organizations").select("id,slug,name").eq("id", orgId).maybeSingle();
      if (!org) return json({ error: "not_found" }, 404);

      // Not the UI's confirmation — the dialog has its own. This is the guard
      // against a mis-targeted call reaching the function at all, which is the
      // one mistake here that has no undo.
      if (org.slug !== slug) return json({ error: "slug_mismatch" }, 400);

      // The preview is advisory. THIS is the gate — and delete_organization_tx
      // re-checks it a third time, so the invariant survives a future caller
      // that never comes through here.
      const { blocking } = await orgCounts(orgId);
      if (isDeleteBlocked(blocking)) return json({ error: "org_has_payments", blocking }, 409);

      const { data: deleted, error: rpcErr } = await db.rpc("delete_organization_tx", { p_org_id: orgId });
      if (rpcErr) {
        return json({
          error: rpcErr.message?.includes("org_has_payments") ? "org_has_payments"
            : rpcErr.message?.includes("org_not_found") ? "not_found"
            : "server_error",
        }, rpcErr.message?.includes("org_has_payments") ? 409 : 500);
      }

      // AFTER the transaction commits, and deliberately not inside it: Postgres
      // cannot delete an S3 object, and a storage failure must not roll back a
      // delete whose rows are already gone. Orphaned files are reported, not
      // fatal.
      //
      // This is also the path that WORKS — the `supabase storage rm` CLI is a
      // silent no-op against projects on the new sb_secret_ API keys, but this
      // function holds a real service key.
      let storageOk = true;
      for (const { bucket, prefix } of orgStoragePrefixes(orgId)) {
        const { data: files, error: listErr } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
        if (listErr) { storageOk = false; continue; }
        const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
        if (paths.length === 0) continue;
        const { error: rmErr } = await db.storage.from(bucket).remove(paths);
        if (rmErr) storageOk = false;
      }
      if (!storageOk) console.error(`[org-provision] storage cleanup incomplete for org ${orgId}`);

      return json({
        ok: true, deleted, name: org.name,
        storage_cleanup: storageOk ? "complete" : "partial",
      });
    }
```

- [ ] **Step 3: Verify the unknown-action fall-through is still last**

Read the file and confirm `if (action !== "create") return json({ error: "unknown_action" }, 400);` sits AFTER all four new branches. A branch added below it is dead code that returns `unknown_action`.

- [ ] **Step 4: Run the shared tests**

Run: `pnpm exec vitest run supabase/functions/_shared/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/org-provision/index.ts
git commit -m "feat(orgs): add money-guarded delete and preview to org-provision"
```

---

### Task 6: The `/auth/confirm` route

**Files:**
- Create: `apps/web/app/auth/confirm/route.ts`
- Create: `apps/web/app/auth/confirm/route.test.ts`
- Modify: `apps/web/app/(auth)/login/login-form.tsx:12` (the `OAUTH_MESSAGES` map)

**Interfaces:**
- Consumes: Task 1's confirmed answer that `verifyOtp({ token_hash, type })` works server-side.
- Produces: `GET /auth/confirm?token_hash=…&type=magiclink&next=/team` — establishes the session and redirects. Task 7's generated link points here.

This is the half that makes the invite link work at all. Both existing callbacks handle `?code=` only; there is no `verifyOtp` or `token_hash` handling anywhere in the repo, and Supabase's `/auth/v1/verify` lands with tokens in the URL **fragment**, which a server route cannot read.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/auth/confirm/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));

import { GET } from "./route";

beforeEach(() => verifyOtp.mockReset());

function req(qs: string) {
  return new NextRequest(`https://admin.racepace.lan/auth/confirm${qs}`);
}

describe("GET /auth/confirm", () => {
  it("verifies the token and redirects to `next`", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(req("?token_hash=abc&type=magiclink&next=/team"));

    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "magiclink" });
    expect(res.status).toBe(307);
    // RELATIVE Location on purpose — the same lesson auth/callback/route.ts
    // documents: behind Traefik or on Vercel, an absolute origin resolves to
    // the server's own bind address, not the host the operator typed.
    expect(res.headers.get("location")).toBe("/team");
  });

  it("rejects an absolute `next` rather than open-redirecting", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const res = await GET(req("?token_hash=abc&type=magiclink&next=https://evil.example"));
    expect(res.headers.get("location")).not.toContain("evil.example");
  });

  it("sends an expired or reused link back to login with a reason", async () => {
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired" } });
    const res = await GET(req("?token_hash=abc&type=magiclink"));
    expect(res.headers.get("location")).toBe("/login?oauth=invite_expired");
  });

  it("does not call verifyOtp when the link carries no token", async () => {
    const res = await GET(req("?type=magiclink"));
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/login?oauth=invite_expired");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run app/auth/confirm/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the route**

```ts
// apps/web/app/auth/confirm/route.ts
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/routes";

/**
 * Magic-link / invite landing route.
 *
 * SEPARATE FROM /auth/callback ON PURPOSE. That route exchanges a PKCE `code`,
 * which only exists for a flow the browser itself started. An invite link is
 * generated server-side by org-provision, so there is no code verifier to
 * match — Supabase's own /auth/v1/verify endpoint answers those by redirecting
 * with the tokens in the URL FRAGMENT, which a server route cannot read. The
 * fix is to never send the operator through that endpoint: org-provision hands
 * out `hashed_token`, and this route redeems it with verifyOtp.
 *
 * Relative Location, like /auth/callback — behind Traefik (admin.racepace.lan)
 * or on Vercel, `request.nextUrl.origin` is the server's own bind address.
 */
function redirectRelative(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { location: path } });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "magiclink") as EmailOtpType;

  if (!tokenHash) return redirectRelative("/login?oauth=invite_expired");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    console.error("[auth/confirm] verifyOtp failed", error.message);
    return redirectRelative("/login?oauth=invite_expired");
  }

  // An invited admin has a role but no profile yet, so /team is the useful
  // landing spot. safeNextPath rejects anything that is not a same-site
  // relative path — an absolute target here would be an open redirect.
  return redirectRelative(safeNextPath(searchParams.get("next"), "/team"));
}
```

- [ ] **Step 4: Confirm the helper you are leaning on**

`safeNextPath(next: string | null | undefined, fallback: string)` — verified at
`apps/web/lib/routes.ts:68` while this plan was written. It already rejects
`//evil.com`, `/\evil.com`, backslashes and control characters, which is why
the open-redirect test above passes without any new validation here. Do not
change `lib/routes.ts` — `middleware.ts` uses it too.

- [ ] **Step 5: Add the login message**

In `apps/web/app/(auth)/login/login-form.tsx`, add one entry to `OAUTH_MESSAGES`:

```ts
  invite_expired: "That invite link has expired or was already used. Ask for a new one.",
```

A param the map does not know renders nothing at all, so without this entry the failure is silent.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter web exec vitest run app/auth/confirm/route.test.ts
pnpm --filter web typecheck
```

Expected: PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/auth/confirm apps/web/app/\(auth\)/login/login-form.tsx
git commit -m "feat(auth): add /auth/confirm so invite links can be redeemed"
```

---

### Task 7: Point the invite link at the console

**Files:**
- Modify: `supabase/functions/org-provision/index.ts` (the `generateLink` block near the end of the `create` branch)
- Modify: `supabase/config.toml:155-163`

**Interfaces:**
- Consumes: `/auth/confirm` (Task 6); the `ADMIN_APP_URL` function secret.
- Produces: `invite_link` in the `create` response, now pointing at the admin console.

- [ ] **Step 1: Update `config.toml`**

```toml
[auth]
# One Supabase project serves two apps, so site_url can only be right for one.
# The storefront wins it because runners are the volume; the console gets an
# explicit redirectTo from org-provision instead. Every host that may be
# redirected to has to be listed — including the Docker dev stack, or the invite
# flow works on Vercel and breaks locally.
site_url = "https://race-pace-site.vercel.app"
additional_redirect_urls = [
  "https://race-pace-admin.vercel.app/auth/confirm",
  "https://race-pace-admin.vercel.app/auth/callback",
  "https://race-pace-site.vercel.app/auth/callback",
  "https://admin.racepace.lan/auth/confirm",
  "https://admin.racepace.lan/auth/callback",
  "https://racepace.lan/auth/callback",
  "http://localhost:3000/auth/callback",
  "http://localhost:3001/auth/confirm",
  "http://localhost:3001/auth/callback",
]
```

Keep every other key in the `[auth]` block exactly as it is.

- [ ] **Step 2: Build the link from `hashed_token`**

Replace the `generateLink` block at the end of the `create` branch:

```ts
    // 'magiclink', not 'invite': the account exists by the time we get here.
    //
    // The RAW action_link is deliberately NOT returned. It routes through
    // Supabase's /auth/v1/verify, which lands on redirect_to with the tokens in
    // the URL FRAGMENT — unreadable by a server route, and neither app has a
    // client-side handler for it. What ships instead is a link to the console's
    // /auth/confirm, which redeems `hashed_token` with verifyOtp.
    //
    // Still best-effort: the org and its admin role are already committed, so a
    // link failure returns ok with invite_link: null rather than rolling back a
    // correctly provisioned organization over a convenience field.
    const adminUrl = (Deno.env.get("ADMIN_APP_URL") ?? "").replace(/\/+$/, "");
    const { data: link } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: input.admin_email,
      options: adminUrl ? { redirectTo: `${adminUrl}/auth/confirm` } : undefined,
    });
    const hashed = link?.properties?.hashed_token ?? null;
    const inviteLink: string | null = adminUrl && hashed
      ? `${adminUrl}/auth/confirm?token_hash=${hashed}&type=magiclink&next=%2Fteam`
      : null;
```

- [ ] **Step 3: Match the emailed link to the manual one**

Change the `inviteUserByEmail` call earlier in the same branch so the email lands in the same place once SMTP is configured:

```ts
      const { data: inv, error: invErr } = await db.auth.admin.inviteUserByEmail(
        input.admin_email,
        adminUrl ? { redirectTo: `${adminUrl}/auth/confirm` } : undefined,
      );
```

`adminUrl` must be read ABOVE this call — move the `const adminUrl = …` line to just after the super-admin gate so both uses share it.

- [ ] **Step 4: Verify against the local stack**

```bash
pnpm exec supabase functions serve --no-verify-jwt &
```

Provision a throwaway org through the console (or curl the function with a super-admin JWT) and confirm the returned `invite_link` starts with your `ADMIN_APP_URL` and contains `token_hash=`. Then open it and confirm it lands signed-in on `/team`.

For local serving, set the secret in `supabase/functions/.env`:

```
ADMIN_APP_URL=http://localhost:3001
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/org-provision/index.ts supabase/config.toml
git commit -m "fix(orgs): send the provisioning invite to the console, not localhost"
```

---

### Task 8: The 3% default and the Suspended label

**Files:**
- Modify: `apps/web/app/(admin)/organizations/new-org-dialog.tsx:69,77`
- Modify: `apps/web/app/(admin)/organizations/page.tsx` (the Status cell)
- Test: `apps/web/app/(admin)/organizations/new-org-dialog.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/(admin)/organizations/new-org-dialog.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke: vi.fn() } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { NewOrgDialog } from "./new-org-dialog";

describe("NewOrgDialog", () => {
  // The database default on organizations.commission_rate is 0.03. The form
  // used to open at 10%, so every org provisioned through the console
  // contradicted the schema's own default.
  it("opens at 3%", async () => {
    render(<NewOrgDialog />);
    await userEvent.click(screen.getByRole("button", { name: /new organization/i }));
    expect(screen.getByLabelText(/rate/i)).toHaveValue(3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run "app/(admin)/organizations/new-org-dialog.test.tsx"`
Expected: FAIL — received `10`.

If the dialog's trigger or rate input cannot be found by those queries, read the component and fix the QUERIES, not the component. The accessible name is whatever `new-org-dialog.tsx` already renders.

- [ ] **Step 3: Change the default**

`apps/web/app/(admin)/organizations/new-org-dialog.tsx` line 69 and the reset on line 77:

```ts
  const [percent, setPercent] = useState("3");
```

```ts
    setEmail(""); setCommissionType("percent"); setPercent("3"); setFlatPesos("");
```

- [ ] **Step 4: Relabel the inactive state**

In `page.tsx`, the Status cell currently reads `Inactive`. Suspension is now a deliberate operator action with a meaning, so name it:

```tsx
                      <StatusBadge tone={org.isActive ? "paid" : "neutral"}>
                        {org.isActive ? "Active" : "Suspended"}
                      </StatusBadge>
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter web exec vitest run "app/(admin)/organizations"
pnpm --filter web typecheck
```

Expected: PASS, 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(admin)/organizations"
git commit -m "fix(orgs): default the create dialog to 3% and name the suspended state"
```

---

### Task 9: Row actions — rename and suspend

**Files:**
- Create: `apps/web/app/(admin)/organizations/org-actions.tsx`
- Create: `apps/web/app/(admin)/organizations/org-actions.test.tsx`
- Modify: `apps/web/app/(admin)/organizations/page.tsx` (add a trailing cell)

**Interfaces:**
- Consumes: `org-provision` actions `update` and `set_active` (Task 4).
- Produces: `<OrgActions org={{ id, name, slug, isActive }} />` — a Client Component mounted in the last cell of each row. Tasks 10 and 11 add menu items to this same component.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/(admin)/organizations/org-actions.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { OrgActions } from "./org-actions";

const org = { id: "o1", name: "Muspo", slug: "muspo", isActive: true };

beforeEach(() => { invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null }); refresh.mockReset(); });

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /actions for muspo/i }));
}

describe("OrgActions", () => {
  it("renames through org-provision and refreshes the list", async () => {
    render(<OrgActions org={org} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /rename/i }));

    const field = screen.getByLabelText(/name/i);
    await userEvent.clear(field);
    await userEvent.type(field, "Muspo Trail");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(invoke).toHaveBeenCalledWith("org-provision", {
      body: { action: "update", org_id: "o1", name: "Muspo Trail" },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("will not submit an empty name", async () => {
    render(<OrgActions org={org} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /rename/i }));
    await userEvent.clear(screen.getByLabelText(/name/i));

    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  it("suspends an active org", async () => {
    render(<OrgActions org={org} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /suspend/i }));
    await userEvent.click(screen.getByRole("button", { name: /^suspend$/i }));

    expect(invoke).toHaveBeenCalledWith("org-provision", {
      body: { action: "set_active", org_id: "o1", is_active: false },
    });
  });

  it("offers unsuspend for a suspended org", async () => {
    render(<OrgActions org={{ ...org, isActive: false }} />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: /unsuspend/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^suspend$/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run "app/(admin)/organizations/org-actions.test.tsx"`
Expected: FAIL — `Cannot find module './org-actions'`.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/(admin)/organizations/org-actions.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type OrgSummary = { id: string; name: string; slug: string; isActive: boolean };

const MESSAGES: Record<string, string> = {
  name_required: "Enter a name.",
  name_too_long: "That name is too long.",
  not_found: "That organization no longer exists.",
  forbidden: "Only a super admin can do that.",
  server_error: "Something went wrong. Please try again.",
};

/** functions.invoke surfaces a non-2xx as an error whose body still holds the
 *  code — the same unwrap new-org-dialog.tsx does, and the code is the entire
 *  diagnosis. */
async function callOrgProvision(body: Record<string, unknown>): Promise<{ data?: Record<string, unknown>; code?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke("org-provision", { body });
  if (error || data?.error) {
    let code = data?.error as string | undefined;
    if (!code && error && "context" in error) {
      code = await (error as { context?: Response }).context?.clone().json()
        .then((b: { error?: string }) => b?.error).catch(() => undefined);
    }
    return { code: code ?? "server_error" };
  }
  return { data };
}

export function OrgActions({ org }: { org: OrgSummary }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [confirmingActive, setConfirmingActive] = useState(false);
  const [name, setName] = useState(org.name);
  const [busy, setBusy] = useState(false);

  async function rename() {
    setBusy(true);
    const { code } = await callOrgProvision({ action: "update", org_id: org.id, name: name.trim() });
    setBusy(false);
    if (code) return toast.error(MESSAGES[code] ?? MESSAGES.server_error);
    setRenaming(false);
    toast.success(`Renamed to ${name.trim()}.`);
    // The list is a Server Component — refresh, don't mutate local state.
    router.refresh();
  }

  async function setActive(next: boolean) {
    setBusy(true);
    const { code } = await callOrgProvision({ action: "set_active", org_id: org.id, is_active: next });
    setBusy(false);
    if (code) return toast.error(MESSAGES[code] ?? MESSAGES.server_error);
    setConfirmingActive(false);
    toast.success(next ? `${org.name} is live again.` : `${org.name} is suspended.`);
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${org.name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { setName(org.name); setRenaming(true); }}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setConfirmingActive(true)}>
            {org.isActive ? "Suspend" : "Unsuspend"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename organization</DialogTitle>
            <DialogDescription>
              The URL stays /{org.slug}. Slugs are fixed once an organization exists.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="org-rename">Name</Label>
            <Input id="org-rename" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>Cancel</Button>
            <Button onClick={rename} disabled={busy || !name.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingActive} onOpenChange={setConfirmingActive}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{org.isActive ? "Suspend" : "Unsuspend"} {org.name}?</DialogTitle>
            <DialogDescription>
              {org.isActive
                ? "Its events leave the runner site and it stops taking registrations. Entries already paid stay valid, and its team keeps console access."
                : "Its events return to the runner site and it can take registrations again."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingActive(false)}>Cancel</Button>
            <Button onClick={() => setActive(!org.isActive)} disabled={busy}>
              {org.isActive ? "Suspend" : "Unsuspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Mount it in the table**

In `page.tsx`, add a header cell after Status:

```tsx
              <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>
```

and a body cell as the last child of each `<TableRow>`:

```tsx
                    <TableCell className="text-right">
                      <OrgActions org={{ id: org.id, name: org.name, slug: org.slug, isActive: org.isActive }} />
                    </TableCell>
```

Import it, and bump the empty-state `colSpan={6}` to `colSpan={7}`.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter web exec vitest run "app/(admin)/organizations"
pnpm --filter web typecheck
```

Expected: PASS, 0 type errors. `page.test.tsx` stubs `./new-org-dialog`; add a matching stub for `./org-actions` if the page test starts pulling in client-only code.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(admin)/organizations"
git commit -m "feat(orgs): add row actions for rename and suspend"
```

---

### Task 10: The delete dialog

**Files:**
- Modify: `apps/web/app/(admin)/organizations/org-actions.tsx`
- Modify: `apps/web/app/(admin)/organizations/org-actions.test.tsx`

**Interfaces:**
- Consumes: `org-provision` actions `delete_preview` and `delete` (Task 5).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to apps/web/app/(admin)/organizations/org-actions.test.tsx
describe("OrgActions — delete", () => {
  function previewReturning(preview: Record<string, unknown>) {
    invoke.mockImplementation((_fn: string, opts: { body: { action: string } }) =>
      opts.body.action === "delete_preview"
        ? Promise.resolve({ data: { ok: true, ...preview }, error: null })
        : Promise.resolve({ data: { ok: true }, error: null }));
  }

  const clean = {
    counts: { events: 2, categories: 3, registrations: 0, payments: 0, checkins: 0, members: 1, payout_statements: 0 },
    blocked: false, blocking: null,
  };

  it("requires the slug typed exactly before deleting", async () => {
    previewReturning(clean);
    render(<OrgActions org={org} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    const confirm = await screen.findByRole("button", { name: /delete organization/i });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/type the slug/i), "musp");
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/type the slug/i), "o");
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    expect(invoke).toHaveBeenCalledWith("org-provision", {
      body: { action: "delete", org_id: "o1", slug: "muspo" },
    });
  });

  it("shows what will be destroyed", async () => {
    previewReturning(clean);
    render(<OrgActions org={org} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    expect(await screen.findByText(/2 events/i)).toBeInTheDocument();
    expect(screen.getByText(/3 categories/i)).toBeInTheDocument();
  });

  it("refuses when money has moved, and says why", async () => {
    previewReturning({
      counts: { events: 4, categories: 9, registrations: 412, payments: 412, checkins: 0, members: 2, payout_statements: 1 },
      blocked: true,
      blocking: { paid: 400, refunded: 10, partially_refunded: 2 },
    });
    render(<OrgActions org={org} />);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    // The guard is the edge function's decision, rendered — never recomputed here.
    expect(await screen.findByText(/412 settled payments/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete organization/i })).toBeDisabled();
    expect(screen.queryByLabelText(/type the slug/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web exec vitest run "app/(admin)/organizations/org-actions.test.tsx"`
Expected: FAIL — no Delete menu item.

- [ ] **Step 3: Add the delete state and dialog**

Add to `OrgActions`:

```tsx
type Preview = {
  counts: Record<string, number>;
  blocked: boolean;
  blocking: { paid: number; refunded: number; partially_refunded: number } | null;
};

  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typedSlug, setTypedSlug] = useState("");

  async function openDelete() {
    setPreview(null);
    setTypedSlug("");
    setDeleting(true);
    const { data, code } = await callOrgProvision({ action: "delete_preview", org_id: org.id });
    if (code) { setDeleting(false); return toast.error(MESSAGES[code] ?? MESSAGES.server_error); }
    setPreview(data as unknown as Preview);
  }

  async function destroy() {
    setBusy(true);
    const { code } = await callOrgProvision({ action: "delete", org_id: org.id, slug: org.slug });
    setBusy(false);
    if (code) return toast.error(DELETE_MESSAGES[code] ?? MESSAGES.server_error);
    setDeleting(false);
    toast.success(`${org.name} deleted.`);
    router.refresh();
  }
```

with the extra codes:

```tsx
const DELETE_MESSAGES: Record<string, string> = {
  ...MESSAGES,
  org_has_payments: "This organization has taken payments. Suspend it instead.",
  slug_mismatch: "That slug doesn't match. Nothing was deleted.",
};
```

the menu item:

```tsx
          <DropdownMenuItem variant="destructive" onSelect={openDelete}>
            Delete
          </DropdownMenuItem>
```

and the dialog:

```tsx
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {org.name}?</DialogTitle>
            <DialogDescription>
              {preview?.blocked
                ? "This cannot be deleted."
                : "This cannot be undone. Everything below is destroyed."}
            </DialogDescription>
          </DialogHeader>

          {!preview ? (
            <p className="text-[13px] text-muted-foreground">Checking…</p>
          ) : preview.blocked ? (
            <p className="text-[13px]">
              {settledTotal(preview)} settled payments are attached to this organization.
              Deleting it would destroy the record of money that actually moved.
              Suspend it instead.
            </p>
          ) : (
            <>
              <ul className="text-[13px] text-muted-foreground">
                <li>{preview.counts.events} events</li>
                <li>{preview.counts.categories} categories</li>
                <li>{preview.counts.registrations} registrations</li>
                <li>{preview.counts.members} team members</li>
              </ul>
              <div className="grid gap-2">
                <Label htmlFor="org-del-slug">Type the slug ({org.slug}) to confirm</Label>
                <Input id="org-del-slug" value={typedSlug} onChange={(e) => setTypedSlug(e.target.value)} />
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={destroy}
              disabled={busy || !preview || preview.blocked || typedSlug !== org.slug}
            >
              Delete organization
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

with the helper above the component:

```tsx
function settledTotal(p: Preview): number {
  const b = p.blocking;
  return b ? b.paid + b.refunded + b.partially_refunded : 0;
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter web exec vitest run "app/(admin)/organizations"
pnpm --filter web typecheck
```

Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/organizations"
git commit -m "feat(orgs): add the guarded delete dialog"
```

---

### Task 11: The manage-admins dialog

**Files:**
- Create: `apps/web/app/(admin)/organizations/manage-admins-dialog.tsx`
- Create: `apps/web/app/(admin)/organizations/manage-admins-dialog.test.tsx`
- Modify: `apps/web/app/(admin)/organizations/org-actions.tsx` (one menu item)
- Modify: `apps/web/lib/actions/team.ts` (revalidate `/organizations` too)

**Interfaces:**
- Consumes: `org-members` actions `list`, `invite`, `setRole`, `remove` — all of which already authorize a super admin for ANY `org_id` (`supabase/functions/org-members/index.ts:60`). No backend change.
- Produces: `<ManageAdminsDialog org={…} open onOpenChange />`.

This is the "update the organization's admin email" capability. The backend has always supported it; `/team` just scopes to `requireOrgId(roles)`, which is `null` for a super admin, so there was no way in.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/(admin)/organizations/manage-admins-dialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const invoke = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ManageAdminsDialog } from "./manage-admins-dialog";

const org = { id: "o1", name: "Muspo", slug: "muspo", isActive: true };

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({
    data: { ok: true, members: [
      { user_id: "u1", email: "boss@muspo.ph", full_name: "Boss", role: "admin" },
      { user_id: "u2", email: "ed@muspo.ph", full_name: null, role: "editor" },
    ] },
    error: null,
  });
});

describe("ManageAdminsDialog", () => {
  it("lists the org's members with their emails", async () => {
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);

    expect(await screen.findByText("boss@muspo.ph")).toBeInTheDocument();
    expect(screen.getByText("ed@muspo.ph")).toBeInTheDocument();
    // The whole point: an explicit org_id, not the caller's own scope.
    expect(invoke).toHaveBeenCalledWith("org-members", { body: { action: "list", org_id: "o1" } });
  });

  it("invites a new admin against that org", async () => {
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("boss@muspo.ph");

    await userEvent.type(screen.getByLabelText(/email/i), "new@muspo.ph");
    await userEvent.click(screen.getByRole("button", { name: /invite/i }));

    expect(invoke).toHaveBeenCalledWith("org-members", {
      body: { action: "invite", org_id: "o1", email: "new@muspo.ph", role: "admin" },
    });
  });

  it("removes a member", async () => {
    render(<ManageAdminsDialog org={org} open onOpenChange={() => {}} />);
    await screen.findByText("ed@muspo.ph");

    await userEvent.click(screen.getByRole("button", { name: /remove ed@muspo.ph/i }));

    expect(invoke).toHaveBeenCalledWith("org-members", {
      body: { action: "remove", org_id: "o1", user_id: "u2" },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run "app/(admin)/organizations/manage-admins-dialog.test.tsx"`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the dialog**

```tsx
// apps/web/app/(admin)/organizations/manage-admins-dialog.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { OrgSummary } from "./org-actions";

type Member = { user_id: string; email: string | null; full_name: string | null; role: string };

/**
 * Who administers an organization, from the PLATFORM console.
 *
 * The org-members edge function has always accepted a super admin for any
 * org_id (index.ts:60) — it is the authorization boundary and it runs
 * regardless of what this dialog does. What was missing is reach: /team scopes
 * to requireOrgId(roles), which is null for a super admin with no org-scoped
 * row, so that page shows NoOrgScope and there was no other way in.
 */
export function ManageAdminsDialog({
  org, open, onOpenChange,
}: { org: OrgSummary; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke("org-members", { body });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      throw new Error(
        status === 403 ? "You don't have permission to manage this team."
        : status === 409 ? "An organization must keep at least one admin."
        : status === 502 ? "Couldn't send the invite — try again."
        : "Something went wrong. Please try again.",
      );
    }
    return data;
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await call({ action: "list", org_id: org.id });
      setMembers((data as { members?: Member[] })?.members ?? []);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [call, org.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function run(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await call(body);
      toast.success(done);
      await load();
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Admins for {org.name}</DialogTitle>
          <DialogDescription>
            Invite the person who should run this organization, or remove someone who should not.
          </DialogDescription>
        </DialogHeader>

        {members === null ? (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        ) : members.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nobody can administer this organization yet.</p>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{m.full_name ?? m.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                <span className="text-xs text-muted-foreground">{m.role}</span>
                <Button
                  variant="ghost" size="sm" disabled={busy}
                  aria-label={`Remove ${m.email}`}
                  onClick={() => run(
                    { action: "remove", org_id: org.id, user_id: m.user_id },
                    `${m.email} removed.`,
                  )}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2">
          <Label htmlFor="org-invite-email">Email</Label>
          <div className="flex gap-2">
            <Input
              id="org-invite-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com"
            />
            <Button
              disabled={busy || !email.trim()}
              onClick={() => run(
                { action: "invite", org_id: org.id, email: email.trim(), role: "admin" },
                `Invite sent to ${email.trim()}.`,
              ).then(() => setEmail(""))}
            >
              Invite
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Wire the menu item**

In `org-actions.tsx`, add state and the item:

```tsx
  const [managing, setManaging] = useState(false);
```

```tsx
          <DropdownMenuItem onSelect={() => setManaging(true)}>Manage admins</DropdownMenuItem>
```

```tsx
      <ManageAdminsDialog org={org} open={managing} onOpenChange={setManaging} />
```

- [ ] **Step 5: Fix the stale revalidation path**

`apps/web/lib/actions/team.ts` revalidates only `/team`. A super admin acting from `/organizations` would see a stale list. In all three actions, add:

```ts
  revalidatePath("/organizations");
```

next to the existing `revalidatePath("/team")`.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter web exec vitest run "app/(admin)/organizations" lib/actions
pnpm --filter web typecheck
```

Expected: PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(admin)/organizations" apps/web/lib/actions/team.ts
git commit -m "feat(orgs): manage an organization's admins from the platform console"
```

---

### Task 12: Deploy, verify against hosted, and close the ledger

**Files:**
- Modify: `apps/web/lib/queries/organizations.ts:78-86` (delete the KNOWN LIMITATION comment)
- Modify: `docs/README.md` (tick the roadmap entry)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Delete the obsolete comment**

The `KNOWN LIMITATION` block in `getPlatformOrganizations`' doc comment says the Status column "can only ever read Active today" and that fixing it "would need a migration this task is not allowed to write". Task 2 wrote it. Delete those two paragraphs; keep the rest of the doc comment.

- [ ] **Step 2: Run the full local gate**

```bash
pnpm exec supabase db reset
pnpm test
pnpm --filter web test
pnpm --filter web typecheck
pnpm --filter site test
pnpm --filter site typecheck
```

Expected: all green. `apps/site` is included because the `events_read_published` change affects the storefront's reads.

- [ ] **Step 3: Push the migration and config to hosted**

```bash
pnpm exec supabase db push
pnpm exec supabase config push          # READ THE DIFF FIRST — it applies the whole [auth] block
pnpm exec supabase secrets set ADMIN_APP_URL=https://race-pace-admin.vercel.app
pnpm exec supabase functions deploy org-provision
pnpm exec supabase functions deploy registrations-checkout
```

- [ ] **Step 4: Verify against the hosted project**

```bash
pnpm exec supabase db query --linked -f scripts/hosted-data-counts.sql
```

Then, signed in as `admin@racepace.test` on the deployed console:

1. Create an org — the rate field opens at 3%, and the returned invite link starts with `https://race-pace-admin.vercel.app/auth/confirm?token_hash=`.
2. Open that link in a private window — it lands signed-in on `/team`.
3. Suspend the org — it stays in the list, badged Suspended, and its events vanish from `race-pace-site.vercel.app`.
4. Unsuspend it — the events come back.
5. Delete it — the row goes, and `select count(*) from events where org_id = …` returns 0.

- [ ] **Step 5: Update the roadmap ledger**

In `docs/README.md`, change the Organization management entry from `- [ ]` to `- [x]` and append the test tallies, matching the format of the entries above it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/queries/organizations.ts docs/README.md
git commit -m "docs(orgs): close the org-management entry and drop the stale limitation note"
```
