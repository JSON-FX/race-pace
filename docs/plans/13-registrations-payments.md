# Registrations & Payments Implementation Plan (Plan 13; M3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give org admins an event-scoped **registrations roster** + detail, a read-only **payments ledger**, and the ability to issue **full, slot-freeing refunds** — the first admin read+action path over the registration graph.

**Architecture:** One additive backend migration adds org-scoped **admin READ** policies (reusing `auth_can_admin_org`) across `registrations`/`registration_addons`/`payments`/`profiles`, plus a `decrement_slot` RPC. A new **`admin-refund` Edge Function** (mirroring `confirmPayment`) performs the money+slot transition server-side after verifying the caller is an org admin. The web app reads everything with **direct RLS queries** (a two-step roster read because there's no FK `registrations→profiles`) and calls the function to refund.

**Tech Stack:** Postgres RLS + Supabase Edge Functions (Deno) · Vite 6 / React 19 / supabase-js / TanStack Query v5 / Vitest + RTL (jsdom) · root Vitest for backend (live stack).

**Spec:** [docs/specs/2026-07-22-registrations-payments-design.md](../specs/2026-07-22-registrations-payments-design.md)

## Global Constraints

Every task's requirements implicitly include this section.

- **Additive backend only.** Do **not** touch the existing `*_read_own` policies (RLS policies are OR'd; runners keep self-access). **No enum/column migration** — `refunded` already exists in `registration_status` and `payment_status`; refund metadata rides in `payments.raw` as `{ refunded_at, refunded_by, note }`.
- **Reuse `auth_can_admin_org(uuid)`** (Plan 09 `security definer` helper) for every admin read policy.
- **Reads are pure RLS.** The roster shows **name + bib only** (`profiles.full_name`/`bib_name`); **no email** (lives in `auth.users`, deferred). No service-role read, no view.
- **Refund = full amount, frees the slot**, **only on a `paid` registration**, **idempotent** (a second call on a `refunded` row is a no-op and must NOT decrement the slot again). `decrement_slot` is floored at 0 and granted to `service_role` only.
- **Money logic lives in the Edge Function.** The org-admin check is enforced **inside the function** (service-role bypasses RLS). Refund **leaves `ticket_token` intact**; `registrations.status` is the source of truth.
- **Two-step roster read:** there is no FK `registrations→profiles`, so fetch registrations (with `categories`/`payments`/`registration_addons` embedded) then `profiles` by `user_id`, merged client-side.
- **Seed fixtures (live backend tests):** org `00000000-0000-0000-0000-0000000000a1` (RWP, slug `race-pace`) · other org `…a2` (APO) · event `…e1` · category `…c4` (`10k`, `base_price` 100000, `slots_total` 200) · addon `…d1`.
- **Local backend:** apply the new migration with `supabase db reset` (wipes local data, reapplies migrations + seed) and ensure `supabase functions serve` is running so `admin-refund` is served. **No `docker compose restart web`** — no new web dependency (`supabase.functions.invoke` ships with supabase-js).
- **Test commands:** single web file `pnpm --filter web exec vitest run src/__tests__/<file>`; full web `pnpm --filter web test`; web typecheck `pnpm --filter web typecheck`; backend (root, live stack + functions serve) `pnpm test`.

---

### Task 1: Admin read RLS + `decrement_slot` RPC

**Files:**
- Create: `supabase/migrations/20260722100000_registrations_admin_read.sql`
- Create: `supabase/tests/admin-registrations.test.ts`

**Interfaces:**
- Consumes: `auth_can_admin_org(uuid)` (Plan 09); `registrations`/`registration_addons`/`payments`/`profiles`/`categories` tables.
- Produces: four `*_read_org_admin` select policies; `decrement_slot(p_category_id uuid)` returns void (service-role only).

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/admin-registrations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) => createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });
async function makeUser(email: string) {
  const svc = service();
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}
const RWP = "00000000-0000-0000-0000-0000000000a1";
const APO = "00000000-0000-0000-0000-0000000000a2";
const E1 = "00000000-0000-0000-0000-0000000000e1";
const C4 = "00000000-0000-0000-0000-0000000000c4";

describe("admin registration reads", () => {
  it("an org admin reads its org's registrations/addons/payments + registrant profiles; other-org admin cannot; runner reads only own", async () => {
    const svc = service();
    const admin = await makeUser(`rr_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const other = await makeUser(`rr_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO });
    const runner = await makeUser(`rr_run_${Date.now()}@test.dev`);
    const stranger = await makeUser(`rr_str_${Date.now()}@test.dev`); // profile, but no registration in RWP
    await svc.from("profiles").insert({ id: runner.id, full_name: "Runner One", bib_name: "RUN1" });
    await svc.from("profiles").insert({ id: stranger.id, full_name: "Stranger" });

    const reg = await svc.from("registrations").insert({ org_id: RWP, event_id: E1, category_id: C4, user_id: runner.id, status: "paid", total_amount: 100000 }).select().single();
    await svc.from("payments").insert({ org_id: RWP, registration_id: reg.data!.id, amount: 100000, status: "paid" });
    await svc.from("registration_addons").insert({ registration_id: reg.data!.id, addon_id: "00000000-0000-0000-0000-0000000000d1", price: 60000 });

    // org admin sees the whole graph for its org
    expect((await authed(admin.token).from("registrations").select("id").eq("id", reg.data!.id)).data).toHaveLength(1);
    expect((await authed(admin.token).from("payments").select("registration_id").eq("registration_id", reg.data!.id)).data).toHaveLength(1);
    expect((await authed(admin.token).from("registration_addons").select("addon_id").eq("registration_id", reg.data!.id)).data).toHaveLength(1);
    expect((await authed(admin.token).from("profiles").select("id").eq("id", runner.id)).data).toHaveLength(1);
    // ...but NOT a profile of someone who never registered in its org
    expect((await authed(admin.token).from("profiles").select("id").eq("id", stranger.id)).data ?? []).toHaveLength(0);

    // other-org admin sees none of it
    expect((await authed(other.token).from("registrations").select("id").eq("id", reg.data!.id)).data ?? []).toHaveLength(0);
    expect((await authed(other.token).from("payments").select("registration_id").eq("registration_id", reg.data!.id)).data ?? []).toHaveLength(0);
    expect((await authed(other.token).from("profiles").select("id").eq("id", runner.id)).data ?? []).toHaveLength(0);

    // runner still reads only their own registration (read_own intact)
    expect((await authed(runner.token).from("registrations").select("id").eq("id", reg.data!.id)).data).toHaveLength(1);

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    await svc.from("profiles").delete().in("id", [runner.id, stranger.id]);
    for (const u of [admin, other, runner, stranger]) await svc.auth.admin.deleteUser(u.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- admin-registrations`
Expected: FAIL — the admin/other reads return rows they shouldn't (no `*_read_org_admin` policy yet, so the admin sees 0 for registrations/payments/addons; the assertions expecting length 1 fail).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260722100000_registrations_admin_read.sql`:

```sql
-- Plan 13: org-admin READ across the registration graph + a slot-release RPC.
-- Additive; the runner *_read_own policies remain (RLS policies are OR'd).
-- Reuses the Plan 09 security-definer helper auth_can_admin_org(uuid).

create policy "registrations_read_org_admin" on registrations for select
  using (auth_can_admin_org(org_id));

create policy "payments_read_org_admin" on payments for select
  using (auth_can_admin_org(org_id));

create policy "registration_addons_read_org_admin" on registration_addons for select
  using (exists (select 1 from registrations r
                 where r.id = registration_addons.registration_id
                   and auth_can_admin_org(r.org_id)));

-- An admin reads the profile (name/bib) of anyone who registered in their org — and only them.
create policy "profiles_read_org_admin" on profiles for select
  using (exists (select 1 from registrations r
                 where r.user_id = profiles.id
                   and auth_can_admin_org(r.org_id)));

-- Slot release on refund — mirror of increment_slot; floored at 0 (defensive).
create or replace function decrement_slot(p_category_id uuid)
returns void language sql as $$
  update categories set slots_taken = greatest(slots_taken - 1, 0) where id = p_category_id;
$$;
grant execute on function decrement_slot(uuid) to service_role;
```

- [ ] **Step 4: Apply the migration**

Run: `supabase db reset`
Expected: migrations apply cleanly (including `20260722100000_registrations_admin_read.sql`) and the seed loads. *(This wipes local data and requires the local stack running.)*

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- admin-registrations`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260722100000_registrations_admin_read.sql supabase/tests/admin-registrations.test.ts
git commit -m "feat(backend): org-admin read RLS for registrations/payments/profiles + decrement_slot RPC" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `admin-refund` Edge Function

**Files:**
- Create: `supabase/functions/_shared/refund.ts`
- Create: `supabase/functions/admin-refund/index.ts`
- Test: `supabase/tests/backend.test.ts` (append refund cases)

**Interfaces:**
- Consumes: `serviceClient()` from `_shared/supabase.ts`; `decrement_slot` RPC (Task 1); `auth_can_admin_org` semantics (re-implemented in TS via `user_roles`).
- Produces: `refundRegistration(registrationId, refundedBy, note?)` → `RefundResult`; the `POST /admin-refund` endpoint (`{ registration_id, note? }` → `{ ok, registration_id, already? }`).

- [ ] **Step 1: Write the failing test**

In `supabase/tests/backend.test.ts`, append (the file already declares `url`, `anonKey`, `service`, `anon`, `makeUser`, and `FN`):

```ts
const RWP_RF = "00000000-0000-0000-0000-0000000000a1";
const APO_RF = "00000000-0000-0000-0000-0000000000a2";
const E1_RF = "00000000-0000-0000-0000-0000000000e1";
const C4_RF = "00000000-0000-0000-0000-0000000000c4";

async function paidRegistration(runnerToken: string) {
  const checkout = await fetch(`${FN}/registrations-checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${runnerToken}` },
    body: JSON.stringify({ event_id: E1_RF, category_id: C4_RF, custom_data: { blood_type: "A", shirt_size: "L" }, waiver_accepted: true, idempotency_key: `idem-rf-${Date.now()}` }),
  }).then((r) => r.json());
  await fetch(`${FN}/payments-webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ registration_id: checkout.registration_id, method: "gcash" }) });
  return checkout.registration_id as string;
}
const refundCall = (token: string, rid: string) => fetch(`${FN}/admin-refund`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ registration_id: rid }) });

describe("admin-refund", () => {
  it("org admin refunds a paid registration -> refunded + slot released; non-admin & other-org blocked; idempotent", async () => {
    const svc = service();
    const admin = await makeUser(`rf_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP_RF });
    const other = await makeUser(`rf_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO_RF });
    const runner = await makeUser(`rf_run_${Date.now()}@test.dev`);

    const before = await svc.from("categories").select("slots_taken").eq("id", C4_RF).single();
    const rid = await paidRegistration(runner.token);
    const paid = await svc.from("categories").select("slots_taken").eq("id", C4_RF).single();
    expect(paid.data!.slots_taken).toBe(before.data!.slots_taken + 1);

    // runner (no role) and other-org admin are both forbidden
    expect((await refundCall(runner.token, rid)).status).toBe(403);
    expect((await refundCall(other.token, rid)).status).toBe(403);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data?.status).toBe("paid");

    // org admin refund => 200, refunded, slot released back to baseline
    const ok = await refundCall(admin.token, rid);
    expect(ok.status).toBe(200);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data?.status).toBe("refunded");
    expect((await svc.from("payments").select("status").eq("registration_id", rid).single()).data?.status).toBe("refunded");
    expect((await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken).toBe(before.data!.slots_taken);

    // idempotent: a second refund is a no-op, no further decrement
    const again = await refundCall(admin.token, rid);
    const againBody = await again.json();
    expect(again.status).toBe(200);
    expect(againBody.already).toBe(true);
    expect((await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken).toBe(before.data!.slots_taken);

    await svc.from("registrations").delete().eq("id", rid);
    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    for (const u of [admin, other, runner]) await svc.auth.admin.deleteUser(u.id);
  });

  it("refuses to refund a pending (not paid) registration with 409", async () => {
    const svc = service();
    const admin = await makeUser(`rf_pend_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP_RF });
    const runner = await makeUser(`rf_prun_${Date.now()}@test.dev`);
    // checkout only (no webhook) => pending
    const checkout = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${runner.token}` },
      body: JSON.stringify({ event_id: E1_RF, category_id: C4_RF, custom_data: { blood_type: "A", shirt_size: "L" }, waiver_accepted: true, idempotency_key: `idem-pend-${Date.now()}` }),
    }).then((r) => r.json());
    expect((await refundCall(admin.token, checkout.registration_id)).status).toBe(409);

    await svc.from("registrations").delete().eq("id", checkout.registration_id);
    await svc.from("user_roles").delete().eq("user_id", admin.id);
    for (const u of [admin, runner]) await svc.auth.admin.deleteUser(u.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- backend`
Expected: FAIL — `POST /admin-refund` 404s (function not created yet), so the status assertions fail.

- [ ] **Step 3: Write the shared refund logic**

Create `supabase/functions/_shared/refund.ts`:

```ts
import { serviceClient } from "./supabase.ts";

export type RefundResult =
  | { ok: true; registration_id: string; already?: boolean }
  | { ok: false; error: string; status: number };

/** Refund a paid registration: flip payment + registration to 'refunded' and
 *  release the category slot. Idempotent — a second call on an already-refunded
 *  registration is a no-op. Caller authorization is the endpoint's responsibility. */
export async function refundRegistration(
  registrationId: string,
  refundedBy: string,
  note: string | null = null,
): Promise<RefundResult> {
  const db = serviceClient();
  const { data: reg } = await db
    .from("registrations")
    .select("id,category_id,status")
    .eq("id", registrationId)
    .single();
  if (!reg) return { ok: false, error: "not_found", status: 404 };
  if (reg.status === "refunded") return { ok: true, registration_id: reg.id, already: true };
  if (reg.status !== "paid") return { ok: false, error: "not_refundable", status: 409 };

  // PayMongo refund call goes here at the swap point (no-op for the fake provider).
  const { data: pay } = await db.from("payments").select("raw").eq("registration_id", reg.id).single();
  const raw = { ...((pay?.raw as Record<string, unknown>) ?? {}), refunded_at: new Date().toISOString(), refunded_by: refundedBy, note };

  await db.from("payments").update({ status: "refunded", raw }).eq("registration_id", reg.id);
  await db.from("registrations").update({ status: "refunded" }).eq("id", reg.id);
  await db.rpc("decrement_slot", { p_category_id: reg.category_id });

  return { ok: true, registration_id: reg.id };
}
```

- [ ] **Step 4: Write the endpoint**

Create `supabase/functions/admin-refund/index.ts`:

```ts
import { serviceClient } from "../_shared/supabase.ts";
import { refundRegistration } from "../_shared/refund.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Admin-initiated refund. Verifies the caller is an editor/admin of the
// registration's org (super_admin allowed) — service-role bypasses RLS, so this
// check IS the authorization boundary — then refunds server-side.
Deno.serve(async (req) => {
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const registrationId = body.registration_id as string | undefined;
    if (!registrationId) return json({ error: "registration_id_required" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    const { data: reg } = await db.from("registrations").select("org_id").eq("id", registrationId).single();
    if (!reg) return json({ error: "not_found" }, 404);

    const { data: roles } = await db.from("user_roles").select("role,org_id").eq("user_id", userId);
    const canAdmin = (roles ?? []).some((r) =>
      r.role === "super_admin" || (r.org_id === reg.org_id && (r.role === "editor" || r.role === "admin")));
    if (!canAdmin) return json({ error: "forbidden" }, 403);

    const note = typeof body.note === "string" ? body.note : null;
    const r = await refundRegistration(registrationId, userId, note);
    if (!r.ok) return json({ error: r.error }, r.status);
    return json({ ok: true, registration_id: r.registration_id, already: r.already });
  } catch (e) {
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
```

- [ ] **Step 5: Restart functions serve, then run the test**

Ensure the new function is served (restart `supabase functions serve` if it serves a fixed list).

Run: `pnpm test -- backend`
Expected: PASS (the two `admin-refund` cases + all pre-existing backend cases; no new reds).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/refund.ts supabase/functions/admin-refund/index.ts supabase/tests/backend.test.ts
git commit -m "feat(backend): admin-refund Edge Function (org-admin authz, idempotent, slot release)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Web read model — `lib/registrations.ts`

**Files:**
- Create: `apps/web/src/lib/registrations.ts`
- Test: `apps/web/src/__tests__/registrations-hooks.test.tsx`

**Interfaces:**
- Consumes: `supabase` from `lib/supabase.ts`; the Task 1 read policies; the Task 2 function.
- Produces:
  - `type PaymentStatus = "pending" | "paid" | "failed" | "refunded"`
  - `type RegistrationRow = { id; user_id; category_id; category_label: string|null; full_name: string|null; bib_name: string|null; total_amount: number; payment_status: PaymentStatus|null; payment_method: string|null; created_at: string; custom_data: Record<string, unknown>; addons: { name: string|null; price: number }[] }`
  - `useEventRegistrations(eventId?)` → `RegistrationRow[]`
  - `useEventRegistrationCounts(orgId?)` → `Record<string, number>` (event_id → count)
  - `refundRegistration(registrationId, note?)` → `{ ok: boolean; error?: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/registrations-hooks.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let rosterRows: unknown[];
let countRows: unknown[];
let profilesData: unknown[];
vi.mock("../lib/supabase", () => {
  const invoke = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }));
  const from = vi.fn((table: string) => {
    const b: Record<string, unknown> = { _select: "" };
    b.select = (cols: string) => { b._select = cols; return b; };
    b.eq = () => b;
    b.in = () => Promise.resolve({ data: profilesData, error: null });
    b.order = () => Promise.resolve({ data: table === "profiles" ? profilesData : (b._select === "event_id" ? countRows : rosterRows), error: null });
    return b;
  });
  return { supabase: { from, functions: { invoke } } };
});

import { supabase } from "../lib/supabase";
import { useEventRegistrations, useEventRegistrationCounts, refundRegistration } from "../lib/registrations";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  rosterRows = [{ id: "r1", user_id: "u1", category_id: "c4", total_amount: 100000, created_at: "2026-07-01T00:00:00Z", custom_data: { blood_type: "O" }, categories: { label: "10K" }, payments: { status: "paid", method: "gcash" }, registration_addons: [{ price: 60000, addons: { name: "Singlet" } }] }];
  countRows = [{ event_id: "e1" }, { event_id: "e1" }, { event_id: "e2" }];
  profilesData = [{ id: "u1", full_name: "Ana Cruz", bib_name: "ANA" }];
});

it("useEventRegistrations merges category + payment + profile + addons into a row", async () => {
  const { result } = renderHook(() => useEventRegistrations("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  expect(result.current.data![0]).toMatchObject({
    id: "r1", full_name: "Ana Cruz", bib_name: "ANA", category_label: "10K",
    payment_status: "paid", payment_method: "gcash", total_amount: 100000,
    addons: [{ name: "Singlet", price: 60000 }],
  });
});

it("useEventRegistrationCounts tallies registrations per event", async () => {
  const { result } = renderHook(() => useEventRegistrationCounts("a1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual({ e1: 2, e2: 1 }));
});

it("refundRegistration invokes the admin-refund function with the registration id", async () => {
  const res = await refundRegistration("r1");
  expect(res.ok).toBe(true);
  expect(supabase.functions.invoke).toHaveBeenCalledWith("admin-refund", { body: { registration_id: "r1", note: null } });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/registrations-hooks.test.tsx`
Expected: FAIL — cannot resolve `../lib/registrations`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/registrations.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export type RegistrationRow = {
  id: string;
  user_id: string;
  category_id: string;
  category_label: string | null;
  full_name: string | null;
  bib_name: string | null;
  total_amount: number;
  payment_status: PaymentStatus | null;
  payment_method: string | null;
  created_at: string;
  custom_data: Record<string, unknown>;
  addons: { name: string | null; price: number }[];
};

// PostgREST returns an embedded to-one either as an object or a 1-element array
// depending on how it detects the relationship — normalize to the object.
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | undefined;

export function useEventRegistrations(eventId?: string) {
  return useQuery<RegistrationRow[]>({
    queryKey: ["event-registrations", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("registrations")
        .select("id,user_id,category_id,total_amount,created_at,custom_data,categories(label),payments(status,method),registration_addons(price,addons(name))")
        .eq("event_id", eventId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const regs = (data ?? []) as Record<string, unknown>[];

      const ids = [...new Set(regs.map((r) => r.user_id as string))];
      let profiles: Record<string, { full_name: string | null; bib_name: string | null }> = {};
      if (ids.length) {
        const { data: profs, error: pErr } = await supabase.from("profiles").select("id,full_name,bib_name").in("id", ids);
        if (pErr) throw pErr;
        profiles = Object.fromEntries((profs ?? []).map((p: Record<string, unknown>) => [p.id as string, { full_name: (p.full_name as string) ?? null, bib_name: (p.bib_name as string) ?? null }]));
      }

      return regs.map((r): RegistrationRow => {
        const cat = one(r.categories);
        const pay = one(r.payments);
        const addons = ((r.registration_addons as Record<string, unknown>[]) ?? []).map((a) => ({ name: (one(a.addons)?.name as string) ?? null, price: a.price as number }));
        return {
          id: r.id as string,
          user_id: r.user_id as string,
          category_id: r.category_id as string,
          category_label: (cat?.label as string) ?? null,
          full_name: profiles[r.user_id as string]?.full_name ?? null,
          bib_name: profiles[r.user_id as string]?.bib_name ?? null,
          total_amount: r.total_amount as number,
          payment_status: (pay?.status as PaymentStatus) ?? null,
          payment_method: (pay?.method as string) ?? null,
          created_at: r.created_at as string,
          custom_data: (r.custom_data as Record<string, unknown>) ?? {},
          addons,
        };
      });
    },
  });
}

export function useEventRegistrationCounts(orgId?: string) {
  return useQuery<Record<string, number>>({
    queryKey: ["event-registration-counts", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("registrations").select("event_id").eq("org_id", orgId!).order("event_id");
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const r of (data ?? []) as { event_id: string }[]) counts[r.event_id] = (counts[r.event_id] ?? 0) + 1;
      return counts;
    },
  });
}

/** Issue a full refund via the admin-refund Edge Function. */
export async function refundRegistration(registrationId: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("admin-refund", { body: { registration_id: registrationId, note: note ?? null } });
  if (error) return { ok: false, error: "Refund failed. Please try again." };
  return { ok: true };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/__tests__/registrations-hooks.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/registrations.ts apps/web/src/__tests__/registrations-hooks.test.tsx
git commit -m "feat(web): registrations read model (roster two-step merge, counts, refund invoke)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: RefundModal + RegistrationDetail + PaymentBadge

**Files:**
- Create: `apps/web/src/components/PaymentBadge.tsx`
- Create: `apps/web/src/components/RefundModal.tsx`
- Create: `apps/web/src/components/RegistrationDetail.tsx`
- Test: `apps/web/src/__tests__/registration-detail.test.tsx`

**Interfaces:**
- Consumes: `refundRegistration` + `RegistrationRow` (Task 3).
- Produces:
  - `PaymentBadge({ status: string | null })`
  - `RefundModal({ registration: { id; full_name: string|null; total_amount: number }; onClose; onDone })`
  - `RegistrationDetail({ row: RegistrationRow; onClose; onRefunded })`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/registration-detail.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RegistrationDetail } from "../components/RegistrationDetail";

const refundRegistration = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock("../lib/registrations", () => ({ refundRegistration: (...a: unknown[]) => refundRegistration(...a) }));

const paidRow = { id: "r1", user_id: "u1", category_id: "c4", category_label: "10K", full_name: "Ana Cruz", bib_name: "ANA", total_amount: 100000, payment_status: "paid", payment_method: "gcash", created_at: "2026-07-01T00:00:00Z", custom_data: { blood_type: "O" }, addons: [{ name: "Singlet", price: 60000 }] };
const pendingRow = { ...paidRow, payment_status: "pending", payment_method: null };
beforeEach(() => refundRegistration.mockClear());

it("shows the registration and enables Refund only when paid", () => {
  const { rerender } = render(<RegistrationDetail row={pendingRow as never} onClose={vi.fn()} onRefunded={vi.fn()} />);
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("10K")).toBeInTheDocument();
  expect(screen.getByText("Singlet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refund" })).toBeDisabled();
  rerender(<RegistrationDetail row={paidRow as never} onClose={vi.fn()} onRefunded={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Refund" })).not.toBeDisabled();
});

it("refunds through the confirm modal and calls onRefunded", async () => {
  const onRefunded = vi.fn();
  render(<RegistrationDetail row={paidRow as never} onClose={vi.fn()} onRefunded={onRefunded} />);
  fireEvent.click(screen.getByRole("button", { name: "Refund" }));           // opens modal
  fireEvent.click(screen.getByRole("button", { name: "Confirm refund" }));   // executes
  await waitFor(() => expect(refundRegistration).toHaveBeenCalledWith("r1", undefined));
  await waitFor(() => expect(onRefunded).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/registration-detail.test.tsx`
Expected: FAIL — cannot resolve `../components/RegistrationDetail`.

- [ ] **Step 3: Write PaymentBadge**

Create `apps/web/src/components/PaymentBadge.tsx`:

```tsx
const PAY: Record<string, { label: string; color: string; bg: string }> = {
  paid: { label: "Paid", color: "var(--forest)", bg: "var(--parchment)" },
  pending: { label: "Pending", color: "var(--amber)", bg: "var(--amber-tint)" },
  refunded: { label: "Refunded", color: "var(--info)", bg: "var(--info-tint)" },
  failed: { label: "Failed", color: "var(--danger)", bg: "var(--danger-tint)" },
};

export function PaymentBadge({ status }: { status: string | null }) {
  const s = PAY[status ?? ""] ?? { label: status ?? "—", color: "var(--ink-muted)", bg: "var(--parchment)" };
  return <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", color: s.color, background: s.bg }}>{s.label}</span>;
}
```

- [ ] **Step 4: Write RefundModal**

Create `apps/web/src/components/RefundModal.tsx`:

```tsx
import { useState } from "react";
import { refundRegistration } from "../lib/registrations";

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center", zIndex: 50 } as const;
const box = { width: 380, background: "var(--canvas)", borderRadius: 16, padding: 24 } as const;
const input = { border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", fontSize: 14, width: "100%" } as const;

export function RefundModal({ registration, onClose, onDone }: {
  registration: { id: string; full_name: string | null; total_amount: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const res = await refundRegistration(registration.id, note || undefined);
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Refund failed."); else { onDone(); onClose(); }
  }
  const peso = `₱${(registration.total_amount / 100).toLocaleString()}`;
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Refund {peso}?</div>
        <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>Refunds {registration.full_name ?? "this runner"} and reopens their slot. This can't be undone.</p>
        <div style={{ display: "grid", gap: 12 }}>
          <input aria-label="Refund note" placeholder="Reason (optional)" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "9px 18px", fontWeight: 600, cursor: "pointer" }}>Keep it</button>
            <button aria-label="Confirm refund" onClick={submit} disabled={busy} style={{ background: "var(--danger)", color: "#fff", border: 0, borderRadius: "var(--radius-pill)", padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>{busy ? "Refunding…" : "Refund"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write RegistrationDetail**

Create `apps/web/src/components/RegistrationDetail.tsx`:

```tsx
import { useState } from "react";
import type { RegistrationRow } from "../lib/registrations";
import { PaymentBadge } from "./PaymentBadge";
import { RefundModal } from "./RefundModal";

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "flex", justifyContent: "flex-end", zIndex: 40 } as const;
const drawer = { width: 420, maxWidth: "100%", height: "100%", background: "var(--canvas)", padding: 24, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 } as const;
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
      <span style={{ color: "var(--ink-muted)" }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function RegistrationDetail({ row, onClose, onRefunded }: { row: RegistrationRow; onClose: () => void; onRefunded: () => void }) {
  const [refunding, setRefunding] = useState(false);
  const canRefund = row.payment_status === "paid";
  const customEntries = Object.entries(row.custom_data ?? {});
  return (
    <div style={overlay} onClick={onClose}>
      <aside style={drawer} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{row.full_name ?? "—"}</div>
            {row.bib_name ? <div style={{ fontSize: 13, color: "var(--ink-muted)" }}>{row.bib_name}</div> : null}
          </div>
          <button aria-label="Close" onClick={onClose} style={{ background: "none", border: 0, fontSize: 20, cursor: "pointer", color: "var(--ink-muted)" }}>×</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <Row label="Category" value={row.category_label ?? "—"} />
          <Row label="Amount" value={peso(row.total_amount)} />
          <Row label="Payment" value={<PaymentBadge status={row.payment_status} />} />
          {row.payment_method ? <Row label="Method" value={row.payment_method} /> : null}
          <Row label="Registered" value={fmtDate(row.created_at)} />
        </div>
        {row.addons.length ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".4px", color: "var(--section)", textTransform: "uppercase", marginBottom: 6 }}>Add-ons</div>
            {row.addons.map((a, i) => <Row key={i} label={a.name ?? "—"} value={peso(a.price)} />)}
          </div>
        ) : null}
        {customEntries.length ? (
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".4px", color: "var(--section)", textTransform: "uppercase", marginBottom: 6 }}>Registration fields</div>
            {customEntries.map(([k, v]) => <Row key={k} label={k} value={String(v)} />)}
          </div>
        ) : null}
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
          <button disabled={!canRefund} onClick={() => setRefunding(true)} style={{ background: canRefund ? "var(--danger)" : "var(--surface)", color: canRefund ? "#fff" : "var(--ink-muted)", border: 0, borderRadius: "var(--radius-pill)", padding: "9px 20px", fontWeight: 600, cursor: canRefund ? "pointer" : "default" }}>
            {row.payment_status === "refunded" ? "Refunded" : "Refund"}
          </button>
        </div>
        {refunding ? (
          <RefundModal
            registration={{ id: row.id, full_name: row.full_name, total_amount: row.total_amount }}
            onClose={() => setRefunding(false)}
            onDone={onRefunded}
          />
        ) : null}
      </aside>
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter web exec vitest run src/__tests__/registration-detail.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/PaymentBadge.tsx apps/web/src/components/RefundModal.tsx apps/web/src/components/RegistrationDetail.tsx apps/web/src/__tests__/registration-detail.test.tsx
git commit -m "feat(web): registration detail drawer + refund confirm modal + payment badge" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Registrations route (selector + filters + roster)

**Files:**
- Create: `apps/web/src/routes/Registrations.tsx`
- Modify: `apps/web/src/App.tsx` (route `registrations` → `<Registrations />`)
- Test: `apps/web/src/__tests__/registrations.test.tsx`

**Interfaces:**
- Consumes: `useMyRoles` (`orgId`); `useOrgEvents` (event selector); `useEventRegistrations`/`useEventRegistrationCounts` (Task 3); `RegistrationDetail`/`PaymentBadge` (Task 4); `useSearchParams` (react-router).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/registrations.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Registrations } from "../routes/Registrations";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("../lib/events", () => ({ useOrgEvents: () => ({ data: [{ id: "e1", name: "Apo Sky Ultra" }] }) }));
vi.mock("../lib/registrations", () => ({
  useEventRegistrationCounts: () => ({ data: { e1: 2 }, refetch: vi.fn() }),
  useEventRegistrations: () => ({
    data: [
      { id: "r1", user_id: "u1", category_id: "c4", category_label: "10K", full_name: "Ana Cruz", bib_name: "ANA", total_amount: 100000, payment_status: "paid", payment_method: "gcash", created_at: "2026-07-01T00:00:00Z", custom_data: {}, addons: [] },
      { id: "r2", user_id: "u2", category_id: "c3", category_label: "21K", full_name: "Ben Diaz", bib_name: null, total_amount: 150000, payment_status: "pending", payment_method: null, created_at: "2026-07-02T00:00:00Z", custom_data: {}, addons: [] },
    ],
    isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock("../components/RegistrationDetail", () => ({ RegistrationDetail: ({ row }: { row: { full_name: string } }) => <div data-testid="detail">{row.full_name}</div> }));
vi.mock("../components/PaymentBadge", () => ({ PaymentBadge: ({ status }: { status: string }) => <span>{status}</span> }));

const at = (path = "/registrations?event=e1") => render(<MemoryRouter initialEntries={[path]}><Registrations /></MemoryRouter>);

it("lists the event's registrations and filters by payment status", () => {
  at();
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "paid" } });
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.queryByText("Ben Diaz")).not.toBeInTheDocument();
});

it("filters by name search", () => {
  at();
  fireEvent.change(screen.getByLabelText("Search name"), { target: { value: "ben" } });
  expect(screen.queryByText("Ana Cruz")).not.toBeInTheDocument();
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
});

it("opens the detail when a row is clicked", () => {
  at();
  fireEvent.click(screen.getByText("Ana Cruz"));
  expect(screen.getByTestId("detail")).toHaveTextContent("Ana Cruz");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/registrations.test.tsx`
Expected: FAIL — cannot resolve `../routes/Registrations`.

- [ ] **Step 3: Write the route**

Create `apps/web/src/routes/Registrations.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMyRoles } from "../lib/roles";
import { useOrgEvents } from "../lib/events";
import { useEventRegistrations, useEventRegistrationCounts, type RegistrationRow } from "../lib/registrations";
import { RegistrationDetail } from "../components/RegistrationDetail";
import { PaymentBadge } from "../components/PaymentBadge";

const PAY_FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const GRID = "2fr 1fr .9fr 1fr .9fr";
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Registrations() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const events = useOrgEvents(orgId);
  const counts = useEventRegistrationCounts(orgId);
  const [params, setParams] = useSearchParams();
  const eventId = params.get("event") ?? events.data?.[0]?.id ?? undefined;

  const regs = useEventRegistrations(eventId);
  const [payFilter, setPayFilter] = useState<(typeof PAY_FILTERS)[number]>("all");
  const [catFilter, setCatFilter] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<RegistrationRow | null>(null);

  const cats = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of regs.data ?? []) if (r.category_id) m.set(r.category_id, r.category_label ?? r.category_id);
    return [...m.entries()];
  }, [regs.data]);

  const rows = useMemo(() => (regs.data ?? []).filter((r) => {
    if (payFilter !== "all" && r.payment_status !== payFilter) return false;
    if (catFilter !== "all" && r.category_id !== catFilter) return false;
    if (q && !`${r.full_name ?? ""} ${r.bib_name ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [regs.data, payFilter, catFilter, q]);

  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <select aria-label="Event" style={selectStyle} value={eventId ?? ""} onChange={(e) => setParams({ event: e.target.value })}>
          {(events.data ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.name}{counts.data?.[ev.id] != null ? ` (${counts.data[ev.id]})` : ""}</option>)}
        </select>
        <select aria-label="Payment status" style={selectStyle} value={payFilter} onChange={(e) => setPayFilter(e.target.value as (typeof PAY_FILTERS)[number])}>
          {PAY_FILTERS.map((f) => <option key={f} value={f}>{f === "all" ? "All payments" : f[0].toUpperCase() + f.slice(1)}</option>)}
        </select>
        <select aria-label="Category" style={selectStyle} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <input aria-label="Search name" placeholder="Search name…" style={{ ...selectStyle, minWidth: 180 }} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {!eventId ? (
        <div style={cardStyle}><div style={emptyStyle}>Pick an event to see its registrations.</div></div>
      ) : regs.isLoading ? (
        <div style={cardStyle}><div style={emptyStyle}>Loading registrations…</div></div>
      ) : (
        <div style={{ ...cardStyle, overflow: "hidden" }}>
          <div style={{ ...theadStyle, gridTemplateColumns: GRID }}>
            <span>Runner</span><span>Category</span><span>Amount</span><span>Payment</span><span>Registered</span>
          </div>
          {rows.length === 0 ? <div style={emptyStyle}>No registrations match.</div> : rows.map((r) => (
            <div key={r.id} role="button" onClick={() => setSelected(r)} style={{ display: "grid", gridTemplateColumns: GRID, padding: "14px 20px", borderTop: "1px solid var(--row-border)", alignItems: "center", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.full_name ?? "—"}</div>
                {r.bib_name ? <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{r.bib_name}</div> : null}
              </div>
              <div style={{ fontSize: 13 }}>{r.category_label ?? "—"}</div>
              <div style={{ fontSize: 13 }}>{peso(r.total_amount)}</div>
              <div><PaymentBadge status={r.payment_status} /></div>
              <div style={{ fontSize: 13 }}>{fmtDate(r.created_at)}</div>
            </div>
          ))}
        </div>
      )}

      {selected ? (
        <RegistrationDetail row={selected} onClose={() => setSelected(null)} onRefunded={() => { setSelected(null); regs.refetch(); counts.refetch(); }} />
      ) : null}
    </div>
  );
}

const cardStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)" } as const;
const theadStyle = { display: "grid", padding: "12px 20px", background: "var(--surface)", color: "var(--section)", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", textTransform: "uppercase" } as const;
const selectStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 11, padding: "9px 12px", fontSize: 13, color: "var(--ink)" } as const;
const emptyStyle = { padding: 20, color: "var(--ink-muted)", fontSize: 14 } as const;
```

- [ ] **Step 4: Wire the route in App.tsx**

In `apps/web/src/App.tsx`, add the import next to the other route imports:

```ts
import { Registrations } from "./routes/Registrations";
```

Replace the registrations placeholder route:

```tsx
            <Route path="registrations" element={<Placeholder title="Registrations" />} />
```

with:

```tsx
            <Route path="registrations" element={<Registrations />} />
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter web exec vitest run src/__tests__/registrations.test.tsx`
Expected: PASS (3 tests).

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/Registrations.tsx apps/web/src/App.tsx apps/web/src/__tests__/registrations.test.tsx
git commit -m "feat(web): event-scoped registrations roster (selector + filters + detail)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Payments ledger route

**Files:**
- Modify: `apps/web/src/lib/registrations.ts` (add `usePayments` + `PaymentRow`)
- Create: `apps/web/src/routes/Payments.tsx`
- Modify: `apps/web/src/App.tsx` (route `payments` → `<Payments />`)
- Test: `apps/web/src/__tests__/payments.test.tsx`

**Interfaces:**
- Consumes: `supabase`; the Task 1 `payments_read_org_admin`/`profiles_read_org_admin` policies; `useMyRoles`; `PaymentBadge`.
- Produces: `type PaymentRow = { registration_id; event_id: string|null; event_name: string|null; user_id: string|null; full_name: string|null; amount; platform_fee; net_to_org; method: string|null; status: PaymentStatus; created_at }`; `usePayments(orgId?)` → `PaymentRow[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/payments.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Payments } from "../routes/Payments";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("../lib/registrations", () => ({
  usePayments: () => ({
    data: [
      { registration_id: "r1", event_id: "e1", event_name: "Apo Sky Ultra", user_id: "u1", full_name: "Ana Cruz", amount: 100000, platform_fee: 10000, net_to_org: 90000, method: "gcash", status: "paid", created_at: "2026-07-01T00:00:00Z" },
      { registration_id: "r2", event_id: "e1", event_name: "Apo Sky Ultra", user_id: "u2", full_name: "Ben Diaz", amount: 150000, platform_fee: 15000, net_to_org: 135000, method: "card", status: "refunded", created_at: "2026-07-02T00:00:00Z" },
    ],
    isLoading: false,
  }),
}));
vi.mock("../components/PaymentBadge", () => ({ PaymentBadge: ({ status }: { status: string }) => <span>{status}</span> }));
beforeEach(() => navigate.mockClear());

it("lists payments with money columns and filters by status", () => {
  render(<MemoryRouter><Payments /></MemoryRouter>);
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("₱900")).toBeInTheDocument(); // net_to_org 90000
  fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "refunded" } });
  expect(screen.queryByText("Ana Cruz")).not.toBeInTheDocument();
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
});

it("navigates to the event roster when a row is clicked", () => {
  render(<MemoryRouter><Payments /></MemoryRouter>);
  fireEvent.click(screen.getByText("Ana Cruz"));
  expect(navigate).toHaveBeenCalledWith("/registrations?event=e1");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/payments.test.tsx`
Expected: FAIL — cannot resolve `../routes/Payments`.

- [ ] **Step 3: Add `usePayments` to the read model**

Append to `apps/web/src/lib/registrations.ts`:

```ts
export type PaymentRow = {
  registration_id: string;
  event_id: string | null;
  event_name: string | null;
  user_id: string | null;
  full_name: string | null;
  amount: number;
  platform_fee: number;
  net_to_org: number;
  method: string | null;
  status: PaymentStatus;
  created_at: string;
};

export function usePayments(orgId?: string) {
  return useQuery<PaymentRow[]>({
    queryKey: ["org-payments", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("registration_id,amount,platform_fee,net_to_org,method,status,created_at,registrations(event_id,user_id,events(name))")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];

      const ids = [...new Set(rows.map((r) => one(r.registrations)?.user_id as string).filter(Boolean))];
      let profiles: Record<string, string | null> = {};
      if (ids.length) {
        const { data: profs, error: pErr } = await supabase.from("profiles").select("id,full_name").in("id", ids);
        if (pErr) throw pErr;
        profiles = Object.fromEntries((profs ?? []).map((p: Record<string, unknown>) => [p.id as string, (p.full_name as string) ?? null]));
      }

      return rows.map((r): PaymentRow => {
        const rg = one(r.registrations);
        const ev = one(rg?.events);
        const uid = (rg?.user_id as string) ?? null;
        return {
          registration_id: r.registration_id as string,
          event_id: (rg?.event_id as string) ?? null,
          event_name: (ev?.name as string) ?? null,
          user_id: uid,
          full_name: uid ? profiles[uid] ?? null : null,
          amount: r.amount as number,
          platform_fee: r.platform_fee as number,
          net_to_org: r.net_to_org as number,
          method: (r.method as string) ?? null,
          status: r.status as PaymentStatus,
          created_at: r.created_at as string,
        };
      });
    },
  });
}
```

- [ ] **Step 4: Write the route**

Create `apps/web/src/routes/Payments.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMyRoles } from "../lib/roles";
import { usePayments } from "../lib/registrations";
import { PaymentBadge } from "../components/PaymentBadge";

const FILTERS = ["all", "pending", "paid", "refunded", "failed"] as const;
const GRID = "1.4fr 1.4fr .9fr .8fr .8fr .9fr .9fr .9fr";
const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Payments() {
  const roles = useMyRoles();
  const pays = usePayments(roles.data?.orgId ?? undefined);
  const nav = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const rows = useMemo(() => (pays.data ?? []).filter((p) => filter === "all" || p.status === filter), [pays.data, filter]);

  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ marginBottom: 16 }}>
        <select aria-label="Payment status" style={selectStyle} value={filter} onChange={(e) => setFilter(e.target.value as (typeof FILTERS)[number])}>
          {FILTERS.map((f) => <option key={f} value={f}>{f === "all" ? "All payments" : f[0].toUpperCase() + f.slice(1)}</option>)}
        </select>
      </div>
      <div style={{ ...cardStyle, overflow: "hidden" }}>
        <div style={{ ...theadStyle, gridTemplateColumns: GRID }}>
          <span>Event</span><span>Runner</span><span>Amount</span><span>Fee</span><span>Net</span><span>Method</span><span>Status</span><span>Date</span>
        </div>
        {pays.isLoading ? <div style={emptyStyle}>Loading payments…</div> :
         rows.length === 0 ? <div style={emptyStyle}>No payments yet.</div> :
         rows.map((p) => (
          <div key={p.registration_id} role="button" onClick={() => p.event_id && nav(`/registrations?event=${p.event_id}`)} style={{ display: "grid", gridTemplateColumns: GRID, padding: "14px 20px", borderTop: "1px solid var(--row-border)", alignItems: "center", cursor: "pointer" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.event_name ?? "—"}</div>
            <div style={{ fontSize: 13 }}>{p.full_name ?? "—"}</div>
            <div style={{ fontSize: 13 }}>{peso(p.amount)}</div>
            <div style={{ fontSize: 13 }}>{peso(p.platform_fee)}</div>
            <div style={{ fontSize: 13 }}>{peso(p.net_to_org)}</div>
            <div style={{ fontSize: 13 }}>{p.method ?? "—"}</div>
            <div><PaymentBadge status={p.status} /></div>
            <div style={{ fontSize: 13 }}>{fmtDate(p.created_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const cardStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)" } as const;
const theadStyle = { display: "grid", padding: "12px 20px", background: "var(--surface)", color: "var(--section)", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", textTransform: "uppercase" } as const;
const selectStyle = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 11, padding: "9px 12px", fontSize: 13, color: "var(--ink)" } as const;
const emptyStyle = { padding: 20, color: "var(--ink-muted)", fontSize: 14 } as const;
```

- [ ] **Step 5: Wire the route in App.tsx**

In `apps/web/src/App.tsx`, add the import:

```ts
import { Payments } from "./routes/Payments";
```

Replace the payments placeholder route:

```tsx
            <Route path="payments" element={<Placeholder title="Payments" />} />
```

with:

```tsx
            <Route path="payments" element={<Payments />} />
```

- [ ] **Step 6: Run the test + typecheck**

Run: `pnpm --filter web exec vitest run src/__tests__/payments.test.tsx`
Expected: PASS (2 tests).

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/registrations.ts apps/web/src/routes/Payments.tsx apps/web/src/App.tsx apps/web/src/__tests__/payments.test.tsx
git commit -m "feat(web): read-only org payments ledger (links into the event roster)" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Events list — registration count + "View registrations"

**Files:**
- Modify: `apps/web/src/routes/Events.tsx`
- Modify: `apps/web/src/__tests__/events.test.tsx` (add a `../lib/registrations` mock)
- Modify: `apps/web/src/__tests__/events-address.test.tsx` (add a `../lib/registrations` mock)
- Test: `apps/web/src/__tests__/events-registrations.test.tsx`

**Interfaces:**
- Consumes: `useEventRegistrationCounts` (Task 3); `useNavigate`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/events-registrations.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Events } from "../routes/Events";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
const rows = [{ id: "e1", name: "Apo Sky Ultra", place: null, city_name: "City of Digos", province_name: "Davao del Sur", event_date: "2026-11-14", status: "open", original_date: null, categories: [] }];
vi.mock("../lib/events", () => ({ useOrgEvents: () => ({ data: rows, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("../lib/registrations", () => ({ useEventRegistrationCounts: () => ({ data: { e1: 7 } }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig() as object), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
beforeEach(() => navigate.mockClear());

it("shows the registration count and navigates to the roster from the row menu", () => {
  render(<MemoryRouter><Events /></MemoryRouter>);
  expect(screen.getByText("7")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Actions for Apo Sky Ultra"));
  fireEvent.click(screen.getByText("View registrations"));
  expect(navigate).toHaveBeenCalledWith("/registrations?event=e1");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web exec vitest run src/__tests__/events-registrations.test.tsx`
Expected: FAIL — no "7" count column and no "View registrations" menu item yet.

- [ ] **Step 3: Add the count column + menu item to Events.tsx**

In `apps/web/src/routes/Events.tsx`, add the import:

```ts
import { useEventRegistrationCounts } from "../lib/registrations";
```

Change the grid template constant (add one column before the actions cell):

```ts
const GRID = "2.4fr 1.2fr 1fr .9fr .8fr auto";
```

to:

```ts
const GRID = "2.4fr 1.1fr .9fr .8fr .7fr .7fr auto";
```

Read the counts inside the component (next to `const roles = useMyRoles();`):

```tsx
  const counts = useEventRegistrationCounts(roles.data?.orgId ?? undefined);
```

Add a `Regs` header cell — replace the header row:

```tsx
          <span>Event</span><span>Date</span><span>Status</span><span>Categories</span><span>Fill</span><span></span>
```

with:

```tsx
          <span>Event</span><span>Date</span><span>Status</span><span>Categories</span><span>Fill</span><span>Regs</span><span></span>
```

Add the count cell — after the Fill cell (`<div style={{ fontSize: 13 }}>{fill(e.categories)}</div>`), insert:

```tsx
              <div style={{ fontSize: 13 }}>{counts.data?.[e.id] ?? 0}</div>
```

Add the "View registrations" menu item — after the `Edit` menu button, insert:

```tsx
                    <button style={menuItem} onClick={() => { setMenuId(null); nav(`/registrations?event=${e.id}`); }}>View registrations</button>
```

- [ ] **Step 4: Keep the existing Events tests green (add the counts mock)**

In BOTH `apps/web/src/__tests__/events.test.tsx` and `apps/web/src/__tests__/events-address.test.tsx`, add this mock next to the other `vi.mock` calls (Events now imports `useEventRegistrationCounts`):

```ts
vi.mock("../lib/registrations", () => ({ useEventRegistrationCounts: () => ({ data: {} }) }));
```

- [ ] **Step 5: Run the affected tests + typecheck**

Run: `pnpm --filter web exec vitest run src/__tests__/events-registrations.test.tsx src/__tests__/events.test.tsx src/__tests__/events-address.test.tsx`
Expected: PASS.

Run: `pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/Events.tsx apps/web/src/__tests__/events-registrations.test.tsx apps/web/src/__tests__/events.test.tsx apps/web/src/__tests__/events-address.test.tsx
git commit -m "feat(web): Events list shows registration count + View registrations link" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Full verification + roadmap

**Files:**
- Modify: `docs/README.md`

- [ ] **Step 1: Run the full web suite + typecheck**

```bash
pnpm --filter web test          # all web tests
pnpm --filter web typecheck     # clean
```

Expected: all green (includes the new registrations-hooks, registration-detail, registrations, payments, and events-registrations suites; the updated events/events-address suites).

- [ ] **Step 2: Run the backend suite (live stack + functions serve)**

```bash
pnpm test -- admin-registrations
pnpm test -- backend
```

Expected: `admin-registrations` green; `backend` green including the two new `admin-refund` cases, with **no new reds** versus the pre-existing baseline. *(Requires `supabase db reset` applied (Task 1) and `supabase functions serve` running with `admin-refund`.)*

- [ ] **Step 3: Tick Plan 13 in the roadmap**

In `docs/README.md`, replace:

```markdown
- [ ] **Plan 13 · Registrations & payments** — table/detail, admin refunds
```

with:

```markdown
- [x] **Plan 13 · Registrations & payments** — [spec](./specs/2026-07-22-registrations-payments-design.md) · [plan](./plans/13-registrations-payments.md) — org-scoped admin read RLS (registrations/addons/payments/profiles) + decrement_slot; event-scoped roster + detail; read-only payments ledger; full slot-freeing refunds via the admin-refund Edge Function
```

- [ ] **Step 4: Commit**

```bash
git add docs/README.md
git commit -m "docs: mark Plan 13 (registrations & payments) complete in the roadmap" \
  -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual smoke (optional, recommended)**

Open https://admin.racepace.lan → **Registrations**: pick an event, confirm the roster loads (name/bib, category, amount, payment badge). Open a **paid** registration → **Refund** → confirm → the badge flips to Refunded and the event's "spots left" increases by one. Check **Payments** shows the money ledger and a row links back to the roster. Confirm the **Events** list shows a Regs count and its ⋯ → "View registrations" deep-links. *(No `docker compose restart web` — no new web dependency. The backend needs the migration applied and `admin-refund` served.)*

---

## Self-Review

**Spec coverage:**
- §3 admin read RLS (registrations/payments/registration_addons/profiles) + `decrement_slot` → Task 1. ✓
- §4 `admin-refund` Edge Function (JWT → org-admin authz, `paid`-guard/idempotent, payment+registration→refunded, `decrement_slot`, note in `payments.raw`) → Task 2. ✓
- §7 web read model (`useEventRegistrations` two-step, `useEventRegistrationCounts`, `refundRegistration`; `usePayments`) → Tasks 3 & 6. ✓
- §5 roster (event selector, status/category/name filters, columns) + detail (add-ons, custom fields, gated Refund) → Tasks 4 & 5. ✓
- §6 read-only payments ledger linking into the roster → Task 6. ✓
- §2.2 registration count + "View registrations" on the Events list → Task 7. ✓
- §9 tests: backend RLS + edge fn (403/409/idempotent) + web (merge, filters, disabled-unless-paid, refund invoke, ledger, count/link) → Tasks 1–7. ✓
- Global constraints (additive/no enum change; pure-RLS name+bib reads; slot floor + service_role-only RPC; ticket left intact) → honored across tasks. ✓
- §8 verification + roadmap → Task 8. ✓

**Placeholder scan:** none — every code/test/command block is complete and concrete.

**Type consistency:** `RegistrationRow` (Task 3) is the single row type consumed by `RegistrationDetail` (Task 4) and `Registrations` (Task 5); `payment_status: PaymentStatus | null` drives both `PaymentBadge` and the `canRefund = row.payment_status === "paid"` gate. `refundRegistration(id, note?)` (Task 3) is called as `refundRegistration(registration.id, note || undefined)` by `RefundModal` (Task 4) — matching the test's `("r1", undefined)`. `useEventRegistrationCounts` returns `Record<string, number>` consumed identically by the Registrations selector (Task 5) and the Events list (Task 7). `usePayments`/`PaymentRow` (Task 6) reuse the `one()` embed-normalizer and `PaymentStatus` from Task 3. The `admin-refund` request body `{ registration_id, note? }` (Task 3 invoke) matches the endpoint's parse (Task 2). Seed ids (`…a1`/`…a2`/`…e1`/`…c4`/`…d1`) are consistent across the Task 1 and Task 2 backend tests.
```
