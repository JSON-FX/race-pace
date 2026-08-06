# Admin Web Check-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give marshals and race directors a working race-day check-in screen in the admin web that scans a runner's QR ticket, calls the existing `check-in` edge function, and shows a colour-coded result.

**Architecture:** The `check-in` edge function already does all verification and writing; nothing about it changes. This plan adds (a) a database migration letting marshals *read* their org's registrations and check-ins, (b) seed data so the flow is exercisable, (c) a web access change admitting marshals to a check-in-only view, and (d) the screen itself — camera scanner plus a manual search fallback, both posting the identical request.

**Tech Stack:** React 19 + Vite + TypeScript, TanStack Query, shadcn/ui + Tailwind v4, Supabase (Postgres RLS, Deno edge functions), vitest + Testing Library, `@zxing/browser` for QR decoding.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-05-admin-checkin-design.md`
- The `check-in` edge function contract is **unchanged**: `POST { ticket_token }`, and it alone writes `checkins` via the service client.
- Wrong-event detection is **client-side and advisory only**. Do not add `event_id` to the edge function.
- Marshals get **read-only** access to `registrations` and `checkins`. Never `payments`. Never any write policy.
- Do **not** widen `auth_can_admin_org` — it guards writes to events, refunds and staff.
- `seed.sql` keeps orgs `…a1`–`…a5` exactly as they are; 7 backend test files pin those ids. New data is appended, never substituted.
- `TICKET_SIGNING_SECRET` for local dev is `dev-only-secret-change-me` (see `supabase/functions/.env`).
- Prices are integer centavos (`450000` = ₱4,500.00).
- Run web tests with `pnpm vitest run apps/web/...`; backend tests need the local stack up and `supabase functions serve` running.

---

## File Structure

**Create:**
- `supabase/migrations/20260805120000_checkin_marshal_rls.sql` — `auth_can_check_in_org` + two SELECT policies
- `supabase/tests/checkin-rls.test.ts` — marshal read boundaries
- `apps/web/src/lib/checkin.ts` — all check-in data access + response→banner mapping
- `apps/web/src/routes/CheckIn.tsx` — the screen
- `apps/web/src/components/TicketScanner.tsx` — camera + decode, isolated so the route is testable without a camera
- `apps/web/src/__tests__/checkin-result.test.ts` — banner mapping + wrong-event guard
- `apps/web/src/__tests__/checkin-route.test.tsx` — screen behaviour
- `apps/web/src/__tests__/marshal-access.test.tsx` — gate + nav filtering

**Modify:**
- `supabase/seed.sql` — append Muspo/RunwithPoint, events, categories, registrations, marshal user
- `apps/web/src/lib/roles.ts` — add `isMarshal`, `canAccessWeb`
- `apps/web/src/App.tsx:15-22` — `RequireAdmin` → `RequireWebAccess`, marshal redirect
- `apps/web/src/components/Sidebar.tsx:19-27` — filter nav for marshals
- `apps/web/package.json` — add `@zxing/browser`

---

### Task 1: Marshal read access (migration + RLS tests)

**Files:**
- Create: `supabase/migrations/20260805120000_checkin_marshal_rls.sql`
- Test: `supabase/tests/checkin-rls.test.ts`

**Interfaces:**
- Consumes: existing `auth_is_super_admin()`, `user_roles`, `registrations`, `checkins`
- Produces: SQL function `auth_can_check_in_org(target uuid) returns boolean`; policies `registrations_read_org_checkin`, `checkins_read_org_checkin`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/checkin-rls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (token: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}

const ORG_A = "00000000-0000-0000-0000-0000000000a1";
const ORG_B = "00000000-0000-0000-0000-0000000000a2";
const EVENT_A = "00000000-0000-0000-0000-0000000000e1";
const CAT_A = "00000000-0000-0000-0000-0000000000c1";

async function seedRegistration(orgId: string, eventId: string, catId: string, userId: string) {
  const svc = service();
  const { data } = await svc.from("registrations")
    .insert({ org_id: orgId, event_id: eventId, category_id: catId, user_id: userId, status: "paid", total_amount: 1000, ticket_token: "seed.token" })
    .select("id").single();
  return data!.id as string;
}

describe("marshal check-in RLS", () => {
  it("a marshal reads their own org's registrations", async () => {
    const marshal = await makeUser(`ci_marshal_${Date.now()}@test.dev`);
    const runner = await makeUser(`ci_runner_${Date.now()}@test.dev`);
    await service().from("user_roles").insert({ user_id: marshal.id, role: "marshal", org_id: ORG_A });
    const regId = await seedRegistration(ORG_A, EVENT_A, CAT_A, runner.id);

    const { data } = await authed(marshal.token).from("registrations").select("id").eq("id", regId);
    expect(data?.map((r) => r.id)).toContain(regId);
  });

  it("a marshal cannot read another org's registrations", async () => {
    const marshal = await makeUser(`ci_marshal_oth_${Date.now()}@test.dev`);
    const runner = await makeUser(`ci_runner_oth_${Date.now()}@test.dev`);
    await service().from("user_roles").insert({ user_id: marshal.id, role: "marshal", org_id: ORG_B });
    const regId = await seedRegistration(ORG_A, EVENT_A, CAT_A, runner.id);

    const { data } = await authed(marshal.token).from("registrations").select("id").eq("id", regId);
    expect(data ?? []).toHaveLength(0);
  });

  it("a marshal cannot read payments", async () => {
    const marshal = await makeUser(`ci_marshal_pay_${Date.now()}@test.dev`);
    await service().from("user_roles").insert({ user_id: marshal.id, role: "marshal", org_id: ORG_A });

    const { data } = await authed(marshal.token).from("payments").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("a marshal cannot update an event", async () => {
    const marshal = await makeUser(`ci_marshal_ev_${Date.now()}@test.dev`);
    await service().from("user_roles").insert({ user_id: marshal.id, role: "marshal", org_id: ORG_A });

    const { error } = await authed(marshal.token).from("events").update({ name: "hacked" }).eq("id", EVENT_A).select("id");
    const { data: after } = await service().from("events").select("name").eq("id", EVENT_A).single();
    expect(after!.name).not.toBe("hacked");
    expect(error ?? { code: "0" }).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run supabase/tests/checkin-rls.test.ts`
Expected: FAIL — the first test returns 0 rows because no policy grants a marshal read access.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260805120000_checkin_marshal_rls.sql`:

```sql
-- Race-day check-in needs marshals to READ their org's registrations (to look a runner up
-- when a QR won't scan) and checkins (for the progress counter). auth_can_admin_org is
-- deliberately NOT widened: it guards writes to events, refunds and staff. This is a
-- separate, read-only capability.
create or replace function public.auth_can_check_in_org(target uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth_is_super_admin()
      or exists (select 1 from user_roles
                 where user_id = auth.uid()
                   and org_id = target
                   and role in ('editor', 'admin', 'marshal'));
$$;

-- Additive SELECT policies. Postgres ORs permissive policies together, so org admins keep
-- their existing access via registrations_read_org_admin / checkins_read_own_or_admin.
create policy registrations_read_org_checkin on public.registrations
  for select using (auth_can_check_in_org(org_id));

create policy checkins_read_org_checkin on public.checkins
  for select using (auth_can_check_in_org(org_id));
```

- [ ] **Step 4: Apply and run tests**

Run: `supabase db reset` then `pnpm vitest run supabase/tests/checkin-rls.test.ts`
Expected: all 4 PASS.

- [ ] **Step 5: Confirm nothing else regressed**

Run: `pnpm vitest run supabase/tests`
Expected: the whole backend suite passes. Widening reads must not break the isolation tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260805120000_checkin_marshal_rls.sql supabase/tests/checkin-rls.test.ts
git commit -m "feat(db): let marshals read their org's registrations and checkins"
```

---

### Task 2: Seed data for check-in

**Files:**
- Modify: `supabase/seed.sql` (append only — do not touch the existing `…a1`–`…a5` block)

**Interfaces:**
- Produces: orgs `…a101` (Muspo) / `…a102` (RunwithPoint); events `…e1001`–`…e1010`, `…e2001`–`…e2010`; categories `…c1001`–`…c2020`; ~15 paid + 4 pending registrations on `…e1003` and `…e1004`; user `marshal@racepace.test` / `password123` with role `marshal` on `…a101`

A signed `ticket_token` is required — `verifyTicketToken` rejects anything else. Mint it in SQL with the same HMAC-SHA256 + base64url scheme as `supabase/functions/_shared/ticket.ts`.

- [ ] **Step 1: Add the token-minting helper to seed.sql**

Append to `supabase/seed.sql`:

```sql
-- Mirrors mintTicketToken() in supabase/functions/_shared/ticket.ts:
-- b64url(json) || '.' || b64url(hmac_sha256(b64url(json), secret)).
-- NOTE: Postgres encode(...,'base64') wraps at 76 chars with newlines — they must be
-- stripped or the signature will not match what the edge function computes.
create or replace function pg_temp.b64url(bytes bytea) returns text
language sql immutable as $$
  select rtrim(translate(replace(encode(bytes, 'base64'), E'\n', ''), '+/', '-_'), '=');
$$;

create or replace function pg_temp.mint_ticket(rid uuid, eid uuid, secret text) returns text
language sql volatile as $$
  select body || '.' || pg_temp.b64url(extensions.hmac(body, secret, 'sha256'))
  from (
    select pg_temp.b64url(convert_to(
      json_build_object('rid', rid, 'eid', eid, 'iat', extract(epoch from now())::bigint)::text,
      'utf8'))
  ) as t(body);
$$;
```

- [ ] **Step 2: Append Muspo and RunwithPoint**

Copy the orgs, events and categories from `scratchpad/reseed.sql` (sections 2–4) verbatim into `supabase/seed.sql`, minus its `truncate`/`delete` statements and minus the `profiles`/`user_roles` rows for `…b1`. Keep every id exactly as-is.

- [ ] **Step 3: Append the marshal user**

```sql
do $$
declare marshal_id uuid := '00000000-0000-0000-0000-0000000000b2';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', marshal_id, 'authenticated', 'authenticated',
    'marshal@racepace.test', extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), marshal_id, marshal_id::text,
    jsonb_build_object('sub', marshal_id::text, 'email', 'marshal@racepace.test', 'email_verified', true),
    'email', now(), now(), now());

  insert into user_roles (user_id, role, org_id)
  values (marshal_id, 'marshal', '00000000-0000-0000-0000-00000000a101');
end $$;
```

- [ ] **Step 4: Append registrations with signed tickets**

15 paid across the two on-going Muspo events (`…e1003` Malaybalay Highland 50, `…e1004` Baguio Cordillera Trail 30) plus 4 pending. Runner accounts are created in the same block:

```sql
do $$
declare
  secret text := 'dev-only-secret-change-me';
  ev uuid; cat uuid; org uuid := '00000000-0000-0000-0000-00000000a101';
  uid uuid; i int; st text;
begin
  for i in 1..19 loop
    ev  := case when i <= 10 then '00000000-0000-0000-0000-0000000e1003'::uuid
                             else '00000000-0000-0000-0000-0000000e1004'::uuid end;
    cat := case when i <= 10 then '00000000-0000-0000-0000-0000000c1006'::uuid
                             else '00000000-0000-0000-0000-0000000c1008'::uuid end;
    st  := case when i <= 15 then 'paid' else 'pending' end;
    uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      'runner' || i || '@racepace.test', extensions.crypt('password123', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', 'runner' || i || '@racepace.test', 'email_verified', true),
      'email', now(), now(), now());

    insert into profiles (id, full_name, bib_name)
    values (uid, 'Runner ' || i, 'RUN' || lpad(i::text, 3, '0'));

    insert into registrations (org_id, event_id, category_id, user_id, status, total_amount, ticket_token)
    values (org, ev, cat, uid, st::registration_status, 300000,
            case when st = 'paid' then pg_temp.mint_ticket(gen_random_uuid(), ev, secret) else null end);
  end loop;
end $$;
```

The `rid` inside the token must equal the registration's own id, so immediately after the loop, re-mint each token against the real row id:

```sql
do $$
declare r record; secret text := 'dev-only-secret-change-me';
begin
  for r in select id, event_id from registrations where status = 'paid' and org_id = '00000000-0000-0000-0000-00000000a101' loop
    update registrations set ticket_token = pg_temp.mint_ticket(r.id, r.event_id, secret) where id = r.id;
  end loop;
end $$;
```

- [ ] **Step 5: Reset and verify the tokens actually verify**

Run: `supabase db reset`, then with `supabase functions serve --env-file supabase/functions/.env` running:

```bash
docker exec -i supabase_db_race-pace psql -U postgres -d postgres -A -t \
  -c "select ticket_token from registrations where status='paid' limit 1;"
```

Post that token to the function as an admin and expect `{"ok":true,...}` — **not** `invalid_ticket`. If it returns `invalid_ticket`, the base64 newline stripping in Step 1 is wrong.

- [ ] **Step 6: Confirm the existing suite still passes**

Run: `pnpm vitest run supabase/tests`
Expected: PASS. Orgs `…a1`–`…a5` and event `…e1` are untouched, so the 29 pinned ids still resolve.

- [ ] **Step 7: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(seed): add Muspo/RunwithPoint, marshal user and paid registrations for check-in"
```

---

### Task 3: Admit marshals to the web

**Files:**
- Modify: `apps/web/src/lib/roles.ts`, `apps/web/src/App.tsx:15-22`, `apps/web/src/components/Sidebar.tsx:19-27`
- Test: `apps/web/src/__tests__/marshal-access.test.tsx`

**Interfaces:**
- Consumes: `useMyRoles()` from Task 3's own edit
- Produces: `MyRoles` gains `isMarshal: boolean` and `canAccessWeb: boolean`; `RequireWebAccess` replaces `RequireAdmin`; `navItemsFor(roles): Item[]` exported from `Sidebar.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/marshal-access.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { navItemsFor } from "../components/Sidebar";

const marshal = { role: "marshal", orgId: "a101", isSuperAdmin: false, isAdmin: false, isOrgAdmin: false, isMarshal: true, canAccessWeb: true };
const admin = { role: "admin", orgId: "a101", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true, isMarshal: false, canAccessWeb: true };

describe("marshal navigation", () => {
  it("a marshal sees only Check-in", () => {
    expect(navItemsFor(marshal).map((i) => i.to)).toEqual(["/check-in"]);
  });

  it("a marshal never sees anything financial", () => {
    const tos = navItemsFor(marshal).map((i) => i.to);
    expect(tos).not.toContain("/payments");
    expect(tos).not.toContain("/registrations");
    expect(tos).not.toContain("/team");
  });

  it("an admin still sees the full org nav", () => {
    expect(navItemsFor(admin).map((i) => i.to)).toContain("/events");
    expect(navItemsFor(admin).map((i) => i.to)).toContain("/payments");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/__tests__/marshal-access.test.tsx`
Expected: FAIL — `navItemsFor` is not exported from `Sidebar.tsx`.

- [ ] **Step 3: Add the role flags**

In `apps/web/src/lib/roles.ts`, extend the type and the returned object:

```ts
export type MyRoles = {
  role: string | null; orgId: string | null;
  isSuperAdmin: boolean; isAdmin: boolean; isOrgAdmin: boolean;
  isMarshal: boolean; canAccessWeb: boolean;
};
```

and inside `queryFn`, after `isSuperAdmin` / `adminRow` are computed:

```ts
const isMarshal = rows.some((r) => r.role === "marshal");
const isAdmin = isSuperAdmin || !!adminRow;
return {
  role: isSuperAdmin ? "super_admin" : adminRow?.role ?? rows[0]?.role ?? null,
  orgId: adminRow?.org_id ?? rows.find((r) => r.role === "marshal")?.org_id ?? null,
  isSuperAdmin,
  isAdmin,
  isOrgAdmin: isSuperAdmin || rows.some((r) => r.role === "admin"),
  isMarshal,
  canAccessWeb: isAdmin || isMarshal,
};
```

`orgId` now falls back to the marshal's org — the check-in screen needs it to list events.

- [ ] **Step 4: Export navItemsFor from Sidebar**

In `apps/web/src/components/Sidebar.tsx`, first export the existing `Item` type (change `type Item = {…}` on line 17 to `export type Item = {…}`), since `navItemsFor` returns it. Then, after the `ORG_ITEMS` / `SUPER_ITEMS` declarations:

```ts
export function navItemsFor(roles: Pick<MyRoles, "isAdmin" | "isMarshal" | "isSuperAdmin">): Item[] {
  if (!roles.isAdmin && roles.isMarshal) return ORG_ITEMS.filter((i) => i.to === "/check-in");
  return roles.isSuperAdmin ? [...ORG_ITEMS, ...SUPER_ITEMS] : ORG_ITEMS;
}
```

Import `MyRoles` as a type from `../lib/roles`, and render the org group from `navItemsFor(roles.data ?? …)` instead of mapping `ORG_ITEMS` directly. Also change the footer's hardcoded `const role = roles.data?.isSuperAdmin ? "Super admin" : "Admin"` to show `"Marshal"` when `isMarshal && !isAdmin`.

- [ ] **Step 5: Swap the route gate**

In `apps/web/src/App.tsx`, rename and extend:

```tsx
function RequireWebAccess() {
  const { session, loading } = useAuth();
  const roles = useMyRoles();
  const location = useLocation();
  if (loading) return <div className="p-8">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (roles.isLoading) return <div className="p-8">Loading…</div>;
  if (!roles.data?.canAccessWeb) return <Navigate to="/no-access" replace />;
  const marshalOnly = roles.data.isMarshal && !roles.data.isAdmin;
  if (marshalOnly && location.pathname !== "/check-in") return <Navigate to="/check-in" replace />;
  return <Outlet />;
}
```

Add `useLocation` to the `react-router-dom` import and update the `<Route element={<RequireAdmin />}>` usage.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run apps/web/src/__tests__/marshal-access.test.tsx`
Expected: all 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/roles.ts apps/web/src/App.tsx apps/web/src/components/Sidebar.tsx apps/web/src/__tests__/marshal-access.test.tsx
git commit -m "feat(web): admit marshals to a check-in-only view"
```

---

### Task 4: Check-in data layer

**Files:**
- Create: `apps/web/src/lib/checkin.ts`
- Test: `apps/web/src/__tests__/checkin-result.test.ts`

**Interfaces:**
- Consumes: `supabase` from `../lib/supabase`; `MyRoles.orgId` from Task 3
- Produces:
  - `type CheckInBanner = { tone: "success" | "warn" | "error" | "muted"; title: string; detail?: string }`
  - `type CheckInReg = { id: string; status: string; ticket_token: string | null; event_id: string; runner: string; bib: string | null; category: string }`
  - `bannerFor(res: { status: number; body: any }, runner?: string, category?: string): CheckInBanner`
  - `wrongEventBanner(ticketEventName: string): CheckInBanner`
  - `decodeTicketEventId(token: string): string | null`
  - `useCheckInEvents(orgId: string | null)`, `useCheckInRoster(eventId: string | null)`, `useCheckInCount(eventId: string | null)`, `useSubmitCheckIn()`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/checkin-result.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bannerFor, wrongEventBanner, decodeTicketEventId } from "../lib/checkin";

describe("bannerFor", () => {
  it("maps a fresh check-in to success", () => {
    const b = bannerFor({ status: 200, body: { ok: true, registration_id: "r1" } }, "Juan Dela Cruz", "100K Ultra");
    expect(b.tone).toBe("success");
    expect(b.title).toBe("Checked in");
    expect(b.detail).toBe("Juan Dela Cruz · 100K Ultra");
  });

  it("maps a repeat scan to muted", () => {
    const b = bannerFor({ status: 200, body: { ok: true, already: true } });
    expect(b.tone).toBe("muted");
    expect(b.title).toBe("Already checked in");
  });

  it("maps not_paid to error", () => {
    expect(bannerFor({ status: 409, body: { error: "not_paid" } })).toMatchObject({ tone: "error", title: "Not paid" });
  });

  it("maps invalid_ticket to error", () => {
    expect(bannerFor({ status: 400, body: { error: "invalid_ticket" } })).toMatchObject({ tone: "error", title: "Invalid ticket" });
  });

  it("maps forbidden to a cross-org message", () => {
    expect(bannerFor({ status: 403, body: { error: "forbidden" } })).toMatchObject({
      tone: "error", title: "Not authorized", detail: "This ticket belongs to another organization.",
    });
  });

  it("maps not_found to error", () => {
    expect(bannerFor({ status: 404, body: { error: "not_found" } })).toMatchObject({ tone: "error", title: "Ticket not recognised" });
  });

  it("maps a server failure to a retryable error", () => {
    expect(bannerFor({ status: 500, body: {} })).toMatchObject({ tone: "error", title: "Could not reach the server" });
  });
});

describe("wrongEventBanner", () => {
  it("names the event the ticket actually belongs to", () => {
    expect(wrongEventBanner("Kitanglad Skyrace")).toMatchObject({
      tone: "warn", title: "Wrong event", detail: "This ticket is for Kitanglad Skyrace.",
    });
  });
});

describe("decodeTicketEventId", () => {
  it("reads eid out of the token body without verifying the signature", () => {
    const body = btoa(JSON.stringify({ rid: "r1", eid: "e1", iat: 1 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeTicketEventId(`${body}.sig`)).toBe("e1");
  });

  it("returns null for a malformed token", () => {
    expect(decodeTicketEventId("not-a-token")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/__tests__/checkin-result.test.ts`
Expected: FAIL — cannot resolve `../lib/checkin`.

- [ ] **Step 3: Implement the module**

Create `apps/web/src/lib/checkin.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type CheckInBanner = { tone: "success" | "warn" | "error" | "muted"; title: string; detail?: string };

export type CheckInReg = {
  id: string; status: string; ticket_token: string | null;
  event_id: string; runner: string; bib: string | null; category: string;
};

export function bannerFor(res: { status: number; body: any }, runner?: string, category?: string): CheckInBanner {
  const detail = [runner, category].filter(Boolean).join(" · ") || undefined;
  if (res.status === 200 && res.body?.ok && res.body?.already) return { tone: "muted", title: "Already checked in", detail };
  if (res.status === 200 && res.body?.ok) return { tone: "success", title: "Checked in", detail };
  switch (res.body?.error) {
    case "not_paid": return { tone: "error", title: "Not paid", detail: "This runner has not completed payment." };
    case "invalid_ticket":
    case "ticket_token_required": return { tone: "error", title: "Invalid ticket", detail: "The QR code could not be verified." };
    case "forbidden": return { tone: "error", title: "Not authorized", detail: "This ticket belongs to another organization." };
    case "not_found": return { tone: "error", title: "Ticket not recognised", detail: "No registration matches this ticket." };
    default: return { tone: "error", title: "Could not reach the server", detail: "Check the connection and scan again." };
  }
}

export function wrongEventBanner(ticketEventName: string): CheckInBanner {
  return { tone: "warn", title: "Wrong event", detail: `This ticket is for ${ticketEventName}.` };
}

/** Reads `eid` from the token body. Signature verification stays on the server — this is
 *  only used to catch a wrong-event scan before we bother the network. */
export function decodeTicketEventId(token: string): string | null {
  const body = token.split(".")[0];
  if (!body) return null;
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    return (JSON.parse(json) as { eid?: string }).eid ?? null;
  } catch {
    return null;
  }
}

export function useCheckInEvents(orgId: string | null) {
  return useQuery({
    queryKey: ["checkin-events", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("events")
        .select("id,name,event_date,end_date").eq("org_id", orgId!).order("event_date");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useCheckInRoster(eventId: string | null) {
  return useQuery<CheckInReg[]>({
    queryKey: ["checkin-roster", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase.from("registrations")
        .select("id,status,ticket_token,event_id,profiles(full_name,bib_name),categories(label)")
        .eq("event_id", eventId!)
        .in("status", ["paid", "pending"]);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id, status: r.status, ticket_token: r.ticket_token, event_id: r.event_id,
        runner: r.profiles?.full_name ?? "Unknown runner",
        bib: r.profiles?.bib_name ?? null,
        category: r.categories?.label ?? "",
      }));
    },
  });
}

export function useCheckInCount(eventId: string | null) {
  return useQuery({
    queryKey: ["checkin-count", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const [done, total] = await Promise.all([
        supabase.from("checkins").select("id", { count: "exact", head: true }).eq("event_id", eventId!),
        supabase.from("registrations").select("id", { count: "exact", head: true }).eq("event_id", eventId!).eq("status", "paid"),
      ]);
      return { done: done.count ?? 0, total: total.count ?? 0 };
    },
  });
}

export function useSubmitCheckIn() {
  const qc = useQueryClient();
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checkin-count"] });
    },
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run apps/web/src/__tests__/checkin-result.test.ts`
Expected: all 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/checkin.ts apps/web/src/__tests__/checkin-result.test.ts
git commit -m "feat(web): add check-in data layer and result mapping"
```

---

### Task 5: The check-in screen

**Files:**
- Create: `apps/web/src/routes/CheckIn.tsx`
- Modify: `apps/web/src/App.tsx` (replace the `/check-in` Placeholder)
- Test: `apps/web/src/__tests__/checkin-route.test.tsx`

**Interfaces:**
- Consumes: everything exported from `apps/web/src/lib/checkin.ts` (Task 4); `useMyRoles` (Task 3)
- Produces: `<CheckIn />` default screen; accepts an optional `scanner` render-prop so tests can drive scans without a camera:
  `export function CheckIn({ scanner }: { scanner?: (onScan: (token: string) => void) => React.ReactNode })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/checkin-route.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckIn } from "../routes/CheckIn";

const submit = vi.fn();
vi.mock("../lib/checkin", async (orig) => {
  const actual = await orig<typeof import("../lib/checkin")>();
  return {
    ...actual,
    useCheckInEvents: () => ({ data: [{ id: "ev1", name: "Apo Summit Ultra 100", event_date: "2026-08-05", end_date: "2026-08-05" }], isLoading: false }),
    useCheckInCount: () => ({ data: { done: 42, total: 138 } }),
    useCheckInRoster: () => ({
      data: [
        { id: "r1", status: "paid", ticket_token: "tok-paid", event_id: "ev1", runner: "Juan Dela Cruz", bib: "RUN001", category: "100K Ultra" },
        { id: "r2", status: "pending", ticket_token: null, event_id: "ev1", runner: "Maria Santos", bib: "RUN002", category: "50K" },
      ],
      isLoading: false,
    }),
    useSubmitCheckIn: () => ({ mutateAsync: submit, isPending: false }),
  };
});

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a101", isAdmin: true, isMarshal: false }, isLoading: false }) }));

function renderScreen(scanner?: (onScan: (t: string) => void) => React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CheckIn scanner={scanner} /></QueryClientProvider>);
}

beforeEach(() => submit.mockReset());

describe("CheckIn screen", () => {
  it("shows the progress counter for the selected event", async () => {
    renderScreen();
    expect(await screen.findByText("42 / 138")).toBeInTheDocument();
  });

  it("shows a success banner after a matching scan", async () => {
    submit.mockResolvedValue({ status: 200, body: { ok: true } });
    let fire: ((t: string) => void) | null = null;
    const body = btoa(JSON.stringify({ rid: "r1", eid: "ev1", iat: 1 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    renderScreen((onScan) => { fire = onScan; return <div data-testid="fake-scanner" />; });
    await waitFor(() => expect(fire).toBeTruthy());
    fire!(`${body}.sig`);
    expect(await screen.findByText("Checked in")).toBeInTheDocument();
  });

  it("refuses a ticket for a different event without calling the server", async () => {
    let fire: ((t: string) => void) | null = null;
    const body = btoa(JSON.stringify({ rid: "r9", eid: "OTHER", iat: 1 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    renderScreen((onScan) => { fire = onScan; return <div data-testid="fake-scanner" />; });
    await waitFor(() => expect(fire).toBeTruthy());
    fire!(`${body}.sig`);
    expect(await screen.findByText("Wrong event")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("enables Check in for paid rows and disables it for pending", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: /search name or bib/i }));
    const paid = await screen.findByRole("button", { name: /check in juan dela cruz/i });
    const pending = await screen.findByRole("button", { name: /check in maria santos/i });
    expect(paid).toBeEnabled();
    expect(pending).toBeDisabled();
  });

  it("submits the row's ticket_token from the manual list", async () => {
    submit.mockResolvedValue({ status: 200, body: { ok: true } });
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: /search name or bib/i }));
    await user.click(await screen.findByRole("button", { name: /check in juan dela cruz/i }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith("tok-paid"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/web/src/__tests__/checkin-route.test.tsx`
Expected: FAIL — cannot resolve `../routes/CheckIn`.

- [ ] **Step 3: Implement the screen**

Create `apps/web/src/routes/CheckIn.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TicketScanner } from "../components/TicketScanner";
import { useMyRoles } from "../lib/roles";
import {
  bannerFor, wrongEventBanner, decodeTicketEventId,
  useCheckInEvents, useCheckInRoster, useCheckInCount, useSubmitCheckIn,
  type CheckInBanner,
} from "../lib/checkin";

const TONE: Record<CheckInBanner["tone"], string> = {
  success: "bg-paid-tint text-forest",
  warn: "bg-amber-tint text-amber",
  error: "bg-destructive-tint text-destructive",
  muted: "bg-muted text-muted-foreground",
};

function defaultEventId(events: { id: string; event_date: string; end_date: string | null }[]): string | null {
  if (!events.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const live = events.find((e) => e.event_date <= today && (e.end_date ?? e.event_date) >= today);
  return (live ?? events.find((e) => e.event_date >= today) ?? events[0]).id;
}

export function CheckIn({ scanner }: { scanner?: (onScan: (token: string) => void) => React.ReactNode }) {
  const roles = useMyRoles();
  const events = useCheckInEvents(roles.data?.orgId ?? null);
  const [eventId, setEventId] = useState<string | null>(null);
  const selected = eventId ?? defaultEventId(events.data ?? []);
  const roster = useCheckInRoster(selected);
  const count = useCheckInCount(selected);
  const submit = useSubmitCheckIn();

  const [banner, setBanner] = useState<CheckInBanner | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flash(b: CheckInBanner) {
    setBanner(b);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setBanner(null), 3000);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handleScan(token: string) {
    const ticketEvent = decodeTicketEventId(token);
    if (ticketEvent && ticketEvent !== selected) {
      const other = (events.data ?? []).find((e) => e.id === ticketEvent);
      flash(wrongEventBanner(other?.name ?? "another event"));
      return;
    }
    const row = (roster.data ?? []).find((r) => r.ticket_token === token);
    const res = await submit.mutateAsync(token);
    flash(bannerFor(res, row?.runner, row?.category));
    roster.refetch?.();
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = roster.data ?? [];
    if (!q) return rows;
    return rows.filter((r) => r.runner.toLowerCase().includes(q) || (r.bib ?? "").toLowerCase().includes(q));
  }, [roster.data, query]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <select
          aria-label="Event"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          value={selected ?? ""}
          onChange={(e) => setEventId(e.target.value)}
        >
          {(events.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <div className="text-sm text-muted-foreground">
          Checked in: <span className="font-semibold text-foreground">{`${count.data?.done ?? 0} / ${count.data?.total ?? 0}`}</span>
        </div>
      </div>

      {scanner ? scanner(handleScan) : <TicketScanner onScan={handleScan} />}

      {banner && (
        <div className={`rounded-lg px-4 py-3 ${TONE[banner.tone]}`} role="status">
          <div className="text-lg font-bold">{banner.title}</div>
          {banner.detail && <div className="text-sm opacity-90">{banner.detail}</div>}
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={() => setShowSearch((s) => !s)}>
        Search name or bib
      </Button>

      {showSearch && (
        <div className="space-y-2">
          <Input placeholder="Search name or bib" value={query} onChange={(e) => setQuery(e.target.value)} />
          <ul className="divide-y rounded-lg border">
            {filtered.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{r.runner}</div>
                  <div className="text-xs text-muted-foreground">{r.bib} · {r.category} · {r.status}</div>
                </div>
                <Button
                  size="sm"
                  aria-label={`Check in ${r.runner}`}
                  disabled={r.status !== "paid" || !r.ticket_token}
                  onClick={() => handleScan(r.ticket_token!)}
                >
                  Check in
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

Note the manual path calls the same `handleScan`, so the wrong-event guard and banner logic are shared — there is exactly one check-in code path.

- [ ] **Step 4: Wire the route**

In `apps/web/src/App.tsx`, replace

```tsx
<Route path="check-in" element={<Placeholder title="Check-in" />} />
```

with

```tsx
<Route path="check-in" element={<CheckIn />} />
```

and add `import { CheckIn } from "./routes/CheckIn";`.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run apps/web/src/__tests__/checkin-route.test.tsx`
Expected: all 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/CheckIn.tsx apps/web/src/App.tsx apps/web/src/__tests__/checkin-route.test.tsx
git commit -m "feat(web): add the race-day check-in screen"
```

---

### Task 6: Camera scanner

**Files:**
- Create: `apps/web/src/components/TicketScanner.tsx`
- Modify: `apps/web/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `export function TicketScanner({ onScan }: { onScan: (token: string) => void })`

This component is deliberately untested by unit tests — jsdom has no camera. Task 5's `scanner` prop is what keeps the screen testable. Verify this one manually in the browser.

- [ ] **Step 1: Add the dependency**

```bash
cd apps/web && pnpm add @zxing/browser
```

- [ ] **Step 2: Implement the component**

Create `apps/web/src/components/TicketScanner.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

/** Continuous QR scanning. Decoding the same code repeatedly is expected — the screen
 *  de-dupes by ignoring a token identical to the one it just handled. */
export function TicketScanner({ onScan }: { onScan: (token: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRef = useRef<string>("");

  useEffect(() => {
    const reader = new BrowserQRCodeReader();
    let stop: (() => void) | undefined;
    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        const text = result?.getText();
        if (!text || text === lastRef.current) return;
        lastRef.current = text;
        onScan(text);
        setTimeout(() => { lastRef.current = ""; }, 2500);
      })
      .then((controls) => { stop = () => controls.stop(); })
      .catch(() => setError("Camera unavailable. Use search instead."));
    return () => stop?.();
  }, [onScan]);

  if (error) return <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{error}</div>;
  return <video ref={videoRef} className="w-full rounded-lg bg-black aspect-video object-cover" muted playsInline />;
}
```

- [ ] **Step 3: Verify manually in the browser**

Start the stack, sign in at `https://admin.racepace.lan` as `marshal@racepace.test` / `password123`, and confirm:
- only Check-in appears in the sidebar
- the browser prompts for camera permission and the viewfinder shows
- scanning a paid runner's QR (render one from a seeded `ticket_token`) turns the banner green
- scanning the same code again turns it grey with "Already checked in"
- the counter increments

- [ ] **Step 4: Run the full web suite**

Run: `pnpm vitest run apps/web`
Expected: PASS, including the pre-existing sidebar and event-editor tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/components/TicketScanner.tsx pnpm-lock.yaml
git commit -m "feat(web): add camera QR scanner for check-in"
```

---

## Self-Review Notes

**Spec coverage:** §1 access → Tasks 1 and 3. §2 screen → Task 5. §3 data flow → Task 4 (mapping) and Task 5 (guard). §4 dependency → Task 6. §5 seed → Task 2. §6 testing → the RLS tests in Task 1, the web tests in Tasks 3–5, and the manual pass in Task 6. The spec's "add a case asserting a marshal is accepted by canCheckIn" is covered by Task 1's RLS tests plus the function's existing coverage.

**Known risk:** Task 2 Step 1's base64 handling is the fragile part — Postgres `encode(…, 'base64')` inserts newlines every 76 characters, and an unstripped newline produces a token the edge function rejects as `invalid_ticket`. Step 5 exists specifically to catch that.
