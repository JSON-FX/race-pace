# Admin Check-in & Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `/check-in` and `/dashboard` `<Placeholder>` stubs in `apps/web` into working features, including the database work that lets a marshal reach check-in at all.

**Architecture:** Two `security definer` RPCs give marshals a roster without granting them table-level SELECT on `registrations` (RLS is row-level, so a policy would also leak `total_amount` and `custom_data`). The check-in client pre-downloads that roster, matches scanned tickets against it by exact string, and queues accepted scans in `localStorage` for replay — replay is idempotent because `checkins` already has `unique (registration_id)`. Two token emitters (camera, keyboard-wedge scanner) feed one `submitToken` pipeline. The Dashboard aggregates in Postgres via two `security_invoker` views following the existing `admin_list_views.sql` pattern.

**Tech Stack:** Vite + React 19 + react-router v6 + TanStack Query v5 + shadcn/ui + Tailwind v4 + Supabase (Postgres, Deno Edge Functions) + Vitest/jsdom + `qr-scanner`.

**Spec:** `docs/superpowers/specs/2026-08-06-admin-checkin-dashboard-design.md`

## Global Constraints

- **pnpm 9.7.0, Node 20.** Never `npm` or `npx` — use `pnpm` / `pnpm exec` / `pnpm dlx`.
- **NEVER run `supabase db reset`, `supabase start`, or `supabase stop`.** This worktree is linked to the **hosted** project and there is no local stack. `db reset --linked` **drops the remote database**. The only schema command you may run is `pnpm exec supabase db push`.
- **Never run a bare `pnpm exec vitest run` at the repo root.** It sweeps in the `supabase/tests/` suites, which now talk to the hosted project over the network — slow, and not what you want on every web edit. Use `pnpm --filter web test` for the admin, `pnpm exec vitest run supabase/functions packages` for the rest, and name a `supabase/tests/...` file explicitly when you want a database suite.
- **Money is integer centavos everywhere.** Format only at the render edge with `formatPeso` from `@race-pace/shared`. Never do floating-point arithmetic on amounts.
- **Types and validators come from `@race-pace/shared`.** Never redefine them locally.
- **Authorization is RLS/RPC, not UI conditionals.** A hidden nav item is not a permission check.
- **The token contract:** in `apps/web/src/index.css`, `--primary: 21 154 85` is a raw RGB channel triple, NOT a color. Only `--color-primary: rgb(var(--primary))` is usable. After any `pnpm dlx shadcn@latest add`, run `grep -rn "var(--" apps/web/src/components/ui/` and rewrite every hit that isn't `var(--color-*)`. **This plan adds no shadcn components** — every primitive it needs already exists — but run the grep before the PR anyway; the failure mode is silent.
- **Hosted Supabase project `whaqarofxdlzxrelbcrq` is the only backend.** The old `ytwdrsmclwghwktpupqd` is retired. The worktree is already linked and `apps/web/.env` already points at hosted. If `supabase link` ever fails confusingly, the cause is a stale CLI token — `pnpm exec supabase projects list` must show `whaqarofxdlzxrelbcrq`.
- **Hosted is two migrations ahead of this branch.** `20260806090000_event_discipline_category_detail` and `20260806140000_expand_event_discipline` were pushed from the runner-web worktree and have no local file here. They are purely additive (an `event_discipline` enum plus new columns) and touch nothing this plan reads. **Every migration you add must be timestamped after `20260806140000`** — an earlier timestamp makes `db push` refuse with "found local migration files to be inserted before the last migration on remote".
- **Database tests build and destroy their own fixtures in the hosted project.** They create a throwaway organization and throwaway auth users, assert, then delete them. Deleting an auth user cascades to its profile, `user_roles`, `registrations`, and from there to `payments` and `checkins`; deleting the throwaway org cascades its events and categories. Cleanup runs in `afterAll` so it happens even when assertions fail. **Never write a test that mutates the real org `00000000-0000-0000-0000-0000000000a1` or its events.**
- **Hosted data as of 2026-08-06:** one org (`…a1`, Race Pace), two events (`…e1` Apo Sky Ultra 2026 trail, `…e2` Davao Sunrise Run 2026 road, **both under `…a1`**), one registration, one payment, zero check-ins. There is no second organization — that is why the isolation tests create their own.
- **`apps/web` runs in Docker** at `https://admin.racepace.lan` (`docker compose up -d web` from the repo root). Source edits hot-reload over a bind mount; **a new dependency requires `docker compose restart web`**.
- **Use `127.0.0.1` explicitly**, never `localhost` — another project holds `[::1]` on common ports and macOS resolves IPv6 first. Check the page title before trusting what you see.
- **The role set `marshal | editor | admin | super_admin` in the new RPCs mirrors `canCheckIn()`** in `supabase/functions/_shared/authz.ts`. A change to one is a change to the other.

## File Structure

**Migrations**
- `supabase/migrations/20260806150000_checkin_rpcs.sql` — `checkin_events()`, `checkin_roster()`
- `supabase/migrations/20260806160000_admin_dashboard_views.sql` — `admin_org_totals_v`, `admin_event_totals_v`

**Database tests**
- `supabase/tests/checkin-rpcs.test.ts` — RPC authorization and column-leak assertions

**Web — pure logic (no React, no network, no DOM)**
- `apps/web/src/lib/checkinQueue.ts` — store shape, `offlineDecision`, queue reducer, progress
- `apps/web/src/lib/keyboardWedge.ts` — `feedKey` reducer

**Web — hooks**
- `apps/web/src/lib/useKeyboardWedge.ts` — binds the reducer to capture-phase `keydown`
- `apps/web/src/lib/checkin.ts` *(modify)* — hooks onto the RPCs; delete `useCheckInCount`
- `apps/web/src/lib/useCheckInSession.ts` — wires roster + queue + mutation + online state
- `apps/web/src/lib/dashboard.ts` — dashboard queries
- `apps/web/src/lib/roles.ts` *(modify)* — add `isMarshal`, `canCheckIn`

**Web — UI**
- `apps/web/src/App.tsx` *(modify)* — `RequireCheckInAccess`, route move, index redirect
- `apps/web/src/components/Sidebar.tsx` *(modify)* — role filtering
- `apps/web/src/components/QrScanner.tsx` — camera emitter
- `apps/web/src/components/CheckInBanner.tsx` — banner renderer
- `apps/web/src/components/CheckInRoster.tsx` — search + list
- `apps/web/src/components/CheckInQueueStatus.tsx` — pending/failed + retry
- `apps/web/src/routes/CheckIn.tsx` — layout
- `apps/web/src/routes/Dashboard.tsx` — layout

**Web — tests** (all under `apps/web/src/__tests__/`, matching the existing convention)
- `checkin-queue.test.ts`, `keyboard-wedge.test.ts`, `roles.test.tsx`, `checkin-hooks.test.tsx`, `checkin-route.test.tsx`, `dashboard.test.tsx`, `sidebar.test.tsx` *(modify)*

---

## Task 0: Confirm the hosted wiring

**Files:** none changed — this is a gate, not an edit. `apps/web/.env`, `apps/web/.env.example`, `.env.hosted`, and `test/env.ts` were already repointed at hosted before this plan was executed; this task proves it works before anything depends on it.

**Interfaces:** Produces nothing. Everything after this assumes hosted is reachable and the admin console talks to it.

- [ ] **Step 1: Confirm the CLI account and link**

```bash
pnpm exec supabase projects list
```

`whaqarofxdlzxrelbcrq` must appear with `"linked": true`. If it is absent, `pnpm exec supabase login` with the newer Gmail account. If present but unlinked, `pnpm exec supabase link --project-ref whaqarofxdlzxrelbcrq`.

- [ ] **Step 2: Confirm the app points at hosted, not `127.0.0.1`**

```bash
grep VITE_SUPABASE_URL apps/web/.env
```

Expected: `https://whaqarofxdlzxrelbcrq.supabase.co`.

- [ ] **Step 3: Restart the container so Vite re-reads the env**

Vite reads `.env` once at startup, so an edit alone changes nothing.

```bash
docker compose up -d web && docker compose restart web
```

- [ ] **Step 4: Confirm the console actually reaches hosted**

Open `https://admin.racepace.lan`, sign in as `admin@racepace.test` / `password123`, and open Events. **Check the page title is Race Pace's** before trusting the page — another project holds `[::1]` on common ports. You should see **two** events: Apo Sky Ultra 2026 and Davao Sunrise Run 2026. Seeing one event, or none, means the app is still on the old local stack.

- [ ] **Step 5: Confirm the database test credentials load**

```bash
pnpm exec supabase db query --linked "select count(*) orgs from organizations"
```

Expected: 1 row, `orgs: 1`.

No commit — nothing changed.

---

## Task 1: Check-in RPCs

**Files:**
- Create: `supabase/migrations/20260806150000_checkin_rpcs.sql`
- Test: `supabase/tests/checkin-rpcs.test.ts`

**Interfaces:**
- Consumes: existing `auth_is_super_admin()`, `user_roles`, `events`, `registrations`, `profiles`, `categories`, `checkins`
- Produces: `checkin_events() → (id uuid, name text, event_date date, end_date date)` and `checkin_roster(p_event_id uuid) → (registration_id uuid, ticket_token text, runner text, bib text, category text, status text, checked_in_at timestamptz)`

**Context you need:** `returns table` fails at runtime with "structure of query does not match function result type" on any type mismatch. `registrations.status` is the enum `registration_status`, not `text`, so it **must** be cast. Every returned column is cast explicitly for the same reason. `profiles.full_name` and `profiles.bib_name` are `text`; `categories.label` is `text`; `events.event_date` and `events.end_date` are `date`.

These tests run against the **hosted** project using credentials in `.env.hosted` (already created). They build their own throwaway organization, event, category, and users, and delete all of it in `afterAll`. **Do not reference the real org `…a1` or events `…e1` / `…e2`** — they belong to the live console.

There is no local stack. Do not run `supabase start`, `supabase stop`, or `supabase db reset`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/checkin-rpcs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });

// Everything below is created by this file and destroyed in afterAll. The real
// org (…a1) and its events are never touched.
const TAG = `citest${Date.now()}`;
const userIds: string[] = [];
const orgIds: string[] = [];

async function makeUser(label: string) {
  const email = `${TAG}_${label}@test.dev`;
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (c.error) throw c.error;
  userIds.push(c.data.user!.id);
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  if (s.error) throw s.error;
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}

async function makeOrg(label: string): Promise<string> {
  const r = await svc.from("organizations")
    .insert({ name: `${TAG} ${label}`, slug: `${TAG}-${label}` }).select("id").single();
  if (r.error) throw r.error;
  orgIds.push(r.data.id);
  return r.data.id;
}

async function makeEvent(orgId: string, name: string): Promise<string> {
  const r = await svc.from("events").insert({ org_id: orgId, name: `${TAG} ${name}` }).select("id").single();
  if (r.error) throw r.error;
  return r.data.id;
}

async function makeCategory(orgId: string, eventId: string): Promise<string> {
  const r = await svc.from("categories")
    .insert({ org_id: orgId, event_id: eventId, code: "10k", label: "10K", base_price: 100000 })
    .select("id").single();
  if (r.error) throw r.error;
  return r.data.id;
}

async function makeRunner(label: string, name: string, bib: string) {
  const u = await makeUser(label);
  await svc.from("profiles").insert({ id: u.id, full_name: name, bib_name: bib });
  return u;
}

type Ctx = {
  orgA: string; orgB: string; eventA: string; eventA2: string; eventB: string; catA: string;
  marshal: { token: string }; otherAdmin: { token: string }; plain: { token: string }; scoped: { token: string };
  paidReg: string; pendingReg: string; checkedReg: string;
};
let ctx: Ctx;

beforeAll(async () => {
  const orgA = await makeOrg("orga");
  const orgB = await makeOrg("orgb");
  const eventA = await makeEvent(orgA, "Event A");
  const eventA2 = await makeEvent(orgA, "Event A2");     // proves event_scope narrows
  const eventB = await makeEvent(orgB, "Event B");
  const catA = await makeCategory(orgA, eventA);

  const marshal = await makeUser("marshal");
  await svc.from("user_roles").insert({ user_id: marshal.id, role: "marshal", org_id: orgA });

  const otherAdmin = await makeUser("otheradmin");
  await svc.from("user_roles").insert({ user_id: otherAdmin.id, role: "admin", org_id: orgB });

  const plain = await makeUser("plain");

  const scoped = await makeUser("scoped");
  await svc.from("user_roles")
    .insert({ user_id: scoped.id, role: "marshal", org_id: orgA, event_scope: eventA });

  const reg = async (label: string, name: string, bib: string, status: string, token: string) => {
    const runner = await makeRunner(label, name, bib);
    const r = await svc.from("registrations").insert({
      org_id: orgA, event_id: eventA, category_id: catA, user_id: runner.id,
      status, total_amount: 100000, ticket_token: token, custom_data: { shirt: "M" },
    }).select("id").single();
    if (r.error) throw r.error;
    return r.data.id as string;
  };

  const paidReg = await reg("r1", "Ana Cruz", "ANA", "paid", `${TAG}_tok1`);
  const pendingReg = await reg("r2", "Ben Reyes", "BEN", "pending", `${TAG}_tok2`);
  const checkedReg = await reg("r3", "Cely Lim", "CEL", "paid", `${TAG}_tok3`);
  await svc.from("checkins").insert({ org_id: orgA, registration_id: checkedReg, event_id: eventA });

  ctx = { orgA, orgB, eventA, eventA2, eventB, catA, marshal, otherAdmin, plain, scoped, paidReg, pendingReg, checkedReg };
}, 60_000);

// Users first: that cascades registrations → payments/checkins, and user_roles.
// Orgs second: that cascades events and categories, which registrations reference
// with NO ACTION and would otherwise block.
afterAll(async () => {
  for (const id of userIds) await svc.auth.admin.deleteUser(id);
  for (const id of orgIds) await svc.from("organizations").delete().eq("id", id);
}, 60_000);

describe("checkin_roster", () => {
  it("gives a marshal the roster fields and nothing else", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(res.error).toBeNull();
    const row = (res.data ?? []).find((r: any) => r.registration_id === ctx.paidReg);
    expect(row).toMatchObject({
      ticket_token: `${TAG}_tok1`, runner: "Ana Cruz", bib: "ANA", status: "paid", checked_in_at: null,
    });
    expect(row.category).toBe("10K");

    // The whole reason this is an RPC and not an RLS policy.
    expect(row).not.toHaveProperty("total_amount");
    expect(row).not.toHaveProperty("custom_data");
  });

  it("includes pending so the client can say 'not paid' rather than 'not found'", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    const row = (res.data ?? []).find((r: any) => r.registration_id === ctx.pendingReg);
    expect(row).toMatchObject({ status: "pending" });
  });

  it("reflects an existing check-in", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    const row = (res.data ?? []).find((r: any) => r.registration_id === ctx.checkedReg);
    expect(row.checked_in_at).not.toBeNull();
  });

  it("returns nothing to an admin of another org, or to a user with no role", async () => {
    const other = await authed(ctx.otherAdmin.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(other.data ?? []).toHaveLength(0);
    const plain = await authed(ctx.plain.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(plain.data ?? []).toHaveLength(0);
  });
});

describe("checkin_events", () => {
  it("lists every event of the marshal's org", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_events");
    const ids = (res.data ?? []).map((e: any) => e.id);
    expect(ids).toContain(ctx.eventA);
    expect(ids).toContain(ctx.eventA2);
    expect(ids).not.toContain(ctx.eventB);
  });

  it("narrows to a single event when event_scope is set", async () => {
    const res = await authed(ctx.scoped.token).rpc("checkin_events");
    const ids = (res.data ?? []).map((e: any) => e.id);
    expect(ids).toContain(ctx.eventA);
    expect(ids).not.toContain(ctx.eventA2);

    // …and the scoped marshal still cannot read the sibling event's roster.
    const sibling = await authed(ctx.scoped.token).rpc("checkin_roster", { p_event_id: ctx.eventA2 });
    expect(sibling.data ?? []).toHaveLength(0);
  });

  it("returns nothing to a user with no role", async () => {
    const res = await authed(ctx.plain.token).rpc("checkin_events");
    const ids = (res.data ?? []).map((e: any) => e.id);
    expect(ids).not.toContain(ctx.eventA);
    expect(ids).not.toContain(ctx.eventB);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/checkin-rpcs.test.ts`
Expected: FAIL — every `rpc()` call errors with `Could not find the function public.checkin_roster`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260806150000_checkin_rpcs.sql`:

```sql
-- Race-day check-in read models. Design 2026-08-06 §4.
--
-- Why RPCs and not additive RLS policies: RLS is row-level, not column-level.
-- Granting a marshal SELECT on registrations would also hand them total_amount
-- and custom_data. These functions return exactly the roster fields and nothing
-- else, and confine the privilege expansion to two definitions instead of
-- widening policy surface on the money tables.
--
-- The allowed role set MIRRORS canCheckIn() in supabase/functions/_shared/authz.ts:
--   marshal | editor | admin | super_admin
-- A change to one is a change to the other.
--
-- Every column is cast explicitly: `returns table` fails at runtime on any type
-- mismatch, and registrations.status is the enum registration_status, not text.

-- Does the caller hold a check-in role for this org, honouring event_scope?
-- security definer for the same reason auth_can_admin_org is: it reads only the
-- caller's own user_roles rows, so it never needs a select policy and never recurses.
create or replace function auth_can_check_in_event(p_org_id uuid, p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth_is_super_admin()
      or exists (
        select 1 from user_roles ur
        where ur.user_id = auth.uid()
          and ur.org_id = p_org_id
          and ur.role in ('marshal', 'editor', 'admin')
          and (ur.event_scope is null or ur.event_scope = p_event_id)
      );
$$;

create or replace function checkin_events()
returns table (id uuid, name text, event_date date, end_date date)
language sql stable security definer set search_path = public as $$
  select e.id, e.name::text, e.event_date, e.end_date
  from events e
  where auth_can_check_in_event(e.org_id, e.id)
  order by e.event_date nulls last, e.name;
$$;

create or replace function checkin_roster(p_event_id uuid)
returns table (
  registration_id uuid,
  ticket_token    text,
  runner          text,
  bib             text,
  category        text,
  status          text,
  checked_in_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    r.id,
    r.ticket_token::text,
    coalesce(pr.full_name, 'Unknown runner')::text,
    pr.bib_name::text,
    coalesce(c.label, '')::text,
    r.status::text,
    ci.checked_in_at
  from registrations r
  join events e            on e.id = r.event_id
  left join profiles pr    on pr.id = r.user_id
  left join categories c   on c.id = r.category_id
  left join checkins ci    on ci.registration_id = r.id
  where r.event_id = p_event_id
    and r.status in ('pending', 'paid')
    and auth_can_check_in_event(e.org_id, e.id)
  order by coalesce(pr.full_name, '');
$$;

revoke all on function auth_can_check_in_event(uuid, uuid) from public;
revoke all on function checkin_events()                    from public;
revoke all on function checkin_roster(uuid)                from public;
grant execute on function checkin_events()     to authenticated;
grant execute on function checkin_roster(uuid) to authenticated;
```

- [ ] **Step 4: Push the migration to hosted and run the test**

```bash
pnpm exec supabase db push
```

Then:

```bash
pnpm exec vitest run supabase/tests/checkin-rpcs.test.ts
```

Expected: PASS, 7 tests.

Two failure modes worth naming:
- `structure of query does not match function result type` — a cast is missing or misordered; the `returns table` column order and the `select` list order must line up exactly.
- `found local migration files to be inserted before the last migration on remote` — the timestamp is earlier than `20260806140000`. Rename the file, do not force.

- [ ] **Step 5: Confirm the fixtures were cleaned up**

```bash
pnpm exec supabase db query --linked "select count(*) leftover from organizations where slug like 'citest%'"
```

Expected: `0`. If not, the run aborted before `afterAll`; delete the rows by that slug prefix before moving on.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260806150000_checkin_rpcs.sql supabase/tests/checkin-rpcs.test.ts
git commit -m "feat(db): checkin_events and checkin_roster RPCs for marshal access"
```

---

## Task 2: Marshal role plumbing — roles, route gate, sidebar, redirect

**Files:**
- Modify: `apps/web/src/lib/roles.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx`
- Test: `apps/web/src/__tests__/roles.test.tsx` (create)
- Test: `apps/web/src/__tests__/sidebar.test.tsx` (modify)

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `MyRoles` gains `isMarshal: boolean` and `canCheckIn: boolean`. `App.tsx` exports nothing new publicly; `RequireCheckInAccess` is internal.

**Context you need:** `useMyRoles()` currently computes `isSuperAdmin`, `isAdmin`, `isOrgAdmin` and has no concept of a marshal. **Roles are additive — a user may hold several rows** (see the org-staff roles model), so `isAdmin` and `isMarshal` can both be true. Its `orgId` is derived from the first `admin | editor` row and is therefore `null` for a pure marshal; anything needing an org id for a marshal must take it from the selected event instead.

- [ ] **Step 1: Write the failing role test**

Create `apps/web/src/__tests__/roles.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rows = { current: [] as Array<{ role: string; org_id: string | null }> };

vi.mock("../lib/supabase", () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: rows.current, error: null }) }) },
}));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1" } } }) }));

import { useMyRoles } from "../lib/roles";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

it("a pure marshal is not an admin but can check in", async () => {
  rows.current = [{ role: "marshal", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: false, isMarshal: true, canCheckIn: true });
});

it("an admin can check in without holding a marshal row", async () => {
  rows.current = [{ role: "admin", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: true, isMarshal: false, canCheckIn: true });
});

it("roles are additive — an admin who is also a marshal is still an admin", async () => {
  rows.current = [{ role: "admin", org_id: "a1" }, { role: "marshal", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: true, isMarshal: true, canCheckIn: true, orgId: "a1" });
});

it("a plain user can do neither", async () => {
  rows.current = [{ role: "user", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: false, isMarshal: false, canCheckIn: false });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test roles`
Expected: FAIL — `isMarshal` and `canCheckIn` are `undefined`.

- [ ] **Step 3: Extend `roles.ts`**

Replace the contents of `apps/web/src/lib/roles.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type MyRoles = {
  role: string | null;
  orgId: string | null;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isOrgAdmin: boolean;
  isMarshal: boolean;
  /** Mirrors canCheckIn() in supabase/functions/_shared/authz.ts. */
  canCheckIn: boolean;
};

export function useMyRoles() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery<MyRoles>({
    queryKey: ["my-roles", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role, org_id");
      if (error) throw error;
      const rows = data ?? [];
      const isSuperAdmin = rows.some((r) => r.role === "super_admin");
      const adminRow = rows.find((r) => r.role === "admin" || r.role === "editor");
      const isAdmin = isSuperAdmin || !!adminRow;
      const isMarshal = rows.some((r) => r.role === "marshal");
      return {
        role: isSuperAdmin ? "super_admin" : adminRow?.role ?? rows[0]?.role ?? null,
        orgId: adminRow?.org_id ?? null,
        isSuperAdmin,
        isAdmin,
        isOrgAdmin: isSuperAdmin || rows.some((r) => r.role === "admin"),
        isMarshal,
        canCheckIn: isAdmin || isMarshal,
      };
    },
  });
}
```

- [ ] **Step 4: Run the role test**

Run: `pnpm --filter web test roles`
Expected: PASS, 4 tests.

- [ ] **Step 5: Add the route gate and role-aware redirect**

Replace `RequireAdmin` and the route table in `apps/web/src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useMyRoles } from "./lib/roles";
import { AppShell } from "./components/AppShell";
import { Login } from "./routes/Login";
import { NoAccess } from "./routes/NoAccess";
import { Placeholder } from "./routes/Placeholder";
import { Events } from "./routes/Events";
import { EventEditor } from "./routes/EventEditor";
import { Registrations } from "./routes/Registrations";
import { Payments } from "./routes/Payments";
import { Team } from "./routes/Team";
import { Settings } from "./routes/Settings";
import { CheckIn } from "./routes/CheckIn";
import { Dashboard } from "./routes/Dashboard";

/** Shared session + roles preamble. Returns an element to render, or null to proceed. */
function useGate() {
  const { session, loading } = useAuth();
  const roles = useMyRoles();
  if (loading) return { block: <div className="p-8">Loading…</div>, roles };
  if (!session) return { block: <Navigate to="/login" replace />, roles };
  if (roles.isLoading) return { block: <div className="p-8">Loading…</div>, roles };
  return { block: null, roles };
}

function RequireAdmin() {
  const { block, roles } = useGate();
  if (block) return block;
  if (!roles.data?.isAdmin) return <Navigate to="/no-access" replace />;
  return <Outlet />;
}

/** Admins AND marshals. Mirrors canCheckIn() server-side — this gate is convenience,
 *  the RPCs and the Edge Function are the actual boundary. */
function RequireCheckInAccess() {
  const { block, roles } = useGate();
  if (block) return block;
  if (!roles.data?.canCheckIn) return <Navigate to="/no-access" replace />;
  return <Outlet />;
}

/** Roles are additive: an admin who also holds a marshal row lands on the dashboard.
 *  /check-in is the landing only for someone who is exclusively a marshal. */
function HomeRedirect() {
  const { block, roles } = useGate();
  if (block) return block;
  if (roles.data?.isAdmin) return <Navigate to="/dashboard" replace />;
  if (roles.data?.canCheckIn) return <Navigate to="/check-in" replace />;
  return <Navigate to="/no-access" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/no-access" element={<NoAccess />} />

        <Route element={<RequireCheckInAccess />}>
          <Route element={<AppShell />}>
            <Route index element={<HomeRedirect />} />
            <Route path="check-in" element={<CheckIn />} />
          </Route>
        </Route>

        <Route element={<RequireAdmin />}>
          <Route element={<AppShell />}>
            <Route path="events" element={<Events />} />
            <Route path="events/new" element={<EventEditor />} />
            <Route path="events/:id/edit" element={<EventEditor />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="registrations" element={<Registrations />} />
            <Route path="payments" element={<Payments />} />
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<Settings />} />
            <Route path="organizations" element={<Placeholder title="Organizations" />} />
            <Route path="commission" element={<Placeholder title="Commission" />} />
            <Route path="payouts" element={<Placeholder title="Payouts" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

**`CheckIn` and `Dashboard` do not exist yet.** Create both as one-line stubs now so the app compiles; Tasks 6 and 8 replace them.

`apps/web/src/routes/CheckIn.tsx`:

```tsx
export function CheckIn() {
  return <div className="p-8">Check-in</div>;
}
```

`apps/web/src/routes/Dashboard.tsx`:

```tsx
export function Dashboard() {
  return <div className="p-8">Dashboard</div>;
}
```

- [ ] **Step 6: Filter the sidebar by role**

In `apps/web/src/components/Sidebar.tsx`, add a `needs` predicate to the item type and filter on it. Replace the `Item` type, `ORG_ITEMS`, and the `SidebarMenu` block inside the ORGANIZATION group:

```tsx
type Item = { to: string; label: string; icon: LucideIcon; needs?: (r: MyRoles) => boolean };

const ORG_ITEMS: Item[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, needs: (r) => r.isAdmin },
  { to: "/events", label: "Events", icon: CalendarDays, needs: (r) => r.isAdmin },
  { to: "/registrations", label: "Registrations", icon: ClipboardList, needs: (r) => r.isAdmin },
  { to: "/payments", label: "Payments", icon: CreditCard, needs: (r) => r.isAdmin },
  { to: "/check-in", label: "Check-in", icon: QrCode, needs: (r) => r.canCheckIn },
  { to: "/team", label: "Team", icon: Users, needs: (r) => r.isOrgAdmin },
  { to: "/settings", label: "Settings", icon: SettingsIcon, needs: (r) => r.isAdmin },
];
```

Import the type alongside the hook — change the existing import to:

```tsx
import { useMyRoles, type MyRoles } from "../lib/roles";
```

Replace the filter expression in the menu:

```tsx
{ORG_ITEMS.filter((it) => !it.needs || (roles.data ? it.needs(roles.data) : false)).map((it) => (
  <NavItem key={it.to} {...it} />
))}
```

And make the footer role label honest about marshals — replace the `role` const:

```tsx
const role = roles.data?.isSuperAdmin ? "Super admin" : roles.data?.isAdmin ? "Admin" : "Marshal";
```

- [ ] **Step 7: Rewrite the sidebar test**

**The existing tests will fail without this.** They mock `useMyRoles` as `{ data: { isSuperAdmin: false } }` with no `isAdmin`, so the new `needs` predicates evaluate `undefined` and hide every admin item. Replace the whole of `apps/web/src/__tests__/sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { SidebarProvider } from "../components/ui/sidebar";
import type { MyRoles } from "../lib/roles";

let mockRoles: { data?: MyRoles } = {};
vi.mock("../lib/roles", () => ({ useMyRoles: () => mockRoles }));
vi.mock("../lib/auth", () => ({
  useAuth: () => ({ signOut: vi.fn(), session: { user: { email: "admin@racepace.test" } } }),
}));

const roles = (over: Partial<MyRoles> = {}): MyRoles => ({
  role: "admin", orgId: "a1", isSuperAdmin: false, isAdmin: true,
  isOrgAdmin: true, isMarshal: false, canCheckIn: true, ...over,
});

function renderSidebar() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    </MemoryRouter>
  );
}

it("org admin sees the org nav, not the platform items", () => {
  mockRoles = { data: roles() };
  renderSidebar();
  expect(screen.getByText("Events")).toBeInTheDocument();
  expect(screen.getByText("Check-in")).toBeInTheDocument();
  expect(screen.queryByText("Payouts")).not.toBeInTheDocument();
});

it("super_admin also sees the platform items", () => {
  mockRoles = { data: roles({ isSuperAdmin: true }) };
  renderSidebar();
  expect(screen.getByText("Organizations")).toBeInTheDocument();
  expect(screen.getByText("Payouts")).toBeInTheDocument();
});

it("hides Team from an admin who is not an org admin", () => {
  mockRoles = { data: roles({ isOrgAdmin: false }) };
  renderSidebar();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});

it("shows the dark-mode toggle in the footer", () => {
  mockRoles = { data: roles() };
  renderSidebar();
  expect(screen.getByLabelText("Toggle dark mode")).toBeInTheDocument();
});

it("a marshal sees only Check-in", () => {
  mockRoles = {
    data: roles({ role: "marshal", orgId: null, isAdmin: false, isOrgAdmin: false, isMarshal: true }),
  };
  renderSidebar();
  expect(screen.getByText("Check-in")).toBeInTheDocument();
  expect(screen.queryByText("Events")).not.toBeInTheDocument();
  expect(screen.queryByText("Payments")).not.toBeInTheDocument();
  expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  expect(screen.queryByText("Team")).not.toBeInTheDocument();
});

it("labels a marshal as Marshal in the footer", () => {
  mockRoles = {
    data: roles({ role: "marshal", orgId: null, isAdmin: false, isOrgAdmin: false, isMarshal: true }),
  };
  renderSidebar();
  expect(screen.getByText("Marshal")).toBeInTheDocument();
});
```

- [ ] **Step 8: Run the whole web suite**

Run: `pnpm --filter web test`
Expected: PASS, including 6 sidebar tests. Other suites that render `Sidebar` or `AppShell` may mock `useMyRoles` too — `grep -rn "useMyRoles" apps/web/src/__tests__/` and give any such mock the full `MyRoles` shape.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm --filter web typecheck
git add apps/web/src/lib/roles.ts apps/web/src/App.tsx apps/web/src/components/Sidebar.tsx apps/web/src/routes/CheckIn.tsx apps/web/src/routes/Dashboard.tsx apps/web/src/__tests__/roles.test.tsx apps/web/src/__tests__/sidebar.test.tsx
git commit -m "feat(web): marshal role plumbing, check-in route gate and role-aware landing"
```

---

## Task 3: Offline store, decision and queue reducer

**Files:**
- Create: `apps/web/src/lib/checkinQueue.ts`
- Test: `apps/web/src/__tests__/checkin-queue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type RosterRow = { registration_id: string; ticket_token: string | null; runner: string; bib: string | null; category: string; status: string; checked_in_at: string | null }`
  - `type QueuedScan = { clientId: string; ticketToken: string; registrationId: string; runner: string; category: string; scannedAt: string }`
  - `type FailedScan = QueuedScan & { reason: string; httpStatus: number; failedAt: string }`
  - `type CheckInStore = { rosterFetchedAt: string | null; roster: RosterRow[]; queue: QueuedScan[]; failed: FailedScan[] }`
  - `type EdgeResult = { status: number; body: any }`
  - `EMPTY_STORE`, `storageKey(eventId)`, `loadStore(eventId)`, `saveStore(eventId, store)`,
    `offlineDecision(token, store)`, `enqueue(store, row, token, clientId, nowIso)`,
    `markReplayed(store, clientId, checkedInAtIso)`, `markFailed(store, clientId, reason, httpStatus, nowIso)`,
    `retryFailed(store, clientId)`, `progress(store)`

**Context you need:** `offlineDecision` must return **the same `{ status, body }` shape the check-in Edge Function returns**, so `bannerFor` in `apps/web/src/lib/checkin.ts` renders both paths. Read `bannerFor` before writing this — the error strings (`not_paid`, `not_found`, `invalid_ticket`, `forbidden`) and the `{ ok, already }` success shape must match exactly.

Every function here is pure. `clientId` and timestamps are **parameters**, never generated inside — that is what makes the tests deterministic.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/checkin-queue.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";

// checkin.ts imports ./supabase, which calls createClient(url, key) at MODULE SCOPE.
// Under vitest the VITE_* env vars are undefined and supabase-js throws
// "supabaseUrl is required", so this mock is mandatory even though the test
// only uses the pure bannerFor mapper.
vi.mock("../lib/supabase", () => ({ supabase: {} }));

import {
  EMPTY_STORE, storageKey, loadStore, saveStore, offlineDecision,
  enqueue, markReplayed, markFailed, retryFailed, progress,
  type CheckInStore, type RosterRow,
} from "../lib/checkinQueue";
import { bannerFor } from "../lib/checkin";

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz",
  bib: "ANA", category: "10K", status: "paid", checked_in_at: null, ...over,
});

const store = (over: Partial<CheckInStore> = {}): CheckInStore => ({
  ...EMPTY_STORE, roster: [row()], ...over,
});

describe("offlineDecision", () => {
  it("accepts a paid, unscanned ticket", () => {
    const res = offlineDecision("tok1", store());
    expect(res).toEqual({ status: 200, body: { ok: true, registration_id: "r1" } });
    expect(bannerFor(res).tone).toBe("success");
  });

  it("reports an unknown token as not_found", () => {
    const res = offlineDecision("nope", store());
    expect(res.body.error).toBe("not_found");
    expect(bannerFor(res).tone).toBe("error");
  });

  it("reports a pending registration as not_paid, not not_found", () => {
    const res = offlineDecision("tok1", store({ roster: [row({ status: "pending" })] }));
    expect(res.body.error).toBe("not_paid");
    expect(bannerFor(res).title).toBe("Not paid");
  });

  it("reports an already-checked-in runner as already", () => {
    const res = offlineDecision("tok1", store({ roster: [row({ checked_in_at: "2026-08-06T01:00:00Z" })] }));
    expect(res.body).toMatchObject({ ok: true, already: true });
    expect(bannerFor(res).tone).toBe("muted");
  });

  it("treats a second scan of a queued token as already, not a duplicate enqueue", () => {
    const s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    const res = offlineDecision("tok1", s);
    expect(res.body).toMatchObject({ ok: true, already: true });
  });
});

describe("queue reducer", () => {
  it("enqueue adds one entry carrying the runner's name for the failed list", () => {
    const s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0]).toEqual({
      clientId: "c1", ticketToken: "tok1", registrationId: "r1",
      runner: "Ana Cruz", category: "10K", scannedAt: "2026-08-06T01:00:00Z",
    });
  });

  it("markReplayed drops the entry and stamps the roster row", () => {
    let s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    s = markReplayed(s, "c1", "2026-08-06T02:00:00Z");
    expect(s.queue).toHaveLength(0);
    expect(s.failed).toHaveLength(0);
    expect(s.roster[0].checked_in_at).toBe("2026-08-06T02:00:00Z");
  });

  it("markFailed moves the entry to failed with a human reason", () => {
    let s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    s = markFailed(s, "c1", "Not paid", 409, "2026-08-06T02:00:00Z");
    expect(s.queue).toHaveLength(0);
    expect(s.failed[0]).toMatchObject({ clientId: "c1", runner: "Ana Cruz", reason: "Not paid", httpStatus: 409 });
    expect(s.roster[0].checked_in_at).toBeNull();
  });

  it("retryFailed moves it back to the queue", () => {
    let s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    s = markFailed(s, "c1", "Not paid", 409, "2026-08-06T02:00:00Z");
    s = retryFailed(s, "c1");
    expect(s.failed).toHaveLength(0);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0]).not.toHaveProperty("reason");
  });
});

describe("progress", () => {
  it("counts only paid runners and never double-counts a queued scan", () => {
    const roster = [
      row({ registration_id: "r1", ticket_token: "t1", checked_in_at: "2026-08-06T01:00:00Z" }),
      row({ registration_id: "r2", ticket_token: "t2" }),
      row({ registration_id: "r3", ticket_token: "t3" }),
      row({ registration_id: "r4", ticket_token: "t4", status: "pending" }),
    ];
    let s: CheckInStore = { ...EMPTY_STORE, roster };
    expect(progress(s)).toEqual({ done: 1, total: 3 });

    s = enqueue(s, roster[1], "t2", "c2", "2026-08-06T01:05:00Z");
    expect(progress(s)).toEqual({ done: 2, total: 3 });

    s = markReplayed(s, "c2", "2026-08-06T01:06:00Z");
    expect(progress(s)).toEqual({ done: 2, total: 3 });
  });
});

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a store", () => {
    const s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    expect(saveStore("e1", s).ok).toBe(true);
    expect(loadStore("e1")).toEqual(s);
  });

  it("returns an empty store for an unknown event and for corrupt JSON", () => {
    expect(loadStore("missing")).toEqual(EMPTY_STORE);
    localStorage.setItem(storageKey("e2"), "{not json");
    expect(loadStore("e2")).toEqual(EMPTY_STORE);
  });

  it("surfaces a quota failure instead of throwing", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    const res = saveStore("e3", store());
    localStorage.setItem = original;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/storage/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test checkin-queue`
Expected: FAIL — `Failed to resolve import "../lib/checkinQueue"`.

- [ ] **Step 3: Implement `checkinQueue.ts`**

Create `apps/web/src/lib/checkinQueue.ts`:

```ts
/** Offline check-in store. Pure — no React, no network, no DOM.
 *  Timestamps and client ids are parameters, never generated here, so every
 *  transition is deterministic under test. Design §5.3–5.5. */

export type RosterRow = {
  registration_id: string;
  ticket_token: string | null;
  runner: string;
  bib: string | null;
  category: string;
  status: string;
  checked_in_at: string | null;
};

export type QueuedScan = {
  clientId: string;
  ticketToken: string;
  registrationId: string;
  runner: string;
  category: string;
  scannedAt: string;
};

export type FailedScan = QueuedScan & { reason: string; httpStatus: number; failedAt: string };

export type CheckInStore = {
  rosterFetchedAt: string | null;
  roster: RosterRow[];
  queue: QueuedScan[];
  failed: FailedScan[];
};

/** Mirrors the check-in Edge Function's response envelope so one mapper renders both paths. */
export type EdgeResult = { status: number; body: any };

export const EMPTY_STORE: CheckInStore = { rosterFetchedAt: null, roster: [], queue: [], failed: [] };

export function storageKey(eventId: string): string {
  return `race-pace.checkin.v1.${eventId}`;
}

export function loadStore(eventId: string): CheckInStore {
  try {
    const raw = localStorage.getItem(storageKey(eventId));
    if (!raw) return EMPTY_STORE;
    const parsed = JSON.parse(raw) as Partial<CheckInStore>;
    return {
      rosterFetchedAt: parsed.rosterFetchedAt ?? null,
      roster: parsed.roster ?? [],
      queue: parsed.queue ?? [],
      failed: parsed.failed ?? [],
    };
  } catch {
    return EMPTY_STORE;
  }
}

/** Never throws. A full quota must surface as a sync failure, not a silently lost roster. */
export function saveStore(eventId: string, store: CheckInStore): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(storageKey(eventId), JSON.stringify(store));
    return { ok: true };
  } catch {
    return { ok: false, error: "Device storage is full — the roster could not be saved for offline use." };
  }
}

/** Roster matching only. The wrong-event guard runs before this, on both paths. */
export function offlineDecision(token: string, store: CheckInStore): EdgeResult {
  const row = store.roster.find((r) => r.ticket_token !== null && r.ticket_token === token);
  if (!row) return { status: 404, body: { error: "not_found" } };
  if (row.status !== "paid") return { status: 409, body: { error: "not_paid" } };
  const queued = store.queue.some((q) => q.registrationId === row.registration_id);
  if (row.checked_in_at !== null || queued) {
    return { status: 200, body: { ok: true, already: true, registration_id: row.registration_id } };
  }
  return { status: 200, body: { ok: true, registration_id: row.registration_id } };
}

export function enqueue(
  store: CheckInStore, row: RosterRow, ticketToken: string, clientId: string, nowIso: string,
): CheckInStore {
  return {
    ...store,
    queue: [...store.queue, {
      clientId,
      ticketToken,
      registrationId: row.registration_id,
      runner: row.runner,
      category: row.category,
      scannedAt: nowIso,
    }],
  };
}

export function markReplayed(store: CheckInStore, clientId: string, checkedInAtIso: string): CheckInStore {
  const entry = store.queue.find((q) => q.clientId === clientId);
  return {
    ...store,
    queue: store.queue.filter((q) => q.clientId !== clientId),
    roster: entry
      ? store.roster.map((r) =>
          r.registration_id === entry.registrationId ? { ...r, checked_in_at: checkedInAtIso } : r)
      : store.roster,
  };
}

export function markFailed(
  store: CheckInStore, clientId: string, reason: string, httpStatus: number, nowIso: string,
): CheckInStore {
  const entry = store.queue.find((q) => q.clientId === clientId);
  if (!entry) return store;
  return {
    ...store,
    queue: store.queue.filter((q) => q.clientId !== clientId),
    failed: [...store.failed, { ...entry, reason, httpStatus, failedAt: nowIso }],
  };
}

export function retryFailed(store: CheckInStore, clientId: string): CheckInStore {
  const entry = store.failed.find((f) => f.clientId === clientId);
  if (!entry) return store;
  const { reason: _r, httpStatus: _h, failedAt: _f, ...queued } = entry;
  return {
    ...store,
    failed: store.failed.filter((f) => f.clientId !== clientId),
    queue: [...store.queue, queued],
  };
}

/** Derived, never stored — so it stays correct offline and after any replay. */
export function progress(store: CheckInStore): { done: number; total: number } {
  const paid = store.roster.filter((r) => r.status === "paid");
  const queued = new Set(store.queue.map((q) => q.registrationId));
  const done = paid.filter((r) => r.checked_in_at !== null || queued.has(r.registration_id)).length;
  return { done, total: paid.length };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter web test checkin-queue`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/checkinQueue.ts apps/web/src/__tests__/checkin-queue.test.ts
git commit -m "feat(web): offline check-in store, decision and queue reducer"
```

---

## Task 4: Keyboard-wedge scanner detection

**Files:**
- Create: `apps/web/src/lib/keyboardWedge.ts`
- Create: `apps/web/src/lib/useKeyboardWedge.ts`
- Test: `apps/web/src/__tests__/keyboard-wedge.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type WedgeState = { buffer: string; lastAt: number; fastCount: number }`
  - `type WedgeEvent = { key: string; timeStamp: number; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }`
  - `type WedgeResult = { state: WedgeState; emit?: string; capture: boolean }`
  - `WEDGE_INIT`, `MAX_GAP_MS`, `IDLE_COMMIT_MS`, `MIN_TOKEN_LEN`, `feedKey(state, ev)`, `commitIdle(state)`
  - `useKeyboardWedge(onScan: (token: string) => void, enabled: boolean): void`

**Context you need:** A USB/Bluetooth QR scanner in HID mode is a keyboard — it types the token in a burst and usually, **but not always**, sends `Enter`. Detection uses three signals together because timing alone false-positives on fast typists: sub-30 ms gaps, a buffer matching the base64url-plus-dot token charset, and a terminator (`Enter` or ~80 ms of silence).

`capture` in the result tells the DOM binding whether to `preventDefault()`. It only turns true once two characters have arrived at machine speed, so **one or two characters can still leak into a focused input** — that is what the snapshot/restore in `useKeyboardWedge` exists to undo. Restore happens **only on a successful emit**; if no scan materialised, those characters were genuine typing and must stay.

- [ ] **Step 1: Write the failing reducer test**

Create `apps/web/src/__tests__/keyboard-wedge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { feedKey, commitIdle, WEDGE_INIT, type WedgeState } from "../lib/keyboardWedge";

/** Feed a string at a fixed inter-key gap, returning the final result. */
function type(text: string, gapMs: number, start = 1000, state: WedgeState = WEDGE_INIT) {
  let s = state;
  let last: ReturnType<typeof feedKey> = { state: s, capture: false };
  let t = start;
  for (const key of text) {
    last = feedKey(s, { key, timeStamp: t });
    s = last.state;
    t += gapMs;
  }
  return { last, state: s, nextAt: t };
}

const TOKEN = "eyJyaWQiOiJhYmMifQ.c2ln";

describe("feedKey", () => {
  it("emits a machine-speed burst terminated by Enter", () => {
    const { state, nextAt } = type(TOKEN, 5);
    const res = feedKey(state, { key: "Enter", timeStamp: nextAt });
    expect(res.emit).toBe(TOKEN);
    expect(res.capture).toBe(true);
    expect(res.state).toEqual(WEDGE_INIT);
  });

  it("emits on idle for scanners with no Enter suffix", () => {
    const { state } = type(TOKEN, 5);
    expect(commitIdle(state).emit).toBe(TOKEN);
  });

  it("starts capturing only after two fast characters, so at most two leak", () => {
    let s = WEDGE_INIT;
    const captures: boolean[] = [];
    let t = 1000;
    for (const key of TOKEN) {
      const r = feedKey(s, { key, timeStamp: t });
      captures.push(r.capture);
      s = r.state;
      t += 5;
    }
    expect(captures.slice(0, 2)).toEqual([false, false]);
    expect(captures[2]).toBe(true);
  });

  it("ignores human-speed typing", () => {
    const { state, nextAt } = type("anacruz", 150);
    expect(feedKey(state, { key: "Enter", timeStamp: nextAt }).emit).toBeUndefined();
    expect(commitIdle(state).emit).toBeUndefined();
  });

  it("rejects a fast burst that is too short to be a token", () => {
    const { state, nextAt } = type("abc", 5);
    expect(feedKey(state, { key: "Enter", timeStamp: nextAt }).emit).toBeUndefined();
  });

  it("rejects a fast burst containing non-token characters", () => {
    const { state, nextAt } = type("ana cruz santos", 5);
    expect(feedKey(state, { key: "Enter", timeStamp: nextAt }).emit).toBeUndefined();
  });

  it("a burst arriving mid-typing still emits — the human prefix is discarded", () => {
    const typed = type("ana", 150);
    const burst = type(TOKEN, 5, typed.nextAt + 400, typed.state);
    const res = feedKey(burst.state, { key: "Enter", timeStamp: burst.nextAt });
    expect(res.emit).toBe(TOKEN);
  });

  it("abandons a stale buffer rather than splicing two bursts together", () => {
    const first = type("eyJyaWQi", 5);
    const second = type(TOKEN, 5, first.nextAt + 500, first.state);
    const res = feedKey(second.state, { key: "Enter", timeStamp: second.nextAt });
    expect(res.emit).toBe(TOKEN);
  });

  it("ignores modifier combos so browser shortcuts keep working", () => {
    const res = feedKey(WEDGE_INIT, { key: "a", timeStamp: 1000, metaKey: true });
    expect(res.capture).toBe(false);
    expect(res.state).toEqual(WEDGE_INIT);
  });

  it("a navigation key resets the buffer", () => {
    const { state } = type(TOKEN, 5);
    expect(feedKey(state, { key: "ArrowLeft", timeStamp: 2000 }).state).toEqual(WEDGE_INIT);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test keyboard-wedge`
Expected: FAIL — `Failed to resolve import "../lib/keyboardWedge"`.

- [ ] **Step 3: Implement the pure reducer**

Create `apps/web/src/lib/keyboardWedge.ts`:

```ts
/** Hardware QR scanners in HID mode present as keyboards. Detecting them on
 *  timing alone false-positives on fast typists, so this uses three signals:
 *  sub-30ms gaps, a buffer matching the ticket-token charset, and a terminator.
 *  Pure — no DOM, so the whole truth table is testable. Design §6.2. */

export type WedgeState = { buffer: string; lastAt: number; fastCount: number };
export type WedgeEvent = { key: string; timeStamp: number; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean };
export type WedgeResult = { state: WedgeState; emit?: string; capture: boolean };

export const WEDGE_INIT: WedgeState = { buffer: "", lastAt: 0, fastCount: 0 };

export const MAX_GAP_MS = 30;
export const IDLE_COMMIT_MS = 80;
export const MIN_TOKEN_LEN = 8;

/** base64url plus the '.' separating the ticket body from its signature. */
const TOKEN_CHAR = /^[A-Za-z0-9_.-]$/;

function isScan(s: WedgeState): boolean {
  return s.buffer.length >= MIN_TOKEN_LEN && s.fastCount >= 2;
}

export function feedKey(state: WedgeState, ev: WedgeEvent): WedgeResult {
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return { state: WEDGE_INIT, capture: false };

  // A gap longer than the idle window means the previous burst is over.
  const stale = state.buffer !== "" && ev.timeStamp - state.lastAt > IDLE_COMMIT_MS;
  const base = stale ? WEDGE_INIT : state;

  if (ev.key === "Enter") {
    const scan = isScan(base);
    return { state: WEDGE_INIT, emit: scan ? base.buffer : undefined, capture: scan };
  }

  if (!TOKEN_CHAR.test(ev.key)) return { state: WEDGE_INIT, capture: false };

  const fast = base.buffer === "" || ev.timeStamp - base.lastAt <= MAX_GAP_MS;
  if (!fast) {
    // Human speed — this character starts a fresh candidate burst.
    return { state: { buffer: ev.key, lastAt: ev.timeStamp, fastCount: 0 }, capture: false };
  }

  const next: WedgeState = {
    buffer: base.buffer + ev.key,
    lastAt: ev.timeStamp,
    fastCount: base.buffer === "" ? 0 : base.fastCount + 1,
  };
  return { state: next, capture: next.fastCount >= 2 };
}

/** Called by the DOM binding after IDLE_COMMIT_MS of silence, for scanners with no Enter suffix. */
export function commitIdle(state: WedgeState): WedgeResult {
  const scan = isScan(state);
  return { state: WEDGE_INIT, emit: scan ? state.buffer : undefined, capture: false };
}
```

- [ ] **Step 4: Run the reducer test**

Run: `pnpm --filter web test keyboard-wedge`
Expected: PASS, 10 tests.

- [ ] **Step 5: Implement the DOM binding**

Create `apps/web/src/lib/useKeyboardWedge.ts`:

```ts
import { useEffect, useRef } from "react";
import { commitIdle, feedKey, IDLE_COMMIT_MS, WEDGE_INIT, type WedgeState } from "./keyboardWedge";

type Editable = HTMLInputElement | HTMLTextAreaElement;

function editable(el: EventTarget | null): Editable | null {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  return null;
}

/** Binds the wedge reducer to capture-phase keydown so a scanner burst wins over
 *  whatever has focus. Snapshots the focused field at burst start and restores it
 *  on a successful scan, undoing the one or two characters that leak before
 *  detection triggers. On a burst that turns out NOT to be a scan the snapshot is
 *  discarded — those characters were real typing. Design §6.2. */
export function useKeyboardWedge(onScan: (token: string) => void, enabled: boolean): void {
  const scan = useRef(onScan);
  scan.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let state: WedgeState = WEDGE_INIT;
    let snapshot: { el: Editable; value: string; start: number | null } | null = null;
    let idle: ReturnType<typeof setTimeout> | undefined;

    const restore = () => {
      if (snapshot && snapshot.el.isConnected && snapshot.el.value !== snapshot.value) {
        snapshot.el.value = snapshot.value;
        snapshot.el.dispatchEvent(new Event("input", { bubbles: true }));
        if (snapshot.start !== null) snapshot.el.setSelectionRange(snapshot.start, snapshot.start);
      }
      snapshot = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Snapshot before the reducer sees the key that starts a burst.
      if (state.buffer === "" && snapshot === null) {
        const el = editable(document.activeElement);
        if (el) snapshot = { el, value: el.value, start: el.selectionStart };
      }

      const res = feedKey(state, {
        key: e.key, timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
      });
      state = res.state;

      if (res.capture) {
        e.preventDefault();
        e.stopPropagation();
      }

      clearTimeout(idle);
      if (res.emit) {
        restore();
        scan.current(res.emit);
        return;
      }
      if (state.buffer === "") {
        snapshot = null;                      // burst abandoned — real typing stays
        return;
      }
      idle = setTimeout(() => {
        const done = commitIdle(state);
        state = done.state;
        if (done.emit) {
          restore();
          scan.current(done.emit);
        } else {
          snapshot = null;
        }
      }, IDLE_COMMIT_MS);
    };

    document.addEventListener("keydown", onKeyDown, true);   // capture phase
    return () => {
      clearTimeout(idle);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [enabled]);
}
```

- [ ] **Step 6: Add a binding test**

Append to `apps/web/src/__tests__/keyboard-wedge.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { useKeyboardWedge } from "../lib/useKeyboardWedge";

/** jsdom does not populate KeyboardEvent.timeStamp usefully, so set it explicitly. */
function press(key: string, timeStamp: number, target: Element | Document = document) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "timeStamp", { value: timeStamp });
  target.dispatchEvent(ev);
  return ev;
}

describe("useKeyboardWedge", () => {
  it("emits a scan and restores characters that leaked into the focused input", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.value = "ana";
    input.focus();

    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, true));

    let t = 1000;
    for (const key of TOKEN) { press(key, t); t += 5; }
    press("Enter", t);

    expect(onScan).toHaveBeenCalledWith(TOKEN);
    expect(input.value).toBe("ana");
    document.body.removeChild(input);
  });

  it("leaves genuine typing alone", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, true));

    let t = 1000;
    for (const key of "ana") { press(key, t); t += 150; }
    expect(onScan).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("does nothing when disabled", () => {
    const onScan = vi.fn();
    renderHook(() => useKeyboardWedge(onScan, false));
    let t = 1000;
    for (const key of TOKEN) { press(key, t); t += 5; }
    press("Enter", t);
    expect(onScan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the full file**

Run: `pnpm --filter web test keyboard-wedge`
Expected: PASS, 13 tests.

Note the first binding test asserts `input.value === "ana"` — jsdom does not run the browser's default "insert character" behaviour for synthetic `keydown`, so nothing actually leaks in the test environment. The assertion still guards the restore path from corrupting a field it should have left alone, and the reducer test at Step 1 is what pins the two-character capture threshold.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/keyboardWedge.ts apps/web/src/lib/useKeyboardWedge.ts apps/web/src/__tests__/keyboard-wedge.test.ts
git commit -m "feat(web): keyboard-wedge scanner detection with focus snapshot restore"
```

---

## Task 5: Check-in hooks on the RPCs, and the session hook

**Files:**
- Modify: `apps/web/src/lib/checkin.ts`
- Create: `apps/web/src/lib/useCheckInSession.ts`
- Test: `apps/web/src/__tests__/checkin-hooks.test.tsx`

**Interfaces:**
- Consumes: `checkin_events` / `checkin_roster` (Task 1); everything exported by `checkinQueue.ts` (Task 3)
- Produces:
  - `checkin.ts`: `type CheckInEvent = { id: string; name: string; event_date: string | null; end_date: string | null }`; `useCheckInEvents()` (**no argument now**); `useCheckInRoster(eventId: string | null)` returning `RosterRow[]`; `useSubmitCheckIn()` unchanged. `CheckInReg` and `useCheckInCount` are **deleted**.
  - `useCheckInSession.ts`: `useCheckInSession(eventId: string | null)` returning
    `{ store: CheckInStore, banner: CheckInBanner | null, online: boolean, storageError: string | null, progress: {done,total}, rosterFetchedAt: string | null, rosterSyncing: boolean, rosterError: string | null, syncRoster: () => void, submitToken: (t: string) => Promise<void>, retryOne: (clientId: string) => Promise<void>, retryAll: () => Promise<void> }`

**Context you need:** `useCheckInEvents(orgId)` currently takes an org id, but `useMyRoles().orgId` is `null` for a pure marshal — that is exactly why `checkin_events()` takes no argument and derives scope from the JWT. Drop the parameter.

`useCheckInCount` is deleted, not rewritten: `checked_in_at` on each roster row makes `progress()` a pure derivation that keeps working offline.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/checkin-hooks.test.tsx`:

```tsx
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
const getSession = vi.fn(() => Promise.resolve({ data: { session: { access_token: "jwt" } } }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => getSession() } } }));

import { useCheckInEvents, useCheckInRoster } from "../lib/checkin";
import { useCheckInSession } from "../lib/useCheckInSession";
import { loadStore } from "../lib/checkinQueue";

const ROSTER = [
  { registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz", bib: "ANA", category: "10K", status: "paid", checked_in_at: null },
  { registration_id: "r2", ticket_token: "tok2", runner: "Ben Reyes", bib: "BEN", category: "21K", status: "pending", checked_in_at: null },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("useCheckInEvents calls the RPC with no arguments", async () => {
  rpc.mockResolvedValue({ data: [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", end_date: null }], error: null });
  const { result } = renderHook(() => useCheckInEvents(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  expect(rpc).toHaveBeenCalledWith("checkin_events");
});

it("useCheckInRoster passes the event id", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  const { result } = renderHook(() => useCheckInRoster("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  expect(rpc).toHaveBeenCalledWith("checkin_roster", { p_event_id: "e1" });
});

it("submitToken online posts to the Edge Function and stamps the roster row", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  (globalThis.fetch as any).mockResolvedValue({
    status: 200, json: () => Promise.resolve({ ok: true, registration_id: "r1" }),
  });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));

  await act(async () => { await result.current.submitToken("tok1"); });

  expect(globalThis.fetch).toHaveBeenCalled();
  expect(result.current.banner?.tone).toBe("success");
  expect(result.current.progress).toEqual({ done: 1, total: 1 });
});

it("submitToken offline queues the scan and persists it", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));

  await act(async () => { await result.current.submitToken("tok1"); });

  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(result.current.banner?.tone).toBe("success");
  expect(result.current.store.queue).toHaveLength(1);
  expect(loadStore("e1").queue).toHaveLength(1);
});

it("an offline scan of a pending registration is refused as not paid", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));

  await act(async () => { await result.current.submitToken("tok2"); });

  expect(result.current.banner?.title).toBe("Not paid");
  expect(result.current.store.queue).toHaveLength(0);
});

it("a rejected replay lands in the failed list with the runner's name", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));
  await act(async () => { await result.current.submitToken("tok1"); });

  (globalThis.fetch as any).mockResolvedValue({ status: 409, json: () => Promise.resolve({ error: "not_paid" }) });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });

  await act(async () => { await result.current.retryAll(); });

  expect(result.current.store.queue).toHaveLength(0);
  expect(result.current.store.failed).toHaveLength(1);
  expect(result.current.store.failed[0]).toMatchObject({ runner: "Ana Cruz", reason: "Not paid", httpStatus: 409 });
});

it("a duplicate replay is treated as success, not failure", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));
  await act(async () => { await result.current.submitToken("tok1"); });

  (globalThis.fetch as any).mockResolvedValue({
    status: 200, json: () => Promise.resolve({ ok: true, already: true, registration_id: "r1" }),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });

  await act(async () => { await result.current.retryAll(); });

  expect(result.current.store.queue).toHaveLength(0);
  expect(result.current.store.failed).toHaveLength(0);
  expect(result.current.store.roster[0].checked_in_at).not.toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test checkin-hooks`
Expected: FAIL — `Failed to resolve import "../lib/useCheckInSession"`.

- [ ] **Step 3: Move `checkin.ts` onto the RPCs**

In `apps/web/src/lib/checkin.ts`: keep `CheckInBanner`, `bannerFor`, `wrongEventBanner`, `decodeTicketEventId`, and `useSubmitCheckIn` exactly as they are. **Delete** `CheckInReg`, `useCheckInCount`, and the old `useCheckInEvents` / `useCheckInRoster`. Replace them with:

```ts
import type { RosterRow } from "./checkinQueue";

export type CheckInEvent = { id: string; name: string; event_date: string | null; end_date: string | null };

/** No org argument: checkin_events() derives scope from the caller's JWT, which
 *  matters because useMyRoles().orgId is null for a pure marshal. */
export function useCheckInEvents() {
  return useQuery<CheckInEvent[]>({
    queryKey: ["checkin-events"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("checkin_events");
      if (error) throw error;
      return (data ?? []) as CheckInEvent[];
    },
  });
}

export function useCheckInRoster(eventId: string | null) {
  return useQuery<RosterRow[]>({
    queryKey: ["checkin-roster", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("checkin_roster", { p_event_id: eventId! });
      if (error) throw error;
      return (data ?? []) as RosterRow[];
    },
  });
}
```

Also drop the now-unused `useQueryClient` import and the `onSuccess` invalidation in `useSubmitCheckIn` — the session hook owns roster state now:

```ts
export function useSubmitCheckIn() {
  return useMutation({
    mutationFn: async (ticketToken: string) => {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ ticket_token: ticketToken }),
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    },
  });
}
```

Check for other consumers before deleting: `grep -rn "useCheckInCount\|CheckInReg" apps/web/src` should return nothing after this edit.

- [ ] **Step 4: Implement the session hook**

Create `apps/web/src/lib/useCheckInSession.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bannerFor, useCheckInRoster, type CheckInBanner } from "./checkin";
import {
  EMPTY_STORE, loadStore, saveStore, offlineDecision, enqueue, markReplayed,
  markFailed, retryFailed, progress, type CheckInStore, type EdgeResult,
} from "./checkinQueue";
import { supabase } from "./supabase";

async function postCheckIn(ticketToken: string): Promise<EdgeResult> {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/check-in`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      Authorization: `Bearer ${sess.session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ ticket_token: ticketToken }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Wires roster + offline queue + Edge Function + connectivity into one surface.
 *  The store is the single source of truth for progress, so it stays correct offline. */
export function useCheckInSession(eventId: string | null) {
  const [store, setStore] = useState<CheckInStore>(EMPTY_STORE);
  const [banner, setBanner] = useState<CheckInBanner | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [storageError, setStorageError] = useState<string | null>(null);
  const storeRef = useRef(store);

  const roster = useCheckInRoster(eventId);

  /** Every mutation goes through here so persistence can never be forgotten. */
  const commit = useCallback((next: CheckInStore) => {
    storeRef.current = next;
    setStore(next);
    if (eventId) {
      const res = saveStore(eventId, next);
      setStorageError(res.ok ? null : res.error ?? null);
    }
  }, [eventId]);

  // Swap to the selected event's persisted store.
  useEffect(() => {
    const next = eventId ? loadStore(eventId) : EMPTY_STORE;
    storeRef.current = next;
    setStore(next);
    setBanner(null);
  }, [eventId]);

  // Fold a fresh roster in without discarding the queue or failed list.
  useEffect(() => {
    if (!eventId || !roster.data) return;
    commit({ ...storeRef.current, roster: roster.data, rosterFetchedAt: new Date().toISOString() });
  }, [eventId, roster.data, commit]);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const replayOne = useCallback(async (clientId: string) => {
    const entry = storeRef.current.queue.find((q) => q.clientId === clientId);
    if (!entry) return;
    let res: EdgeResult;
    try {
      res = await postCheckIn(entry.ticketToken);
    } catch {
      return;                                   // still offline — leave it queued
    }
    // The unique(registration_id) constraint makes a duplicate a success, not an error.
    if (res.status === 200 && res.body?.ok) {
      commit(markReplayed(storeRef.current, clientId, new Date().toISOString()));
    } else {
      const b = bannerFor(res, entry.runner, entry.category);
      commit(markFailed(storeRef.current, clientId, b.title, res.status, new Date().toISOString()));
    }
  }, [commit]);

  const retryAll = useCallback(async () => {
    for (const q of [...storeRef.current.queue]) await replayOne(q.clientId);
  }, [replayOne]);

  // Drain automatically when connectivity returns.
  useEffect(() => {
    if (online && storeRef.current.queue.length > 0) void retryAll();
  }, [online, retryAll]);

  const submitToken = useCallback(async (token: string) => {
    const current = storeRef.current;
    const decision = offlineDecision(token, current);

    if (!navigator.onLine) {
      const row = current.roster.find((r) => r.ticket_token === token);
      if (decision.status === 200 && decision.body?.ok && !decision.body?.already && row) {
        commit(enqueue(current, row, token, crypto.randomUUID(), new Date().toISOString()));
      }
      setBanner(bannerFor(decision, row?.runner, row?.category));
      return;
    }

    // Online: still refuse locally-known bad tickets so the marshal gets an instant answer.
    if (decision.status !== 200) {
      const row = current.roster.find((r) => r.ticket_token === token);
      setBanner(bannerFor(decision, row?.runner, row?.category));
      return;
    }

    const row = current.roster.find((r) => r.ticket_token === token);
    try {
      const res = await postCheckIn(token);
      if (res.status === 200 && res.body?.ok) {
        const stamped = row
          ? { ...storeRef.current, roster: storeRef.current.roster.map((r) =>
              r.registration_id === row.registration_id
                ? { ...r, checked_in_at: r.checked_in_at ?? new Date().toISOString() } : r) }
          : storeRef.current;
        commit(stamped);
      }
      setBanner(bannerFor(res, row?.runner, row?.category));
    } catch {
      // The network died between the check and the post — queue rather than lose it.
      if (row) commit(enqueue(storeRef.current, row, token, crypto.randomUUID(), new Date().toISOString()));
      setBanner(bannerFor(decision, row?.runner, row?.category));
    }
  }, [commit]);

  const retryOne = useCallback(async (clientId: string) => {
    commit(retryFailed(storeRef.current, clientId));
    await replayOne(clientId);
  }, [commit, replayOne]);

  return {
    store,
    banner,
    online,
    storageError,
    progress: useMemo(() => progress(store), [store]),
    rosterFetchedAt: store.rosterFetchedAt,
    rosterSyncing: roster.isFetching,
    rosterError: roster.error ? (roster.error as Error).message : null,
    syncRoster: () => void roster.refetch(),
    submitToken,
    retryOne,
    retryAll,
  };
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter web test checkin-hooks`
Expected: PASS, 7 tests.

If `crypto.randomUUID is not a function`, add to `apps/web/vitest.setup.ts`:

```ts
globalThis.crypto ??= {} as Crypto;
globalThis.crypto.randomUUID ??= (() =>
  `${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`) as Crypto["randomUUID"];
```

- [ ] **Step 6: Run the whole suite, typecheck, commit**

```bash
pnpm --filter web test && pnpm --filter web typecheck
git add apps/web/src/lib/checkin.ts apps/web/src/lib/useCheckInSession.ts apps/web/src/__tests__/checkin-hooks.test.tsx apps/web/vitest.setup.ts
git commit -m "feat(web): check-in hooks on RPCs plus offline session hook"
```

---

## Task 6: Check-in UI

**Files:**
- Create: `apps/web/src/components/QrScanner.tsx`
- Create: `apps/web/src/components/CheckInBanner.tsx`
- Create: `apps/web/src/components/CheckInRoster.tsx`
- Create: `apps/web/src/components/CheckInQueueStatus.tsx`
- Modify: `apps/web/src/routes/CheckIn.tsx` (replaces the Task 2 stub)
- Test: `apps/web/src/__tests__/checkin-route.test.tsx`

**Interfaces:**
- Consumes: `useCheckInSession` (Task 5), `useCheckInEvents` (Task 5), `decodeTicketEventId` / `wrongEventBanner` (existing `checkin.ts`), `progress` / types (Task 3)
- Produces: `CheckIn` route component; the three presentational components take explicit props and hold no data logic

- [ ] **Step 1: Add the scanner dependency and restart the container**

```bash
pnpm --filter web add qr-scanner
```

Then, because a bind-mount hot reload will not pick up a new dependency:

```bash
docker compose restart web
```

- [ ] **Step 2: Write the failing route test**

Create `apps/web/src/__tests__/checkin-route.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "jwt" } } }) } },
}));
// The camera is not available in jsdom; the roster path is what this test drives.
vi.mock("../components/QrScanner", () => ({ QrScanner: () => <div data-testid="qr-scanner" /> }));

import { CheckIn } from "../routes/CheckIn";

const EVENTS = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", end_date: null }];
const ROSTER = [
  { registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz", bib: "ANA", category: "10K", status: "paid", checked_in_at: null },
  { registration_id: "r2", ticket_token: "tok2", runner: "Ben Reyes", bib: "BEN", category: "21K", status: "paid", checked_in_at: "2026-08-06T01:00:00Z" },
];

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><CheckIn /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  rpc.mockImplementation((fn: string) =>
    Promise.resolve({ data: fn === "checkin_events" ? EVENTS : ROSTER, error: null }));
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true, registration_id: "r1" }) })));
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("auto-selects the only event and shows roster progress", async () => {
  renderRoute();
  expect(await screen.findByText(/Apo Sky Ultra/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText(/1 \/ 2 checked in/)).toBeInTheDocument());
});

it("shows the roster sync state so the marshal knows offline will work", async () => {
  renderRoute();
  expect(await screen.findByText(/Roster synced/)).toBeInTheDocument();
  expect(screen.getByText(/2 runners/)).toBeInTheDocument();
});

it("checks a runner in from the roster list", async () => {
  const user = userEvent.setup();
  renderRoute();
  await screen.findByText("Ana Cruz");
  await user.click(screen.getByRole("button", { name: /check in ana cruz/i }));
  await waitFor(() => expect(screen.getByText("Checked in")).toBeInTheDocument());
  expect(globalThis.fetch).toHaveBeenCalled();
});

it("marks an already-checked-in runner as done rather than offering a button", async () => {
  renderRoute();
  await screen.findByText("Ben Reyes");
  expect(screen.queryByRole("button", { name: /check in ben reyes/i })).not.toBeInTheDocument();
});

it("filters the roster by name", async () => {
  const user = userEvent.setup();
  renderRoute();
  await screen.findByText("Ana Cruz");
  await user.type(screen.getByPlaceholderText(/search/i), "ben");
  await waitFor(() => expect(screen.queryByText("Ana Cruz")).not.toBeInTheDocument());
  expect(screen.getByText("Ben Reyes")).toBeInTheDocument();
});

it("warns when offline", async () => {
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  renderRoute();
  expect(await screen.findByText(/offline/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web test checkin-route`
Expected: FAIL — the stub renders only "Check-in", so every query misses.

- [ ] **Step 4: Write `CheckInBanner.tsx`**

```tsx
import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import type { CheckInBanner as Banner } from "../lib/checkin";
import { cn } from "../lib/utils";

const TONE = {
  success: { cls: "border-primary bg-primary/10 text-foreground", Icon: CheckCircle2, iconCls: "text-primary" },
  warn: { cls: "border-amber-500 bg-amber-500/10 text-foreground", Icon: AlertTriangle, iconCls: "text-amber-600" },
  error: { cls: "border-destructive bg-destructive/10 text-foreground", Icon: XCircle, iconCls: "text-destructive" },
  muted: { cls: "border-border bg-muted text-foreground", Icon: Info, iconCls: "text-muted-foreground" },
} as const;

/** Large and high-contrast on purpose: cold hands, bright sun, a queue of runners. */
export function CheckInBanner({ banner }: { banner: Banner | null }) {
  if (!banner) {
    return (
      <div className="flex min-h-[104px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        Ready to scan
      </div>
    );
  }
  const { cls, Icon, iconCls } = TONE[banner.tone];
  return (
    <div role="status" aria-live="polite" className={cn("flex min-h-[104px] items-center gap-4 rounded-xl border-2 px-5 py-4", cls)}>
      <Icon className={cn("size-10 shrink-0", iconCls)} />
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-tight">{banner.title}</div>
        {banner.detail ? <div className="truncate text-sm text-muted-foreground">{banner.detail}</div> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write `QrScanner.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import QrScannerLib from "qr-scanner";
import { Button } from "@/components/ui/button";
import { Flashlight, CameraOff } from "lucide-react";

/** Camera token emitter. Knows nothing about check-in — it hands up a string.
 *  A cooldown stops one QR in frame from firing repeatedly. Design §6.1. */
export function QrScanner({ onScan, cooldownMs = 1500 }: { onScan: (token: string) => void; cooldownMs?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const scannerRef = useRef<QrScannerLib | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScannerLib(
      video,
      (result) => {
        const token = result.data;
        const now = Date.now();
        if (token === lastRef.current.token && now - lastRef.current.at < cooldownMs) return;
        lastRef.current = { token, at: now };
        onScanRef.current(token);
      },
      { highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 5 },
    );
    scannerRef.current = scanner;
    scanner.start().catch(() => setError("Camera unavailable. Use the roster below to check runners in."));
    return () => { scanner.stop(); scanner.destroy(); scannerRef.current = null; };
  }, [cooldownMs]);

  if (error) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
        <CameraOff className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-black">
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
      <Button
        type="button" variant="secondary" size="sm" className="absolute bottom-3 right-3"
        onClick={async () => {
          const s = scannerRef.current;
          if (!s || !(await s.hasFlash())) return;
          await s.toggleFlash();
          setTorch(s.isFlashOn());
        }}
      >
        <Flashlight className="size-4" /> {torch ? "Torch off" : "Torch"}
      </Button>
    </div>
  );
}
```

If Vite fails to resolve the decoder worker, set it once before constructing the scanner:

```ts
import workerUrl from "qr-scanner/qr-scanner-worker.min.js?url";
QrScannerLib.WORKER_PATH = workerUrl;
```

- [ ] **Step 6: Write `CheckInRoster.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import type { RosterRow } from "../lib/checkinQueue";

/** Tapping a runner submits THEIR stored ticket_token through the same pipeline as a
 *  scan, so there is no second backend path for the dead-phone case. Design §7. */
export function CheckInRoster({
  roster, queuedIds, onCheckIn,
}: {
  roster: RosterRow[];
  queuedIds: Set<string>;
  onCheckIn: (token: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return roster;
    return roster.filter((r) =>
      r.runner.toLowerCase().includes(needle) || (r.bib ?? "").toLowerCase().includes(needle));
  }, [roster, q]);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Input placeholder="Search by name or bib…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-xl border border-border">
        {filtered.length === 0 ? (
          <li className="p-6 text-center text-sm text-muted-foreground">No runner matches “{q}”.</li>
        ) : filtered.map((r) => {
          const done = r.checked_in_at !== null || queuedIds.has(r.registration_id);
          return (
            <li key={r.registration_id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.runner}</div>
                <div className="text-xs text-muted-foreground">
                  {[r.bib, r.category].filter(Boolean).join(" · ")}
                </div>
              </div>
              {r.status !== "paid" ? (
                <Badge variant="outline">Not paid</Badge>
              ) : done ? (
                <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                  <Check className="size-4" /> Checked in
                </span>
              ) : (
                <Button
                  size="sm"
                  aria-label={`Check in ${r.runner}`}
                  disabled={!r.ticket_token}
                  onClick={() => r.ticket_token && onCheckIn(r.ticket_token)}
                >
                  Check in
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Write `CheckInQueueStatus.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import type { FailedScan, QueuedScan } from "../lib/checkinQueue";

/** Failures are loud and non-dismissable on purpose: a queued check-in that
 *  vanishes means a runner is on the course marked absent. Design §5.5. */
export function CheckInQueueStatus({
  queue, failed, online, onRetryAll, onRetryOne,
}: {
  queue: QueuedScan[];
  failed: FailedScan[];
  online: boolean;
  onRetryAll: () => void;
  onRetryOne: (clientId: string) => void;
}) {
  if (queue.length === 0 && failed.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {queue.length > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-3">
          <CloudOff className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm">
            <strong>{queue.length}</strong> check-in{queue.length === 1 ? "" : "s"} waiting to sync
            {online ? "" : " — reconnect to send"}
          </span>
          {online ? (
            <Button size="sm" variant="secondary" onClick={onRetryAll}>
              <RefreshCw className="size-4" /> Sync now
            </Button>
          ) : null}
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-destructive">
            <AlertTriangle className="size-5" />
            {failed.length} check-in{failed.length === 1 ? "" : "s"} the server rejected — needs attention
          </div>
          <ul className="flex flex-col gap-2">
            {failed.map((f) => (
              <li key={f.clientId} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <strong>{f.runner}</strong>
                  <span className="text-muted-foreground"> · {f.category} · {f.reason}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onRetryOne(f.clientId)}>Retry</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: Write the `CheckIn` route**

Replace `apps/web/src/routes/CheckIn.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useCheckInEvents, decodeTicketEventId, wrongEventBanner } from "../lib/checkin";
import { useCheckInSession } from "../lib/useCheckInSession";
import { useKeyboardWedge } from "../lib/useKeyboardWedge";
import { QrScanner } from "../components/QrScanner";
import { CheckInBanner } from "../components/CheckInBanner";
import { CheckInRoster } from "../components/CheckInRoster";
import { CheckInQueueStatus } from "../components/CheckInQueueStatus";

const EVENT_KEY = "race-pace.checkin.v1.selected-event";

function syncedLabel(at: string | null): string {
  if (!at) return "Roster not synced yet";
  const mins = Math.floor((Date.now() - new Date(at).getTime()) / 60000);
  if (mins < 1) return "Roster synced just now";
  if (mins < 60) return `Roster synced ${mins} min ago`;
  return `Roster synced ${Math.floor(mins / 60)} h ago`;
}

export function CheckIn() {
  const events = useCheckInEvents();
  const [eventId, setEventId] = useState<string | null>(() => localStorage.getItem(EVENT_KEY));
  const [wrongEvent, setWrongEvent] = useState<string | null>(null);

  // Auto-select when there is exactly one, and drop a stale persisted id.
  useEffect(() => {
    const list = events.data;
    if (!list) return;
    if (eventId && !list.some((e) => e.id === eventId)) { setEventId(null); localStorage.removeItem(EVENT_KEY); return; }
    if (!eventId && list.length === 1) { setEventId(list[0].id); localStorage.setItem(EVENT_KEY, list[0].id); }
  }, [events.data, eventId]);

  const session = useCheckInSession(eventId);
  const selected = events.data?.find((e) => e.id === eventId) ?? null;

  const submit = (token: string) => {
    setWrongEvent(null);
    const tokenEvent = decodeTicketEventId(token);
    if (eventId && tokenEvent && tokenEvent !== eventId) {
      const other = events.data?.find((e) => e.id === tokenEvent);
      setWrongEvent(other?.name ?? "another event");
      return;
    }
    void session.submitToken(token);
  };

  useKeyboardWedge(submit, !!eventId);

  const queuedIds = useMemo(
    () => new Set(session.store.queue.map((q) => q.registrationId)),
    [session.store.queue],
  );

  // A marshal must not wander off with unsent check-ins sitting in this tab.
  const unsent = session.store.queue.length + session.store.failed.length;
  useEffect(() => {
    if (unsent === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  const banner = wrongEvent ? wrongEventBanner(wrongEvent) : session.banner;

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold tracking-tight">Check-in</h1>
        {session.online ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Wifi className="size-4" /> Online</span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600"><CloudOff className="size-4" /> Offline — scans are queued</span>
        )}
        <Select
          value={eventId ?? ""}
          onValueChange={(v) => { setEventId(v); localStorage.setItem(EVENT_KEY, v); }}
        >
          <SelectTrigger className="w-[260px]"><SelectValue placeholder="Choose an event" /></SelectTrigger>
          <SelectContent>
            {(events.data ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </header>

      {!eventId ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          {events.isLoading ? "Loading events…"
            : (events.data ?? []).length === 0 ? "You are not assigned to any event yet. Ask an organizer to add you."
            : "Choose an event to begin checking runners in."}
        </CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm">
            <span className={session.rosterFetchedAt ? "font-medium" : "font-bold text-amber-600"}>
              {syncedLabel(session.rosterFetchedAt)}
            </span>
            <span className="text-muted-foreground">· {session.store.roster.length} runners</span>
            <span className="ml-auto font-semibold">{session.progress.done} / {session.progress.total} checked in</span>
            <Button size="sm" variant="secondary" onClick={session.syncRoster} disabled={session.rosterSyncing}>
              <RefreshCw className={session.rosterSyncing ? "size-4 animate-spin" : "size-4"} /> Sync roster
            </Button>
          </div>

          {session.storageError ? (
            <div className="rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
              {session.storageError}
            </div>
          ) : null}

          <CheckInQueueStatus
            queue={session.store.queue} failed={session.store.failed} online={session.online}
            onRetryAll={() => void session.retryAll()} onRetryOne={(id) => void session.retryOne(id)}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <QrScanner onScan={submit} />
              <CheckInBanner banner={banner} />
            </div>
            <CheckInRoster roster={session.store.roster} queuedIds={queuedIds} onCheckIn={submit} />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Run the route test**

Run: `pnpm --filter web test checkin-route`
Expected: PASS, 6 tests.

- [ ] **Step 10: Verify in the browser**

```bash
docker compose up -d web
```

Open `https://admin.racepace.lan`, sign in as `admin@racepace.test` / `password123`, go to Check-in. **Confirm the page title is Race Pace's** before trusting anything. Then check:
- The event picker lists **both** Apo Sky Ultra 2026 and Davao Sunrise Run 2026. Because there are two, nothing auto-selects — you must choose one. That is correct behaviour, not a bug.
- After choosing, the roster sync line renders. Hosted currently holds a single registration, so expect a roster of 0 or 1 depending on which event you pick, and progress of `0 / 0` or `0 / 1`.
- Camera prompts for permission; denying it shows the fallback rather than a dead panel.
- DevTools → Network → Offline flips the header to "Offline — scans are queued".

- [ ] **Step 11: Full suite, typecheck, commit**

```bash
pnpm --filter web test && pnpm --filter web typecheck
git add apps/web/src/routes/CheckIn.tsx apps/web/src/components/QrScanner.tsx apps/web/src/components/CheckInBanner.tsx apps/web/src/components/CheckInRoster.tsx apps/web/src/components/CheckInQueueStatus.tsx apps/web/src/__tests__/checkin-route.test.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): race-day check-in UI with camera, wedge scanner and offline queue"
```

---

## Task 7: Dashboard aggregate views

**Files:**
- Create: `supabase/migrations/20260806160000_admin_dashboard_views.sql`
- Test: `supabase/tests/admin-dashboard-views.test.ts`

**Interfaces:**
- Consumes: existing `registrations`, `payments`, and their `*_read_org_admin` policies
- Produces: `admin_org_totals_v (org_id, reg_count, paid_count, pending_count, gross_revenue, net_to_org, platform_fee)` and `admin_event_totals_v (org_id, event_id, reg_count, gross_revenue)`

**Context you need:** `security_invoker = true` means the caller's own RLS on `registrations` and `payments` still applies, so these views expose no row an org admin could not already read — same reasoning as `20260804120000_admin_list_views.sql`. Read that file first and match its style.

All money columns are integer centavos. `sum()` over `integer` returns `bigint`; cast explicitly so the shape is predictable.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/admin-dashboard-views.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });

// Self-contained fixtures in the hosted project; destroyed in afterAll.
// Because the org is created here, the totals are EXACT — no >= fudging against
// whatever else happens to live in the database.
const TAG = `dvtest${Date.now()}`;
const userIds: string[] = [];
const orgIds: string[] = [];

async function makeUser(label: string) {
  const email = `${TAG}_${label}@test.dev`;
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (c.error) throw c.error;
  userIds.push(c.data.user!.id);
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  if (s.error) throw s.error;
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}

async function makeOrg(label: string): Promise<string> {
  const r = await svc.from("organizations")
    .insert({ name: `${TAG} ${label}`, slug: `${TAG}-${label}` }).select("id").single();
  if (r.error) throw r.error;
  orgIds.push(r.data.id);
  return r.data.id;
}

let ctx: {
  orgA: string; orgB: string; eventA: string;
  admin: { token: string }; other: { token: string };
};

beforeAll(async () => {
  const orgA = await makeOrg("orga");
  const orgB = await makeOrg("orgb");

  const ev = await svc.from("events").insert({ org_id: orgA, name: `${TAG} Event A` }).select("id").single();
  if (ev.error) throw ev.error;
  const eventA = ev.data.id;

  const cat = await svc.from("categories")
    .insert({ org_id: orgA, event_id: eventA, code: "10k", label: "10K", base_price: 100000 })
    .select("id").single();
  if (cat.error) throw cat.error;

  const admin = await makeUser("admin");
  await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: orgA });
  const other = await makeUser("other");
  await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: orgB });

  const mk = async (label: string, status: "paid" | "pending", amount: number) => {
    const runner = await makeUser(label);
    await svc.from("profiles").insert({ id: runner.id, full_name: `R ${amount}` });
    const reg = await svc.from("registrations").insert({
      org_id: orgA, event_id: eventA, category_id: cat.data.id, user_id: runner.id, status, total_amount: amount,
    }).select("id").single();
    if (reg.error) throw reg.error;
    await svc.from("payments").insert({
      org_id: orgA, registration_id: reg.data.id, amount,
      platform_fee: amount / 10, net_to_org: amount - amount / 10, method: "gcash", status,
    });
  };
  await mk("p1", "paid", 100000);
  await mk("p2", "paid", 200000);
  await mk("p3", "pending", 50000);

  ctx = { orgA, orgB, eventA, admin, other };
}, 60_000);

afterAll(async () => {
  for (const id of userIds) await svc.auth.admin.deleteUser(id);
  for (const id of orgIds) await svc.from("organizations").delete().eq("id", id);
}, 60_000);

describe("dashboard totals views", () => {
  it("sums only paid money, and counts pending without summing it", async () => {
    const res = await authed(ctx.admin.token)
      .from("admin_org_totals_v").select("*").eq("org_id", ctx.orgA).single();
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({
      reg_count: 3, paid_count: 2, pending_count: 1,
      gross_revenue: 300000, net_to_org: 270000, platform_fee: 30000,
    });
  });

  it("aggregates per event", async () => {
    const res = await authed(ctx.admin.token)
      .from("admin_event_totals_v").select("*").eq("event_id", ctx.eventA).single();
    expect(res.data).toMatchObject({ reg_count: 3, gross_revenue: 300000 });
  });

  it("leaks neither rows nor counts to another org", async () => {
    const org = await authed(ctx.other.token)
      .from("admin_org_totals_v").select("*", { count: "exact" }).eq("org_id", ctx.orgA);
    expect(org.data ?? []).toHaveLength(0);
    expect(org.count ?? 0).toBe(0);

    const event = await authed(ctx.other.token)
      .from("admin_event_totals_v").select("*", { count: "exact" }).eq("event_id", ctx.eventA);
    expect(event.data ?? []).toHaveLength(0);
    expect(event.count ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run supabase/tests/admin-dashboard-views.test.ts`
Expected: FAIL — relation `admin_org_totals_v` does not exist.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260806160000_admin_dashboard_views.sql`:

```sql
-- Aggregate read models for the admin dashboard. Design 2026-08-06 §8.1.
--
-- Aggregation stays in Postgres: summing every payment row in the browser does
-- not scale and invites floating-point bugs on money. All amounts are integer
-- centavos; sum() over integer yields bigint, cast explicitly so the wire shape
-- is predictable.
--
-- security_invoker = true: the caller's own RLS on registrations and payments
-- still applies, so these expose no row an org admin could not already read.
-- Same pattern as 20260804120000_admin_list_views.sql.
--
-- admin_event_reg_counts_v stays as-is for the Events list; this adds revenue
-- alongside the count rather than changing that view's shape.

create or replace view admin_org_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    count(*)::int                                                             as reg_count,
    count(*) filter (where p.status = 'paid')::int                            as paid_count,
    count(*) filter (where p.status is distinct from 'paid')::int             as pending_count,
    coalesce(sum(p.amount)       filter (where p.status = 'paid'), 0)::bigint as gross_revenue,
    coalesce(sum(p.net_to_org)   filter (where p.status = 'paid'), 0)::bigint as net_to_org,
    coalesce(sum(p.platform_fee) filter (where p.status = 'paid'), 0)::bigint as platform_fee
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id;

create or replace view admin_event_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    r.event_id,
    count(*)::int                                                             as reg_count,
    coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::bigint       as gross_revenue
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id, r.event_id;

grant select on admin_org_totals_v   to authenticated;
grant select on admin_event_totals_v to authenticated;
```

- [ ] **Step 4: Push to hosted and run**

```bash
pnpm exec supabase db push
```

Then:

```bash
pnpm exec vitest run supabase/tests/admin-dashboard-views.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm the fixtures were cleaned up**

```bash
pnpm exec supabase db query --linked "select count(*) leftover from organizations where slug like 'dvtest%'"
```

Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260806160000_admin_dashboard_views.sql supabase/tests/admin-dashboard-views.test.ts
git commit -m "feat(db): org and per-event dashboard aggregate views"
```

---

## Task 8: Dashboard route

**Files:**
- Create: `apps/web/src/lib/dashboard.ts`
- Modify: `apps/web/src/routes/Dashboard.tsx` (replaces the Task 2 stub)
- Test: `apps/web/src/__tests__/dashboard.test.tsx`

**Interfaces:**
- Consumes: `admin_org_totals_v`, `admin_event_totals_v` (Task 7); existing `admin_registrations_v`; `useMyRoles().orgId` (Task 2)
- Produces:
  - `type OrgTotals = { reg_count: number; paid_count: number; pending_count: number; gross_revenue: number; net_to_org: number; platform_fee: number }`
  - `type EventRow = { id: string; name: string; event_date: string | null; status: string; reg_count: number; gross_revenue: number }`
  - `type RecentSignup = { id: string; full_name: string | null; event_name: string; category_label: string | null; payment_status: string | null; created_at: string }`
  - `useOrgTotals(orgId)`, `useEventTotals(orgId)`, `useRecentSignups(orgId)`

**Context you need:** `admin_registrations_v` carries `event_id` but **not** `event_name` — only `admin_payments_v` has that. Recent signups therefore stitch the event name from the events query already being made for the per-event table. An org has tens of events, so this is a small in-memory map, not a scaling concern.

`useMyRoles().orgId` is non-null here because this route sits behind `RequireAdmin`.

Money is integer centavos. `formatPeso` appears **only in JSX**.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/dashboard.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const tables: Record<string, any[]> = {};

function builder(name: string) {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain, in: () => chain,
    limit: () => Promise.resolve({ data: tables[name] ?? [], error: null }),
    maybeSingle: () => Promise.resolve({ data: (tables[name] ?? [])[0] ?? null, error: null }),
    then: (res: any) => Promise.resolve({ data: tables[name] ?? [], error: null }).then(res),
  };
  return chain;
}

vi.mock("../lib/supabase", () => ({ supabase: { from: (n: string) => builder(n) } }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1", isAdmin: true }, isLoading: false }) }));

import { Dashboard } from "../routes/Dashboard";

function renderDash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
});

it("renders the empty state instead of four zeros when there are no events", async () => {
  tables.events = [];
  tables.admin_org_totals_v = [];
  tables.admin_event_totals_v = [];
  tables.admin_registrations_v = [];
  renderDash();
  expect(await screen.findByText(/create your first event/i)).toBeInTheDocument();
});

it("explains an events-but-no-registrations org rather than implying breakage", async () => {
  tables.events = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", status: "published" }];
  tables.admin_org_totals_v = [];
  tables.admin_event_totals_v = [];
  tables.admin_registrations_v = [];
  renderDash();
  expect(await screen.findByText(/no registrations yet/i)).toBeInTheDocument();
});

it("formats centavos as pesos only at the render edge", async () => {
  tables.events = [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", status: "published" }];
  tables.admin_org_totals_v = [{ org_id: "a1", reg_count: 3, paid_count: 2, pending_count: 1, gross_revenue: 300000, net_to_org: 270000, platform_fee: 30000 }];
  tables.admin_event_totals_v = [{ org_id: "a1", event_id: "e1", reg_count: 3, gross_revenue: 300000 }];
  tables.admin_registrations_v = [{ id: "r1", event_id: "e1", full_name: "Ana Cruz", category_label: "10K", payment_status: "paid", created_at: "2026-08-06T01:00:00Z" }];

  renderDash();
  await waitFor(() => expect(screen.getAllByText("₱3,000.00").length).toBeGreaterThan(0));
  expect(screen.getByText("₱2,700.00")).toBeInTheDocument();
  expect(screen.getByText("2 paid · 1 pending")).toBeInTheDocument();
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getAllByText("Apo Sky Ultra").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test dashboard`
Expected: FAIL — the stub renders only "Dashboard".

- [ ] **Step 3: Write `dashboard.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

/** All money fields are integer centavos. Format with formatPeso at the render edge only. */
export type OrgTotals = {
  reg_count: number; paid_count: number; pending_count: number;
  gross_revenue: number; net_to_org: number; platform_fee: number;
};
export type EventRow = {
  id: string; name: string; event_date: string | null; status: string;
  reg_count: number; gross_revenue: number;
};
export type RecentSignup = {
  id: string; full_name: string | null; event_name: string;
  category_label: string | null; payment_status: string | null; created_at: string;
};

const ZERO: OrgTotals = {
  reg_count: 0, paid_count: 0, pending_count: 0, gross_revenue: 0, net_to_org: 0, platform_fee: 0,
};

export function useOrgTotals(orgId: string | null) {
  return useQuery<OrgTotals>({
    queryKey: ["dash-org-totals", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_org_totals_v").select("*").eq("org_id", orgId!).maybeSingle();
      if (error) throw error;
      return (data as OrgTotals | null) ?? ZERO;   // no registrations yet is zeros, not an error
    },
  });
}

/** Events joined with their totals. An org has tens of events, so the join is in memory. */
export function useEventTotals(orgId: string | null) {
  return useQuery<EventRow[]>({
    queryKey: ["dash-event-totals", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [evs, totals] = await Promise.all([
        supabase.from("events").select("id,name,event_date,status").eq("org_id", orgId!).order("event_date", { ascending: false }),
        supabase.from("admin_event_totals_v").select("event_id,reg_count,gross_revenue").eq("org_id", orgId!),
      ]);
      if (evs.error) throw evs.error;
      if (totals.error) throw totals.error;
      const by = new Map((totals.data ?? []).map((t: any) => [t.event_id, t]));
      return (evs.data ?? []).map((e: any) => ({
        id: e.id, name: e.name, event_date: e.event_date, status: e.status,
        reg_count: by.get(e.id)?.reg_count ?? 0,
        gross_revenue: by.get(e.id)?.gross_revenue ?? 0,
      }));
    },
  });
}

/** admin_registrations_v has event_id but not event_name — only admin_payments_v does —
 *  so the name is stitched from the events list the per-event table already needs. */
export function useRecentSignups(orgId: string | null) {
  return useQuery<RecentSignup[]>({
    queryKey: ["dash-recent", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const [regs, evs] = await Promise.all([
        supabase.from("admin_registrations_v")
          .select("id,event_id,full_name,category_label,payment_status,created_at")
          .eq("org_id", orgId!).order("created_at", { ascending: false }).limit(8),
        supabase.from("events").select("id,name").eq("org_id", orgId!),
      ]);
      if (regs.error) throw regs.error;
      if (evs.error) throw evs.error;
      const names = new Map((evs.data ?? []).map((e: any) => [e.id, e.name]));
      return (regs.data ?? []).map((r: any) => ({
        id: r.id, full_name: r.full_name,
        event_name: names.get(r.event_id) ?? "—",
        category_label: r.category_label, payment_status: r.payment_status, created_at: r.created_at,
      }));
    },
  });
}
```

- [ ] **Step 4: Write the `Dashboard` route**

Replace `apps/web/src/routes/Dashboard.tsx`:

```tsx
import { Link } from "react-router-dom";
import { formatPeso } from "@race-pace/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EventStatusBadge, PaymentStatusBadge } from "../components/StatusBadge";
import { useMyRoles } from "../lib/roles";
import { useEventTotals, useOrgTotals, useRecentSignups } from "../lib/dashboard";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1.5 text-3xl font-bold tracking-tight">{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? null;
  const totals = useOrgTotals(orgId);
  const events = useEventTotals(orgId);
  const recent = useRecentSignups(orgId);

  if (totals.isLoading || events.isLoading) {
    return (
      <div className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
      </div>
    );
  }

  // With no events at all, tiles of zeros read as breakage. Say what to do instead.
  if ((events.data ?? []).length === 0) {
    return (
      <div className="p-6">
        <Card><CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <h2 className="text-lg font-bold">No events yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Registrations, revenue and check-ins all appear here once you publish an event.
          </p>
          <Button asChild><Link to="/events/new">Create your first event</Link></Button>
        </CardContent></Card>
      </div>
    );
  }

  const t = totals.data!;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Registrations" value={String(t.reg_count)} sub={`${t.paid_count} paid · ${t.pending_count} pending`} />
        <Tile label="Gross revenue" value={formatPeso(t.gross_revenue)} sub="Paid registrations only" />
        <Tile label="Net to organization" value={formatPeso(t.net_to_org)} sub={`After ${formatPeso(t.platform_fee)} platform fee`} />
        <Tile label="Awaiting payment" value={String(t.pending_count)} sub="Not yet checked in-able" />
      </div>

      {t.reg_count === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          No registrations yet. Share your event page to start taking sign-ups.
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-border px-5 py-3.5 text-sm font-bold">Recent sign-ups</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Runner</TableHead><TableHead>Event</TableHead>
                  <TableHead>Category</TableHead><TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recent.data ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.full_name ?? "Unknown runner"}</TableCell>
                    <TableCell>{r.event_name}</TableCell>
                    <TableCell>{r.category_label ?? "—"}</TableCell>
                    <TableCell><PaymentStatusBadge status={r.payment_status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-5 py-3.5 text-sm font-bold">Events</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Registrations</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events.data ?? []).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    <Link to={`/events/${e.id}/edit`} className="hover:underline">{e.name}</Link>
                  </TableCell>
                  <TableCell>{e.event_date ?? "—"}</TableCell>
                  <TableCell><EventStatusBadge status={e.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{e.reg_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(e.gross_revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

Note the badge API: `StatusBadge` itself takes `{ tone, children }`, **not** a `status` prop. The status-mapping wrappers are `PaymentStatusBadge({ status: string | null })` and `EventStatusBadge({ status: string })`, both already exported from `apps/web/src/components/StatusBadge.tsx`. `PaymentStatusBadge` handles `null` on its own, which is why the recent-signups cell passes it through directly. `EventStatusBadge` falls back to a de-underscored label for any status it does not map, so `published` renders safely without touching that file.

- [ ] **Step 5: Run the dashboard test**

Run: `pnpm --filter web test dashboard`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify in the browser**

Open `https://admin.racepace.lan/dashboard`. With the current hosted data — one org, two events, one registration and one payment — expect four tiles with small non-zero numbers, one row under Recent sign-ups, and **two** rows in the Events table.

Do **not** try to load more sample data by resetting the database. `supabase db reset` against this linked project drops the hosted database. If you want richer numbers, insert rows deliberately with `db query --linked` and remove them afterwards.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
pnpm --filter web test && pnpm --filter web typecheck
git add apps/web/src/lib/dashboard.ts apps/web/src/routes/Dashboard.tsx apps/web/src/__tests__/dashboard.test.tsx
git commit -m "feat(web): dashboard with org totals, recent sign-ups and per-event revenue"
```

---

## Final verification before the PR

- [ ] **Web suite green**

```bash
pnpm --filter web test
```

- [ ] **Edge Function and shared-package suites green**

```bash
pnpm exec vitest run supabase/functions packages
```

- [ ] **The two new database suites green** (they run against hosted and build/destroy their own fixtures)

```bash
pnpm exec vitest run supabase/tests/checkin-rpcs.test.ts supabase/tests/admin-dashboard-views.test.ts
```

The other files in `supabase/tests/` were written for the retired local stack and are out of scope here — do not treat their failures as caused by this branch.

- [ ] **No fixture rows left behind in hosted**

```bash
pnpm exec supabase db query --linked "select slug from organizations where slug like 'citest%' or slug like 'dvtest%'"
```

Expected: no rows.

- [ ] **Typecheck and build clean**

```bash
pnpm --filter web build
```

- [ ] **Token contract intact** — every hit must be `var(--color-*)`

```bash
grep -rn "var(--" apps/web/src/components/ui/
```

- [ ] **Confirm the CLI is on the right account before touching the hosted project**

```bash
pnpm exec supabase projects list
```

`whaqarofxdlzxrelbcrq` must appear. If it does not, run `pnpm exec supabase login` with the newer Gmail account — a stale token shows other projects and makes `supabase link` fail confusingly.

- [ ] **Apply both migrations to the hosted project**

```bash
pnpm exec supabase db push
```

- [ ] **Verify a marshal end to end against hosted.** Create a marshal user in the Supabase dashboard (Authentication → Add user), give it a `marshal` role on the real org, sign in at `https://admin.racepace.lan`, and confirm: they land on `/check-in`, the sidebar shows only Check-in, visiting `/events` redirects to `/no-access`, and the event picker lists both events.

```bash
pnpm exec supabase db query --linked "insert into user_roles (user_id, role, org_id) values ('<marshal-uuid>', 'marshal', '00000000-0000-0000-0000-0000000000a1') returning id"
```

This one is a deliberate, kept row — unlike the test fixtures. Remove it when you are done if you do not want a standing marshal account:

```bash
pnpm exec supabase db query --linked "delete from user_roles where user_id = '<marshal-uuid>'"
```

- [ ] **Verify the offline round trip by hand.** With an event selected and the roster synced: DevTools → Network → Offline, check a runner in from the roster, confirm the pending-sync chip appears, go back online, confirm it drains and progress increments.
