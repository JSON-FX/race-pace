# Registration Deadlines, Kit Edits, and Audit Log — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let organizers close registration by date and freeze shirt sizes on a later date, let runners fix their own shirt size until that freeze, and record every registration change in an auditable timeline shown in the admin drawer.

**Architecture:** Two nullable `timestamptz` columns on `events`, derived at read time wherever `status` is already checked and enforced server-side on write. Runner edits go through one `security definer` RPC that checks the deadline, writes `custom_data`, and appends audit rows in a single transaction. No scheduled job flips `status`.

**Tech Stack:** Postgres (Supabase migrations), Deno edge functions, React 19 + Vite + shadcn/ui (`apps/web`), Next.js 15 (`apps/site`), Zod (`packages/shared`), vitest everywhere, pnpm 9 workspaces.

**Spec:** `docs/superpowers/specs/2026-08-08-registration-deadlines-design.md`

## Global Constraints

- Node >= 20, pnpm 9.7.0. Never run `npm`.
- Three hand-synced copies of shared vocabulary exist and must stay in sync: `packages/shared/src/index.ts` (canonical), `supabase/functions/_shared/validation.ts` (Deno copy — the edge runtime only mounts `supabase/functions/`, so it cannot import the workspace package), and `supabase/functions/_shared/eventStatus.ts`. Any list added to one goes in all that need it.
- All new SQL functions: `security definer`, `set search_path = ''`, every identifier schema-qualified (`public.registrations`, `auth.uid()`), `revoke all ... from public` then an explicit grant.
- Row-locking on any function that mutates a registration: `select ... for update`.
- Migration filenames are `supabase/migrations/YYYYMMDDHHMMSS_name.sql`. The latest existing migration is `20260806150000`; use the timestamps given in each task.
- `custom_data` is a snapshot taken at checkout. Editing a registration never writes back to `profiles`.
- Copy is sentence case. No emoji. Icons come from `lucide-react` (already a dependency in both apps).
- Backend tests (`supabase/tests/*.test.ts`) need a reachable Supabase and env via `test/env.ts`. Run them from the repo root with `pnpm test`.

## Test Commands

| Scope | Command |
| --- | --- |
| Shared + backend (root vitest) | `pnpm test` |
| Single backend file | `pnpm vitest run supabase/tests/<file>.test.ts` |
| Admin web | `pnpm --filter web test` |
| Runner site | `pnpm --filter site test` |
| Types across the workspace | `pnpm typecheck` |

## File Structure

**Created:**
- `supabase/migrations/20260808100000_event_deadlines.sql` — deadline columns + constraint
- `supabase/migrations/20260808100100_registration_audit.sql` — audit table, RLS, grants
- `supabase/migrations/20260808100200_update_registration_fields_tx.sql` — the edit RPC
- `supabase/migrations/20260808120000_money_txn_audit.sql` — audit rows from the money RPCs
- `supabase/tests/registration-fields-edit.test.ts` — RPC behaviour
- `supabase/tests/event-deadlines.test.ts` — columns, constraint, checkout enforcement
- `apps/site/components/RaceKitCard.tsx` — runner kit card (open + locked)
- `apps/site/components/ShirtSizeSheet.tsx` — size picker sheet
- `apps/site/lib/kit.ts` — kit lock rule, edit client call, result mapping, deadline notice
- `apps/site/components/__tests__/race-kit-card.test.tsx`
- `apps/site/lib/__tests__/kit.test.ts`
- `apps/web/lib/deadlines.ts` + `.test.ts` — datetime-local ↔ ISO conversion
- `apps/web/lib/audit.ts` + `.test.ts` — audit row type and day grouping
- `apps/web/components/RegistrationHistory.tsx` + `.test.tsx` — the timeline section

**Modified:**
- `packages/shared/src/index.ts` — field edit policy + labels
- `packages/shared/src/index.test.ts` — tests for the above
- `supabase/functions/_shared/validation.ts` — Deno mirror of the policy
- `supabase/functions/_shared/eventStatus.ts` — deadline-aware rule
- `supabase/functions/registrations-checkout/index.ts` — pass the deadline
- `apps/site/lib/eventStatus.ts` + `apps/site/lib/__tests__/eventStatus.test.ts`
- `apps/site/lib/events.ts`, `apps/site/lib/home.ts`, `apps/site/lib/registration.ts` — select the new column
- `apps/site/app/page.tsx`, `app/events/[id]/page.tsx`, `app/register/[categoryId]/page.tsx`, `app/pay/[registrationId]/page.tsx`, `app/pay/[registrationId]/PayPanel.tsx` — call sites
- `apps/site/app/ticket/[registrationId]/TicketPanel.tsx` — mount the kit card
- `apps/web/app/(admin)/events/event-editor-form.tsx` + `.test.tsx` — deadline inputs
- `apps/web/lib/actions/events.ts` — `EventDraft` type + the `EVENT_COLS` write whitelist
- `apps/web/lib/queries/event-editor.ts` — `EditorEvent` type + the `EVENT_SELECT` read list
- `apps/web/components/RegistrationDetail.tsx` + `.test.tsx` — mount the history, branch the Supabase mock

---

### Task 1: Event deadline columns

**Files:**
- Create: `supabase/migrations/20260808100000_event_deadlines.sql`
- Create: `supabase/tests/event-deadlines.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `events.registration_closes_at timestamptz null`, `events.kit_edit_closes_at timestamptz null`, constraint `events_kit_edit_after_reg_close`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/event-deadlines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function org(tag: string) {
  const s = svc();
  const o = (await s.from("organizations").insert({ name: "Deadline Org", slug: `dl-${tag}-${Date.now()}` }).select().single()).data!;
  return { s, o };
}

describe("event deadline columns", () => {
  it("accepts a kit cutoff after the registration close", async () => {
    const { s, o } = await org("ok");
    const { data, error } = await s.from("events").insert({
      org_id: o.id, name: "Deadline Race", status: "open",
      registration_closes_at: "2026-09-01T15:59:00Z",
      kit_edit_closes_at: "2026-09-06T15:59:00Z",
    }).select().single();
    expect(error).toBeNull();
    expect(data!.registration_closes_at).not.toBeNull();
    await s.from("organizations").delete().eq("id", o.id);
  });

  it("rejects a kit cutoff earlier than the registration close", async () => {
    const { s, o } = await org("bad");
    const { error } = await s.from("events").insert({
      org_id: o.id, name: "Bad Race", status: "open",
      registration_closes_at: "2026-09-06T15:59:00Z",
      kit_edit_closes_at: "2026-09-01T15:59:00Z",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("events_kit_edit_after_reg_close");
    await s.from("organizations").delete().eq("id", o.id);
  });

  it("allows both null so existing events are unaffected", async () => {
    const { s, o } = await org("null");
    const { data, error } = await s.from("events")
      .insert({ org_id: o.id, name: "No Deadline Race", status: "open" }).select().single();
    expect(error).toBeNull();
    expect(data!.registration_closes_at).toBeNull();
    expect(data!.kit_edit_closes_at).toBeNull();
    await s.from("organizations").delete().eq("id", o.id);
  });

  it("allows a kit cutoff with no registration close", async () => {
    const { s, o } = await org("kitonly");
    const { error } = await s.from("events").insert({
      org_id: o.id, name: "Kit Only Race", status: "open",
      kit_edit_closes_at: "2026-09-06T15:59:00Z",
    });
    expect(error).toBeNull();
    await s.from("organizations").delete().eq("id", o.id);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run supabase/tests/event-deadlines.test.ts`
Expected: FAIL — inserting `registration_closes_at` errors with `column "registration_closes_at" of relation "events" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260808100000_event_deadlines.sql`:

```sql
-- Date-based registration control. Both nullable: NULL means "no deadline", so every
-- existing event keeps its current status-only behaviour with no backfill.
--
-- Deliberately NOT enforced by a scheduled job. `status` stays the organizer's manual
-- override (close early / cancel) and always wins; these dates are derived at read time
-- and re-checked server-side on write. A cron that flipped status would fail OPEN when
-- the job failed, selling slots the organizer believes are closed.
alter table events
  add column registration_closes_at timestamptz,
  add column kit_edit_closes_at     timestamptz;

comment on column events.registration_closes_at is
  'Absolute instant after which new registrations are refused. NULL = no deadline.';
comment on column events.kit_edit_closes_at is
  'Absolute instant after which runners can no longer change kit fields (shirt size). Org admins are never bound by it. NULL = no deadline.';

-- A kit cutoff earlier than the registration close would create a runner who can never
-- edit: they register on the final day into an already-frozen kit list. Make it
-- unrepresentable rather than merely validating it in the admin form.
alter table events add constraint events_kit_edit_after_reg_close check (
  kit_edit_closes_at is null or registration_closes_at is null
  or kit_edit_closes_at >= registration_closes_at
);
```

- [ ] **Step 4: Apply the migration and run the tests**

Run: `pnpm supabase db push` then `pnpm vitest run supabase/tests/event-deadlines.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808100000_event_deadlines.sql supabase/tests/event-deadlines.test.ts
git commit -m "feat(db): add registration and kit-edit deadline columns to events"
```

---

### Task 2: Shared field edit policy and labels

**Files:**
- Modify: `packages/shared/src/index.ts` (insert before the trailing `export * from "./route";` on line 163)
- Modify: `packages/shared/src/index.test.ts`
- Modify: `supabase/functions/_shared/validation.ts`

**Interfaces:**
- Consumes: existing `PROFILE_KEYS`, `SHIRT_SIZES`, `BLOOD_TYPES` in `packages/shared/src/index.ts:43-49`.
- Produces:
  - `KIT_KEYS: readonly ["shirt_size"]`
  - `SAFETY_KEYS: readonly ["blood_type", "emergency_contact"]`
  - `type FieldEditPolicy = "kit" | "safety" | "immutable"`
  - `fieldEditPolicy(key: string): FieldEditPolicy`

Do NOT add a `fieldLabel` here. One already ships at `apps/web/lib/field-labels.ts:35`
with acronym overrides (`city_psgc_code` → "City (PSGC)") that a naive de-slugger gets
wrong, and `RegistrationDetail.tsx` already uses it. A second implementation in shared
would be duplication with worse behaviour. Task 11 imports the existing one.

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/index.test.ts`:

```ts
import { fieldEditPolicy, KIT_KEYS, SAFETY_KEYS } from "./index";

describe("fieldEditPolicy", () => {
  it("classifies shirt_size as a kit field that freezes before printing", () => {
    expect(fieldEditPolicy("shirt_size")).toBe("kit");
  });

  it.each(["blood_type", "emergency_contact"])("keeps %s a safety field with no deadline", (k) => {
    expect(fieldEditPolicy(k)).toBe("safety");
  });

  it.each(["running_club", "category_id", "total_amount", "status", ""])(
    "treats %s as immutable",
    (k) => {
      expect(fieldEditPolicy(k)).toBe("immutable");
    },
  );

  it("keeps kit and safety key sets disjoint", () => {
    const overlap = KIT_KEYS.filter((k) => (SAFETY_KEYS as readonly string[]).includes(k));
    expect(overlap).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/shared/src/index.test.ts`
Expected: FAIL — `fieldEditPolicy is not a function`.

- [ ] **Step 3: Implement in the canonical package**

In `packages/shared/src/index.ts`, insert immediately before the final line `export * from "./route";`:

```ts
/** Which registration fields a runner may change AFTER checkout, and when they freeze.
 *
 *  Kit fields freeze at the event's `kit_edit_closes_at` so shirts can be printed and
 *  packed against a stable roster. Safety fields NEVER freeze — stale emergency-contact
 *  data is worse than none, and there is no operational benefit to locking it. Everything
 *  else is immutable through the edit path, including category_id, total_amount, status,
 *  and organizer-defined questions like running_club.
 *
 *  KEEP IN SYNC with supabase/functions/_shared/validation.ts and the CASE expression in
 *  update_registration_fields_tx. Only the SQL copy is load-bearing: this one decides what
 *  renders as editable, so drift shows up as the RPC refusing an edit the UI offered, never
 *  as an unauthorized write. */
export const KIT_KEYS = ["shirt_size"] as const;
export const SAFETY_KEYS = ["blood_type", "emergency_contact"] as const;
export type FieldEditPolicy = "kit" | "safety" | "immutable";

export function fieldEditPolicy(key: string): FieldEditPolicy {
  if ((KIT_KEYS as readonly string[]).includes(key)) return "kit";
  if ((SAFETY_KEYS as readonly string[]).includes(key)) return "safety";
  return "immutable";
}
```

- [ ] **Step 4: Mirror into the Deno copy**

Append to `supabase/functions/_shared/validation.ts`:

```ts
/** Mirrors packages/shared/src/index.ts — see the note at the top of this file for why
 *  this is a copy rather than an import. */
export const KIT_KEYS = ["shirt_size"] as const;
export const SAFETY_KEYS = ["blood_type", "emergency_contact"] as const;
export type FieldEditPolicy = "kit" | "safety" | "immutable";

export function fieldEditPolicy(key: string): FieldEditPolicy {
  if ((KIT_KEYS as readonly string[]).includes(key)) return "kit";
  if ((SAFETY_KEYS as readonly string[]).includes(key)) return "safety";
  return "immutable";
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm vitest run packages/shared/src/index.test.ts && pnpm typecheck`
Expected: PASS, all new tests green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts supabase/functions/_shared/validation.ts
git commit -m "feat(shared): classify registration fields as kit, safety, or immutable"
```

---

### Task 3: The registration_audit table

**Files:**
- Create: `supabase/migrations/20260808100100_registration_audit.sql`
- Create: `supabase/tests/registration-audit.test.ts`

**Interfaces:**
- Consumes: `registrations`, `organizations`, `events`, and `auth_can_admin_org(uuid)` from `supabase/migrations/20260720150000_user_roles.sql:27`.
- Produces: table `registration_audit` with columns `id, registration_id, org_id, event_id, action, detail, actor_id, actor_role, created_at`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/registration-audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function fixture(tag: string) {
  const s = svc();
  const email = `audit_${tag}_${Date.now()}@test.dev`;
  const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
  const org = (await s.from("organizations").insert({ name: "Audit Org", slug: `au-${tag}-${Date.now()}` }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "Audit Race", status: "open" }).select().single()).data!;
  const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
  const reg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid, total_amount: 100000, status: "paid", custom_data: { shirt_size: "M" } }).select().single()).data!;
  return { s, uid, email, org, ev, reg };
}

async function cleanup(s: ReturnType<typeof svc>, orgId: string, uid: string) {
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

describe("registration_audit", () => {
  it("stores an append-only row with actor and jsonb detail", async () => {
    const { s, uid, org, ev, reg } = await fixture("shape");
    const { data, error } = await s.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "field_changed", detail: { field: "shirt_size", from: "M", to: "L" },
      actor_id: uid, actor_role: "runner",
    }).select().single();
    expect(error).toBeNull();
    expect(data!.detail).toEqual({ field: "shirt_size", from: "M", to: "L" });
    expect(data!.created_at).toBeTruthy();
    await cleanup(s, org.id, uid);
  });

  it("lets the owning runner read their own rows but not insert", async () => {
    const { s, uid, email, org, ev, reg } = await fixture("rls");
    await s.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "field_changed", detail: { field: "shirt_size", from: "M", to: "L" },
      actor_id: uid, actor_role: "runner",
    });

    const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
    await asUser.auth.signInWithPassword({ email, password: "password123" });

    const read = await asUser.from("registration_audit").select("*").eq("registration_id", reg.id);
    expect(read.error).toBeNull();
    expect(read.data!.length).toBe(1);

    const write = await asUser.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "field_changed", detail: {}, actor_id: uid, actor_role: "runner",
    });
    expect(write.error).not.toBeNull();

    await cleanup(s, org.id, uid);
  });

  it("cascades away when the registration is deleted", async () => {
    const { s, uid, org, ev, reg } = await fixture("cascade");
    await s.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "paid", detail: {}, actor_role: "system",
    });
    await s.from("registrations").delete().eq("id", reg.id);
    const rows = await s.from("registration_audit").select("id").eq("registration_id", reg.id);
    expect(rows.data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run supabase/tests/registration-audit.test.ts`
Expected: FAIL — `relation "public.registration_audit" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260808100100_registration_audit.sql`:

```sql
-- Append-only timeline of everything notable that happens to a registration. Structure,
-- RLS shape, and trigger/definer-only write discipline follow `notifications`
-- (20260723090000_notifications_table.sql): clients read, nothing but security-definer
-- code writes.
--
-- `action` is text, not an enum, so the kit-release spec can add 'kit_released' without a
-- type migration. Values used today: 'field_changed', 'paid', 'refunded'.
create table registration_audit (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  action          text not null,
  detail          jsonb not null default '{}'::jsonb,  -- field_changed: { field, from, to }
  actor_id        uuid references auth.users(id) on delete set null,
  actor_role      text,                                -- 'runner' | 'admin' | 'system'
  created_at      timestamptz not null default now()
);

create index registration_audit_reg_idx on registration_audit (registration_id, created_at desc);

alter table registration_audit enable row level security;

-- Read-own mirrors registrations_read_own (20260718183018_registrations_payments.sql:19).
create policy "registration_audit_read_own" on registration_audit
  for select using (
    exists (
      select 1 from registrations r
      where r.id = registration_audit.registration_id and r.user_id = auth.uid()
    )
  );

create policy "registration_audit_read_org_admin" on registration_audit
  for select using (auth_can_admin_org(org_id));

-- No insert/update/delete grant to any client role. Rows arrive only through
-- security-definer functions, so the log cannot be forged or rewritten from a browser.
grant select on registration_audit to authenticated;
grant all    on registration_audit to service_role;
```

- [ ] **Step 4: Apply and run the tests**

Run: `pnpm supabase db push` then `pnpm vitest run supabase/tests/registration-audit.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808100100_registration_audit.sql supabase/tests/registration-audit.test.ts
git commit -m "feat(db): add append-only registration_audit table"
```

---

### Task 4: The field-edit RPC

**Files:**
- Create: `supabase/migrations/20260808100200_update_registration_fields_tx.sql`
- Create: `supabase/tests/registration-fields-edit.test.ts`

**Interfaces:**
- Consumes: `registration_audit` (Task 3), `events.kit_edit_closes_at` (Task 1), `auth_can_admin_org(uuid)`.
- Produces: `public.update_registration_fields_tx(p_registration_id uuid, p_changes jsonb) returns text`, returning one of `ok`, `not_found`, `forbidden`, `not_editable`, `locked`, `invalid_value`, `no_change`. Granted to `authenticated`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/registration-fields-edit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

/** kitClosesAt null = no kit deadline. Registration always starts paid with shirt M. */
async function fixture(tag: string, kitClosesAt: string | null) {
  const s = svc();
  const stamp = `${tag}_${Date.now()}`;
  const email = `edit_${stamp}@test.dev`;
  const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
  const org = (await s.from("organizations").insert({ name: "Edit Org", slug: `ed-${stamp}` }).select().single()).data!;
  const ev = (await s.from("events").insert({
    org_id: org.id, name: "Edit Race", status: "open", kit_edit_closes_at: kitClosesAt,
  }).select().single()).data!;
  const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
  const reg = (await s.from("registrations").insert({
    org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid,
    total_amount: 100000, status: "paid", custom_data: { shirt_size: "M", running_club: "Malaybalay" },
  }).select().single()).data!;
  return { s, uid, email, org, ev, reg };
}

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: "password123" });
  return c;
}

async function cleanup(s: ReturnType<typeof svc>, orgId: string, uid: string) {
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

const call = (c: SupabaseClient, rid: string, changes: Record<string, unknown>) =>
  c.rpc("update_registration_fields_tx", { p_registration_id: rid, p_changes: changes });

describe("update_registration_fields_tx", () => {
  it("lets the owner change a kit field before the cutoff and writes one audit row", async () => {
    const { s, uid, email, org, reg } = await fixture("before", FUTURE);
    const c = await signedIn(email);
    const r = await call(c, reg.id, { shirt_size: "L" });
    expect(r.data).toBe("ok");

    const row = (await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!;
    expect(row.custom_data.shirt_size).toBe("L");
    expect(row.custom_data.running_club).toBe("Malaybalay");

    const audit = (await s.from("registration_audit").select("*").eq("registration_id", reg.id)).data!;
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe("field_changed");
    expect(audit[0].detail).toEqual({ field: "shirt_size", from: "M", to: "L" });
    expect(audit[0].actor_role).toBe("runner");
    expect(audit[0].actor_id).toBe(uid);
    await cleanup(s, org.id, uid);
  });

  it("refuses a kit change after the cutoff and writes nothing", async () => {
    const { s, uid, email, org, reg } = await fixture("after", PAST);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("locked");

    const row = (await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!;
    expect(row.custom_data.shirt_size).toBe("M");
    expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });

  it("treats a null kit cutoff as no deadline", async () => {
    const { s, uid, email, org, reg } = await fixture("nulldl", null);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "XL" })).data).toBe("ok");
    await cleanup(s, org.id, uid);
  });

  it("lets an org admin change a kit field after the cutoff, recorded as admin", async () => {
    const { s, uid, org, reg } = await fixture("admin", PAST);
    const adminEmail = `edit_admin_${Date.now()}@test.dev`;
    const adminUid = (await s.auth.admin.createUser({ email: adminEmail, password: "password123", email_confirm: true })).data.user!.id;
    await s.from("user_roles").insert({ user_id: adminUid, role: "admin", org_id: org.id });

    const c = await signedIn(adminEmail);
    expect((await call(c, reg.id, { shirt_size: "S" })).data).toBe("ok");

    const audit = (await s.from("registration_audit").select("*").eq("registration_id", reg.id)).data!;
    expect(audit[0].actor_role).toBe("admin");
    expect(audit[0].actor_id).toBe(adminUid);

    await s.auth.admin.deleteUser(adminUid);
    await cleanup(s, org.id, uid);
  });

  it("refuses a signed-in stranger editing someone else's registration", async () => {
    const { s, uid, org, reg } = await fixture("stranger", FUTURE);
    const otherEmail = `edit_other_${Date.now()}@test.dev`;
    const otherUid = (await s.auth.admin.createUser({ email: otherEmail, password: "password123", email_confirm: true })).data.user!.id;

    const c = await signedIn(otherEmail);
    expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("forbidden");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");

    await s.auth.admin.deleteUser(otherUid);
    await cleanup(s, org.id, uid);
  });

  it("keeps safety fields editable after the kit cutoff", async () => {
    const { s, uid, email, org, reg } = await fixture("safety", PAST);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { blood_type: "B-" })).data).toBe("ok");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.blood_type).toBe("B-");
    await cleanup(s, org.id, uid);
  });

  it("rejects an immutable key and writes nothing", async () => {
    const { s, uid, email, org, reg } = await fixture("immutable", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { running_club: "Other Club" })).data).toBe("invalid_value");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.running_club).toBe("Malaybalay");
    await cleanup(s, org.id, uid);
  });

  it("rejects a shirt size outside the canonical list", async () => {
    const { s, uid, email, org, reg } = await fixture("badsize", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "XXXL" })).data).toBe("invalid_value");
    await cleanup(s, org.id, uid);
  });

  it("writes nothing at all when one key in a batch is invalid", async () => {
    const { s, uid, email, org, reg } = await fixture("mixed", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L", running_club: "Other" })).data).toBe("invalid_value");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");
    expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });

  it("writes one audit row per changed field", async () => {
    const { s, uid, email, org, reg } = await fixture("two", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L", blood_type: "O+" })).data).toBe("ok");
    const audit = (await s.from("registration_audit").select("detail").eq("registration_id", reg.id)).data!;
    expect(audit.length).toBe(2);
    await cleanup(s, org.id, uid);
  });

  it("returns no_change and writes no audit row when the value is unchanged", async () => {
    const { s, uid, email, org, reg } = await fixture("same", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "M" })).data).toBe("no_change");
    expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });

  it("records a null `from` when the field had no previous value", async () => {
    const { s, uid, email, org, reg } = await fixture("newfield", FUTURE);
    const c = await signedIn(email);
    await call(c, reg.id, { blood_type: "A+" });
    const audit = (await s.from("registration_audit").select("detail").eq("registration_id", reg.id)).data!;
    expect(audit[0].detail).toEqual({ field: "blood_type", from: null, to: "A+" });
    await cleanup(s, org.id, uid);
  });

  it("refuses to edit a refunded registration", async () => {
    const { s, uid, email, org, reg } = await fixture("refunded", FUTURE);
    await s.from("registrations").update({ status: "refunded" }).eq("id", reg.id);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("not_editable");
    await cleanup(s, org.id, uid);
  });

  it("returns not_found for an unknown registration", async () => {
    const { s, uid, email, org } = await fixture("missing", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, "00000000-0000-0000-0000-0000000000ff", { shirt_size: "L" })).data).toBe("not_found");
    await cleanup(s, org.id, uid);
  });

  it("refuses an anonymous caller", async () => {
    const { s, uid, org, reg } = await fixture("anon", FUTURE);
    const c = createClient(url, anonKey, { auth: { persistSession: false } });
    const r = await call(c, reg.id, { shirt_size: "L" });
    expect(r.data === "forbidden" || r.error !== null).toBe(true);
    await cleanup(s, org.id, uid);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run supabase/tests/registration-fields-edit.test.ts`
Expected: FAIL — `Could not find the function public.update_registration_fields_tx`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260808100200_update_registration_fields_tx.sql`:

```sql
-- The single write path for post-checkout registration field edits.
--
-- Takes NO actor parameter on purpose. This function is granted to `authenticated` and
-- called straight from the browser, so an actor argument would be a privilege-escalation
-- hole: any signed-in user could pass another runner's uid and edit that runner's row.
-- Identity comes from the JWT via auth.uid(), never from an argument.
--
-- Authorization lives inside the function rather than in RLS because RLS is row-level and
-- cannot express "you may write this JSONB key but not total_amount" — the same reasoning
-- as 20260806150000_checkin_rpcs.sql.
--
-- The field classification below mirrors KIT_KEYS/SAFETY_KEYS in packages/shared and
-- supabase/functions/_shared/validation.ts. This SQL copy is the load-bearing one.
create or replace function public.update_registration_fields_tx(
  p_registration_id uuid,
  p_changes         jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_reg        public.registrations%rowtype;
  v_is_admin   boolean;
  v_kit_closes timestamptz;
  v_key        text;
  v_new        text;
  v_policy     text;
  v_changed    jsonb := '{}'::jsonb;
  v_role       text;
begin
  if v_actor is null then return 'forbidden'; end if;

  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;

  v_is_admin := public.auth_can_admin_org(v_reg.org_id);
  if v_reg.user_id <> v_actor and not v_is_admin then return 'forbidden'; end if;

  -- refunded / cancelled registrations are settled; nothing about them may change.
  if v_reg.status not in ('pending', 'paid') then return 'not_editable'; end if;

  select kit_edit_closes_at into v_kit_closes from public.events where id = v_reg.event_id;

  -- Validation pass. Any rejection returns before a single write, so a batch containing
  -- one bad key changes nothing.
  for v_key, v_new in select key, value #>> '{}' from jsonb_each(p_changes) loop
    v_policy := case
      when v_key = 'shirt_size' then 'kit'
      when v_key in ('blood_type', 'emergency_contact') then 'safety'
      else 'immutable'
    end;

    if v_policy = 'immutable' then return 'invalid_value'; end if;

    -- Org admins are never deadline-bound; every admin edit is recorded below, which is
    -- what makes the override safe to grant.
    if v_policy = 'kit' and not v_is_admin
       and v_kit_closes is not null and v_kit_closes < now() then
      return 'locked';
    end if;

    if v_key = 'shirt_size'
       and v_new not in ('XS', 'S', 'M', 'L', 'XL', 'XXL') then
      return 'invalid_value';
    end if;
    if v_key = 'blood_type'
       and v_new not in ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Unknown') then
      return 'invalid_value';
    end if;

    if (v_reg.custom_data #>> array[v_key]) is distinct from v_new then
      v_changed := v_changed || public.jsonb_build_object(v_key, v_new);
    end if;
  end loop;

  if v_changed = '{}'::jsonb then return 'no_change'; end if;

  update public.registrations
     set custom_data = coalesce(custom_data, '{}'::jsonb) || v_changed
   where id = p_registration_id;

  v_role := case when v_is_admin then 'admin' else 'runner' end;

  -- One row per changed field. v_reg holds the pre-update snapshot, so `from` is the old
  -- value even though registrations has already been updated.
  for v_key, v_new in select key, value #>> '{}' from jsonb_each(v_changed) loop
    insert into public.registration_audit
      (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
    values (
      p_registration_id, v_reg.org_id, v_reg.event_id, 'field_changed',
      jsonb_build_object('field', v_key, 'from', v_reg.custom_data #>> array[v_key], 'to', v_new),
      v_actor, v_role
    );
  end loop;

  return 'ok';
end;
$$;

revoke all on function public.update_registration_fields_tx(uuid, jsonb) from public;
grant execute on function public.update_registration_fields_tx(uuid, jsonb) to authenticated;
```

Note: if `public.jsonb_build_object` errors as unknown under `search_path = ''`, use the
unqualified `jsonb_build_object` — it lives in `pg_catalog`, which is always on the path.
Apply the same to the `insert` above if needed.

- [ ] **Step 4: Apply and run the tests**

Run: `pnpm supabase db push` then `pnpm vitest run supabase/tests/registration-fields-edit.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808100200_update_registration_fields_tx.sql supabase/tests/registration-fields-edit.test.ts
git commit -m "feat(db): add update_registration_fields_tx with deadline and audit"
```

---

### Task 5: Audit rows from the money RPCs

**Files:**
- Create: `supabase/migrations/20260808120000_money_txn_audit.sql`
- Modify: `supabase/tests/money-txn.test.ts`

**Interfaces:**
- Consumes: `registration_audit` (Task 3), and the **live** definitions of `confirm_payment_tx` and `refund_registration_tx`.
- Produces: no signature change whatsoever. `confirm_payment_tx` additionally writes a `paid` audit row; `refund_registration_tx` writes a `refunded` audit row with `actor_id = p_refunded_by`.

> ## ⚠️ Read this before writing any SQL — it is a security trap
>
> **Do not copy function bodies from anywhere in this plan or from
> `supabase/migrations/20260723100000_money_txn_rpcs.sql`. Both are stale.**
>
> `refund_registration_tx` was replaced by `supabase/migrations/20260807090400_refund_policy_tx.sql`
> and now takes **seven** arguments, with partial-refund and retained-fee logic the older
> body does not have:
> ```
> p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb,
> p_refunded_amount integer, p_retained_fee integer, p_retained_net integer
> ```
>
> `create or replace function` matches on the **argument signature**. Emitting the old
> four-argument version would not replace anything — it would create a *second*,
> differently-signed function alongside the real one. That new function would be created
> with Supabase's default privileges, which grant `EXECUTE` to `anon` and `authenticated`,
> **re-opening the exact vulnerability that `20260808110000_lock_down_function_grants.sql`
> just closed** (an anonymous caller could mark registrations refunded). It would also
> silently drop the partial-refund logic on whichever version callers resolved to.
>
> **Therefore: derive both bodies from the live database, not from this document.**
> Run `select pg_get_functiondef(oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
> where n.nspname='public' and p.proname in ('confirm_payment_tx','refund_registration_tx');`
> and use exactly what it returns as your starting point. Change one thing in each body:
> add the `insert into public.registration_audit` shown below, immediately before the
> function's final `return`. Change nothing else — not the signature, not the argument names,
> not the existing logic, not `security definer`, not `set search_path`.
>
> After the two `create or replace` statements, re-assert the lockdown explicitly:
> ```sql
> revoke execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb)
>   from anon, authenticated;
> revoke execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int)
>   from anon, authenticated;
> ```
> `create or replace` does preserve existing privileges, so this is belt-and-braces — but
> given what these two functions do, assert it rather than assume it. Verify the signatures
> against `pg_get_function_identity_arguments` before writing them.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/money-txn.test.ts`, inside the existing top-level scope:

```ts
describe("money RPCs write to registration_audit", () => {
  it("records a paid row on confirm and a refunded row on refund", async () => {
    const { s, uid, org, reg } = await fixture("audit");

    await s.rpc("confirm_payment_tx", {
      p_registration_id: reg.id, p_method: "gcash", p_fee: 10000,
      p_net: 90000, p_token: "tok.sig", p_raw: {},
    });

    const afterPaid = (await s.from("registration_audit").select("*").eq("registration_id", reg.id)).data!;
    expect(afterPaid.length).toBe(1);
    expect(afterPaid[0].action).toBe("paid");
    expect(afterPaid[0].actor_role).toBe("system");

    // Seven arguments — the four-arg form in older migrations was superseded by
    // 20260807090400_refund_policy_tx.sql. Confirm the live parameter names and order with
    // pg_get_function_identity_arguments before writing this call; a wrong arg list fails
    // as "function does not exist", which reads like a missing migration.
    await s.rpc("refund_registration_tx", {
      p_registration_id: reg.id, p_refunded_by: uid, p_note: "duplicate entry",
      p_provider_refund: {}, p_refunded_amount: 100000, p_retained_fee: 0, p_retained_net: 0,
    });

    const afterRefund = (await s.from("registration_audit").select("*").eq("registration_id", reg.id).order("created_at", { ascending: true })).data!;
    expect(afterRefund.length).toBe(2);
    expect(afterRefund[1].action).toBe("refunded");
    expect(afterRefund[1].actor_id).toBe(uid);
    expect(afterRefund[1].detail.note).toBe("duplicate entry");

    await cleanup(s, org.id, reg.id, uid);
  });

  it("does not write an audit row when confirm is a replayed no-op", async () => {
    const { s, uid, org, reg } = await fixture("auditreplay");
    const args = { p_registration_id: reg.id, p_method: "gcash", p_fee: 0, p_net: 0, p_token: "t", p_raw: {} };
    await s.rpc("confirm_payment_tx", args);
    await s.rpc("confirm_payment_tx", args);
    const rows = (await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!;
    expect(rows.length).toBe(1);
    await cleanup(s, org.id, reg.id, uid);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run supabase/tests/money-txn.test.ts`
Expected: FAIL — `expected 0 to be 1` on the audit row count. Existing tests in the file must still pass.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260808120000_money_txn_audit.sql`.

**Do not write the bodies from memory or from this plan.** Follow the trap warning at the top
of this task. Concretely:

1. Get the live definitions:
   ```bash
   pnpm exec supabase db query "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('confirm_payment_tx','refund_registration_tx')" --linked
   ```
2. Paste each returned definition into the migration unchanged.
3. In `confirm_payment_tx`, declare whatever locals you need for the audit row and add this
   immediately before its final `return 'paid';`:

```sql
  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_role)
  values (p_registration_id, v_org, v_event, 'paid',
          jsonb_build_object('method', p_method, 'amount', v_amount), 'system');
```

4. In `refund_registration_tx`, add this immediately before its final `return 'refunded';`:

```sql
  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
  values (p_registration_id, v_org, v_event, 'refunded',
          jsonb_build_object('amount', v_amount, 'note', p_note), p_refunded_by, 'admin');
```

The existing bodies already `select ... into` several locals from `registrations`; extend that
existing `select` to also fetch `org_id`, `event_id`, and `total_amount` rather than adding a
second query. Keep `for update` exactly where it is — it is what makes these transitions safe.

Use unqualified `jsonb_build_object`: it lives in `pg_catalog`, which is always on the search
path, and `public.jsonb_build_object` does not exist. plpgsql resolves function names at
execution time, so a wrongly-qualified call would fail only on the happy path — after tests
that exercise error branches have already gone green.

5. End the migration with the two explicit `revoke execute ... from anon, authenticated`
   statements from the warning above, using signatures you have verified against
   `pg_get_function_identity_arguments`.

- [ ] **Step 4: Apply and run the tests**

Run: `pnpm supabase db push` then `pnpm vitest run supabase/tests/money-txn.test.ts`
Expected: PASS — the two new tests plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260808120000_money_txn_audit.sql supabase/tests/money-txn.test.ts
git commit -m "feat(db): write paid and refunded rows to the registration timeline"
```

---

### Task 6: Server-side registration-close enforcement

**Files:**
- Modify: `supabase/functions/_shared/eventStatus.ts`
- Modify: `supabase/functions/registrations-checkout/index.ts:37-40`
- Modify: `supabase/tests/event-deadlines.test.ts`

**Interfaces:**
- Consumes: `events.registration_closes_at` (Task 1).
- Produces: `isRegistrationClosed(status: string, registrationClosesAt: string | null): boolean` in the Deno copy. The second parameter is **required** so the compiler forces every call site to make a conscious decision.

- [ ] **Step 1: Write the failing test**

Append to `supabase/tests/event-deadlines.test.ts`:

```ts
describe("checkout enforces registration_closes_at", () => {
  it("refuses a registration for an event whose deadline has passed", async () => {
    const { s, o } = await org("checkout");
    const email = `dlco_${Date.now()}@test.dev`;
    const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
    const ev = (await s.from("events").insert({
      org_id: o.id, name: "Closed Race", status: "open",
      registration_closes_at: "2020-01-01T00:00:00Z",
    }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: o.id, event_id: ev.id, code: "10k", label: "10K",
      base_price: 100000, slots_total: 50, slots_taken: 0,
    }).select().single()).data!;

    const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
    const session = await asUser.auth.signInWithPassword({ email, password: "password123" });
    const jwt = session.data.session!.access_token;

    const res = await fetch(`${url}/functions/v1/registrations-checkout`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        event_id: ev.id, category_id: cat.id, addon_ids: [],
        custom_data: {}, waiver_accepted: true, idempotency_key: `dl-${Date.now()}`,
      }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("registration_closed");

    await s.from("organizations").delete().eq("id", o.id);
    await s.auth.admin.deleteUser(uid);
  });
});
```

Add `anonKey` to the existing destructure at the top of the file: `const { url, anonKey, serviceKey } = loadEnv();`

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run supabase/tests/event-deadlines.test.ts`
Expected: FAIL — the checkout returns 200 and creates a registration, because the deadline is not consulted.

- [ ] **Step 3: Make the Deno rule deadline-aware**

Replace the whole of `supabase/functions/_shared/eventStatus.ts`:

```ts
/** Mirrors apps/site/lib/eventStatus.ts's `isRegistrationClosed` (and
 *  apps/mobile/app/event/[id].tsx's `registerable` rule, inverted).
 *  `almost_full` is NOT closed — it's still registerable, just tight on
 *  slots. Only these three terminal/blocked statuses stop registration.
 *  Kept in sync by hand across site/mobile/functions; do not derive one
 *  from another.
 *
 *  This is the authoritative check: registrations-checkout must reject a
 *  closed event's registration server-side, since the page-level check is
 *  only a UX nicety and can be bypassed by a direct request.
 *
 *  `registrationClosesAt` is REQUIRED rather than optional so that adding a
 *  call site cannot silently skip the deadline — the compiler forces the
 *  decision. Pass null where the event genuinely has no deadline loaded.
 *  A closed status always wins regardless of the date. */
export function isRegistrationClosed(
  status: string,
  registrationClosesAt: string | null,
): boolean {
  if (["cancelled", "closed", "completed"].includes(status)) return true;
  if (!registrationClosesAt) return false;
  return new Date(registrationClosesAt).getTime() <= Date.now();
}
```

- [ ] **Step 4: Pass the deadline at the checkout boundary**

In `supabase/functions/registrations-checkout/index.ts`, change the event lookup (currently
lines 37-40) to select the column and pass it:

```ts
    const { data: event } = await db
      .from("events")
      .select("status, registration_closes_at")
      .eq("id", category.event_id)
      .single();
    if (!event) return json({ error: "category_not_found" }, 404);
    if (isRegistrationClosed(event.status, event.registration_closes_at)) {
      return json({ error: "registration_closed" }, 409);
    }
```

- [ ] **Step 5: Deploy the function and run the tests**

Run: `pnpm supabase functions deploy registrations-checkout` then
`pnpm vitest run supabase/tests/event-deadlines.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/eventStatus.ts supabase/functions/registrations-checkout/index.ts supabase/tests/event-deadlines.test.ts
git commit -m "feat(functions): reject checkout after an event's registration deadline"
```

---

### Task 7: Site-side registration-close rendering

**Files:**
- Modify: `apps/site/lib/eventStatus.ts`
- Modify: `apps/site/lib/__tests__/eventStatus.test.ts`
- Modify: `apps/site/lib/events.ts`, `apps/site/lib/home.ts`, `apps/site/lib/registration.ts`
- Modify: `apps/site/app/page.tsx:61,63`, `app/events/[id]/page.tsx:50`, `app/register/[categoryId]/page.tsx:31`, `app/pay/[registrationId]/page.tsx:34`, `app/pay/[registrationId]/PayPanel.tsx:45,75`

**Interfaces:**
- Consumes: `events.registration_closes_at` (Task 1).
- Produces: `isRegistrationClosed(status: string, registrationClosesAt: string | null): boolean` — same signature as the Deno copy in Task 6. Every event-shaped type in `apps/site/lib/events.ts` gains `registration_closes_at: string | null`.

- [ ] **Step 1: Write the failing test**

Replace the body of `apps/site/lib/__tests__/eventStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isRegistrationClosed } from "../eventStatus";

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

describe("isRegistrationClosed", () => {
  it("keeps almost_full open — it is still registerable, just tight on slots", () => {
    expect(isRegistrationClosed("almost_full", null)).toBe(false);
  });

  it("keeps open registerable", () => {
    expect(isRegistrationClosed("open", null)).toBe(false);
  });

  it.each(["cancelled", "closed", "completed"])("closes registration for %s", (status) => {
    expect(isRegistrationClosed(status, null)).toBe(true);
  });

  it("does not close registration for draft (draft events aren't visible via RLS anyway)", () => {
    expect(isRegistrationClosed("draft", null)).toBe(false);
  });

  it("stays open when the deadline is still ahead", () => {
    expect(isRegistrationClosed("open", FUTURE)).toBe(false);
  });

  it("closes once the deadline has passed", () => {
    expect(isRegistrationClosed("open", PAST)).toBe(true);
  });

  it("treats a null deadline as no deadline", () => {
    expect(isRegistrationClosed("open", null)).toBe(false);
  });

  it("lets a closed status win even with a deadline in the future", () => {
    expect(isRegistrationClosed("cancelled", FUTURE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter site test lib/__tests__/eventStatus.test.ts`
Expected: FAIL — the two deadline cases return false; TypeScript also flags the extra argument.

- [ ] **Step 3: Update the rule**

Replace the whole of `apps/site/lib/eventStatus.ts`:

```ts
/** Mirrors apps/mobile/app/event/[id].tsx's `registerable` rule (inverted) and
 *  supabase/functions/_shared/eventStatus.ts, which is the authoritative
 *  server-side copy. `almost_full` is NOT closed — it's still registerable,
 *  just tight on slots. Only these three terminal/blocked statuses stop
 *  registration outright.
 *  Keep this in sync by hand; do not derive one from the other.
 *
 *  `registrationClosesAt` is REQUIRED, not optional, so a new call site cannot
 *  silently skip the deadline — the compiler forces the decision. Pass null
 *  where the event genuinely has no deadline loaded. A closed status always
 *  wins regardless of the date, since it is the organizer's manual override. */
export function isRegistrationClosed(
  status: string,
  registrationClosesAt: string | null,
): boolean {
  if (["cancelled", "closed", "completed"].includes(status)) return true;
  if (!registrationClosesAt) return false;
  return new Date(registrationClosesAt).getTime() <= Date.now();
}
```

- [ ] **Step 4: Run the site typecheck to enumerate every call site**

Run: `pnpm --filter site typecheck`
Expected: errors at exactly these six files — `lib/home.ts:21`, `app/page.tsx:61`,
`app/page.tsx:63`, `app/events/[id]/page.tsx:50`, `app/register/[categoryId]/page.tsx:31`,
`app/pay/[registrationId]/page.tsx:34`, `app/pay/[registrationId]/PayPanel.tsx:45`,
`app/pay/[registrationId]/PayPanel.tsx:75`. Use this list as the checklist for step 5.

- [ ] **Step 5: Select the column and pass it at every call site**

In `apps/site/lib/events.ts`, add `registration_closes_at` to every `select(...)` string that
fetches events, and add `registration_closes_at: string | null` to the exported event types.
In `apps/site/lib/registration.ts`, add `events(registration_closes_at)` to `REG_SELECT` and
map it in `mapReg` as `eventRegistrationClosesAt: r.events?.registration_closes_at ?? null`.

Then update each call site:

```ts
// apps/site/lib/home.ts:21
const registerable = events.filter((e) => !isRegistrationClosed(e.status, e.registration_closes_at));

// apps/site/app/page.tsx:61,63
const open = events.filter((e) => !isRegistrationClosed(e.status, e.registration_closes_at) && !ongoingIds.has(e.id));
const closed = events.filter(
  (e) => isRegistrationClosed(e.status, e.registration_closes_at) && !ongoingIds.has(e.id),
);

// apps/site/app/events/[id]/page.tsx:50
const closed = isRegistrationClosed(event.status, event.registration_closes_at);

// apps/site/app/register/[categoryId]/page.tsx:31
if (isRegistrationClosed(event.status, event.registration_closes_at)) {

// apps/site/app/pay/[registrationId]/page.tsx:34
if (eventStatus && isRegistrationClosed(eventStatus, eventRegistrationClosesAt)) {

// apps/site/app/pay/[registrationId]/PayPanel.tsx:45
const eventClosed = isRegistrationClosed(reg.data.eventStatus ?? "", reg.data.eventRegistrationClosesAt);

// apps/site/app/pay/[registrationId]/PayPanel.tsx:75
const url = scoped ?? (isRegistrationClosed(reg.data!.eventStatus ?? "", reg.data!.eventRegistrationClosesAt) ? null : reg.data!.checkoutUrl);
```

For `app/pay/[registrationId]/page.tsx`, the server component must also select
`registration_closes_at` alongside the existing `eventStatus` lookup and pass it down.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter site test && pnpm --filter site typecheck`
Expected: PASS, zero type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/site/lib apps/site/app
git commit -m "feat(site): close registration by date as well as status"
```

---

### Task 8: Admin event editor deadline inputs

> `apps/web` is a **Next.js** app (App Router, server actions). Tests live beside the file
> they cover as `foo.test.tsx`, never in `__tests__/`. Run them with `pnpm --filter web test`.

**Files:**
- Create: `apps/web/lib/deadlines.ts`
- Create: `apps/web/lib/deadlines.test.ts`
- Modify: `apps/web/lib/actions/events.ts` — the `EventDraft` type and the `EVENT_COLS` whitelist
- Modify: `apps/web/lib/queries/event-editor.ts` — the `EditorEvent` type (line 5) and the `EVENT_SELECT` column string (line 24)
- Modify: `apps/web/app/(admin)/events/event-editor-form.tsx` — `blankDraft()` and the date grid
- Modify: `apps/web/app/(admin)/events/event-editor-form.test.tsx`

**Interfaces:**
- Consumes: `events.registration_closes_at`, `events.kit_edit_closes_at` (Task 1).
- Produces:
  - `EventDraft` and `EditorEvent` both gain `registration_closes_at: string | null` and `kit_edit_closes_at: string | null`, stored as ISO-8601 UTC strings.
  - `toLocalInput(iso: string | null): string` and `fromLocalInput(local: string): string | null`, exported from the new `apps/web/lib/deadlines.ts`.

**Critical:** the admin app does not spread the draft into the save — `EVENT_COLS` in
`apps/web/lib/actions/events.ts` builds the payload field by field, and `EVENT_SELECT` in
`apps/web/lib/queries/event-editor.ts` lists read columns as a string. A new column added to
the form but missed in either place will silently fail to save or silently fail to load, with
no type error. Both lists must be updated.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/deadlines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toLocalInput, fromLocalInput } from "./deadlines";

describe("deadline input conversion", () => {
  it("round-trips a local datetime through ISO", () => {
    const iso = fromLocalInput("2026-08-25T23:59");
    expect(iso).not.toBeNull();
    expect(toLocalInput(iso)).toBe("2026-08-25T23:59");
  });

  it("treats an empty input as no deadline", () => {
    expect(fromLocalInput("")).toBeNull();
  });

  it("renders an empty string for a null deadline", () => {
    expect(toLocalInput(null)).toBe("");
  });
});
```

Append to `apps/web/app/(admin)/events/event-editor-form.test.tsx`, using the file's existing
`editorData(overrides)` fixture builder and its plain
`render(<EventEditorForm initial={...} orgId="a1" />)` call — there is no custom render
wrapper. `lastSavedEvent()` in that file pulls the last submitted FormData payload back out;
use it for the persistence test.

```tsx
describe("event deadlines", () => {
  it("offers registration close and kit edit close inputs", () => {
    render(<EventEditorForm initial={editorData({})} orgId="a1" />);
    expect(screen.getByLabelText("Registration closes")).toBeInTheDocument();
    expect(screen.getByLabelText("Kit edits close")).toBeInTheDocument();
  });

  it("warns when the kit cutoff is earlier than the registration close", () => {
    render(<EventEditorForm initial={editorData({})} orgId="a1" />);
    fireEvent.change(screen.getByLabelText("Registration closes"), { target: { value: "2026-09-06T23:59" } });
    fireEvent.change(screen.getByLabelText("Kit edits close"), { target: { value: "2026-09-01T23:59" } });
    expect(screen.getByText(/kit edits cannot close before registration/i)).toBeInTheDocument();
  });

  it("accepts a kit cutoff after the registration close", () => {
    render(<EventEditorForm initial={editorData({})} orgId="a1" />);
    fireEvent.change(screen.getByLabelText("Registration closes"), { target: { value: "2026-09-01T23:59" } });
    fireEvent.change(screen.getByLabelText("Kit edits close"), { target: { value: "2026-09-06T23:59" } });
    expect(screen.queryByText(/kit edits cannot close before registration/i)).not.toBeInTheDocument();
  });

  it("loads an existing deadline back into the input", () => {
    const iso = fromLocalInput("2026-09-01T23:59")!;
    render(<EventEditorForm initial={editorData({ registration_closes_at: iso })} orgId="a1" />);
    expect(screen.getByLabelText("Registration closes")).toHaveValue("2026-09-01T23:59");
  });
});
```

Import `fromLocalInput` from `@/lib/deadlines` at the top of that test file.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter web test lib/deadlines.test.ts "app/(admin)/events/event-editor-form.test.tsx"`
Expected: FAIL — cannot resolve `./deadlines`, and no element labelled "Registration closes".

- [ ] **Step 3: Add the conversion helpers**

Create `apps/web/lib/deadlines.ts`:

```ts
/** `datetime-local` speaks the browser's local wall clock; the column stores an absolute
 *  instant. For a Philippine organizer on a Philippine machine these agree. An organizer
 *  administering a PH race from another timezone would set the deadline in their own local
 *  time — a known limitation, called out in the form's helper text. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}
```

- [ ] **Step 4: Thread the two columns through all four lists**

All four of these must change or the column silently fails to save or load:

1. `apps/web/lib/actions/events.ts` — add to the `EventDraft` type, on the line that already
   carries `event_date: string | null; end_date: string | null; flag_off: string | null;`:
   ```ts
   registration_closes_at: string | null; kit_edit_closes_at: string | null;
   ```
2. `apps/web/lib/actions/events.ts` — add to the `EVENT_COLS` builder, beside the existing
   `event_date: e.event_date, end_date: e.end_date, flag_off: e.flag_off,`:
   ```ts
   registration_closes_at: e.registration_closes_at, kit_edit_closes_at: e.kit_edit_closes_at,
   ```
3. `apps/web/lib/queries/event-editor.ts` — add the same two fields to the `EditorEvent` type,
   and append `,registration_closes_at,kit_edit_closes_at` to the `EVENT_SELECT` string.
4. `apps/web/app/(admin)/events/event-editor-form.tsx` — add
   `registration_closes_at: null, kit_edit_closes_at: null,` to `blankDraft()`.

Also check `apps/web/lib/validation.ts`: if `eventInputSchema` validates the event payload
field-by-field, add both as nullable ISO datetime strings. If it does not enumerate
`event_date`/`flag_off`, leave it alone.

- [ ] **Step 5: Add the inputs**

In `apps/web/app/(admin)/events/event-editor-form.tsx`, add a sibling grid row immediately
after the existing `grid grid-cols-1 gap-3.5 sm:grid-cols-3` block that holds Date / End date
/ Flag-off. Match that block's idiom exactly: the `Field` component from
`@/components/form-section` (not a raw `Label`), the shared `inputCls` constant, and `set({...})`.

```tsx
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <Field label="Registration closes" hint="Leave empty to close by status only">
                <Input
                  aria-label="Registration closes"
                  type="datetime-local"
                  className={inputCls}
                  value={toLocalInput(event.registration_closes_at)}
                  onChange={(e) => set({ registration_closes_at: fromLocalInput(e.target.value) })}
                />
              </Field>
              <Field label="Kit edits close" hint="When shirt sizes freeze for printing">
                <Input
                  aria-label="Kit edits close"
                  type="datetime-local"
                  className={inputCls}
                  value={toLocalInput(event.kit_edit_closes_at)}
                  onChange={(e) => set({ kit_edit_closes_at: fromLocalInput(e.target.value) })}
                />
                {kitBeforeReg ? (
                  <p className="mt-1.5 text-[11px] text-destructive">
                    Kit edits cannot close before registration does — a runner who signs up on
                    the last day would never get to change their shirt size.
                  </p>
                ) : null}
              </Field>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Times are in {Intl.DateTimeFormat().resolvedOptions().timeZone}. Runners can still
              fix blood type and emergency contact after the kit cutoff.
            </p>
```

Add beside the component's other derived values, above the `return`:

```tsx
  const kitBeforeReg =
    !!event.registration_closes_at && !!event.kit_edit_closes_at &&
    new Date(event.kit_edit_closes_at) < new Date(event.registration_closes_at);
```

Import the helpers: `import { toLocalInput, fromLocalInput } from "@/lib/deadlines";`

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS, including every pre-existing editor test.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/deadlines.ts apps/web/lib/deadlines.test.ts apps/web/lib/actions/events.ts apps/web/lib/queries/event-editor.ts "apps/web/app/(admin)/events"
git commit -m "feat(admin): set registration and kit-edit deadlines on an event"
```

---

### Task 9: Runner race kit card

**Files:**
- Create: `apps/site/components/RaceKitCard.tsx`
- Create: `apps/site/components/__tests__/race-kit-card.test.tsx`
- Modify: `apps/site/app/ticket/[registrationId]/TicketPanel.tsx` — mount below `<TicketCard>`
- Modify: `apps/site/lib/registration.ts` — expose `shirtSize` and `kitEditClosesAt`

**Interfaces:**
- Consumes: `fieldLabel` from `@race-pace/shared` (Task 2), `events.kit_edit_closes_at` (Task 1).
- Produces: `RaceKitCard({ shirtSize, kitEditClosesAt, onChange }: { shirtSize: string | null; kitEditClosesAt: string | null; onChange: () => void })`. Also `kitEditLocked(kitEditClosesAt: string | null): boolean` and `daysUntil(iso: string): number`, both exported from `apps/site/lib/kit.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/site/components/__tests__/race-kit-card.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaceKitCard } from "../RaceKitCard";

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

describe("RaceKitCard", () => {
  it("shows the current size and a change affordance before the cutoff", () => {
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={FUTURE} onChange={vi.fn()} />);
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
  });

  it("locks after the cutoff and offers no change button", () => {
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={PAST} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /change/i })).not.toBeInTheDocument();
    expect(screen.getByText(/locked/i)).toBeInTheDocument();
  });

  it("signals the locked state with text, not colour alone", () => {
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={PAST} onChange={vi.fn()} />);
    expect(screen.getByText(/contact the organiser|contact the organizer/i)).toBeInTheDocument();
  });

  it("stays editable when the event has no kit deadline", () => {
    render(<RaceKitCard shirtSize="M" kitEditClosesAt={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
  });

  it("renders a placeholder when no size was ever chosen", () => {
    render(<RaceKitCard shirtSize={null} kitEditClosesAt={FUTURE} onChange={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
```

Create `apps/site/lib/__tests__/kit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { kitEditLocked, daysUntil } from "../kit";

describe("kitEditLocked", () => {
  it("is unlocked when there is no deadline", () => {
    expect(kitEditLocked(null)).toBe(false);
  });
  it("is unlocked before the deadline", () => {
    expect(kitEditLocked("2099-01-01T00:00:00Z")).toBe(false);
  });
  it("is locked after the deadline", () => {
    expect(kitEditLocked("2020-01-01T00:00:00Z")).toBe(true);
  });
});

describe("daysUntil", () => {
  it("counts whole days remaining, rounding up so 'today' reads as 1", () => {
    const soon = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    expect(daysUntil(soon)).toBe(2);
  });
  it("returns 0 once the instant has passed", () => {
    expect(daysUntil("2020-01-01T00:00:00Z")).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter site test components/__tests__/race-kit-card.test.tsx lib/__tests__/kit.test.ts`
Expected: FAIL — cannot resolve `../RaceKitCard` or `../kit`.

- [ ] **Step 3: Write the kit helpers**

Create `apps/site/lib/kit.ts`:

```ts
/** Kit fields freeze at the event's cutoff so shirts can be printed and packed against a
 *  stable roster. This decides what the UI RENDERS; update_registration_fields_tx decides
 *  what is actually allowed. If the two disagree the RPC wins and returns 'locked'. */
export function kitEditLocked(kitEditClosesAt: string | null): boolean {
  if (!kitEditClosesAt) return false;
  return new Date(kitEditClosesAt).getTime() <= Date.now();
}

/** Whole days remaining, rounded up: a deadline later today reads as "1 day left" rather
 *  than "0 days left", which would look like it had already passed. */
export function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}
```

- [ ] **Step 4: Write the card**

Create `apps/site/components/RaceKitCard.tsx`:

```tsx
"use client";

import { Clock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { kitEditLocked, daysUntil } from "@/lib/kit";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

/** Sits directly under the QR on the ticket page: the code the runner presents at pickup
 *  and the kit they are collecting belong together. The kit-release spec adds collection
 *  status to this same card. */
export function RaceKitCard({
  shirtSize,
  kitEditClosesAt,
  onChange,
}: {
  shirtSize: string | null;
  kitEditClosesAt: string | null;
  onChange: () => void;
}) {
  const locked = kitEditLocked(kitEditClosesAt);
  const daysLeft = kitEditClosesAt && !locked ? daysUntil(kitEditClosesAt) : null;

  return (
    <section className="no-print mt-6 rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-foreground">Race kit</h2>
        {locked ? (
          <span className="flex items-center gap-1 rounded-pill bg-amber-tint px-2.5 py-1 text-[12px] text-amber">
            <Lock size={12} aria-hidden="true" /> Locked
          </span>
        ) : daysLeft !== null ? (
          <span className="rounded-pill bg-accent-tint px-2.5 py-1 text-[12px] text-accent">
            {daysLeft} {daysLeft === 1 ? "day" : "days"} left
          </span>
        ) : null}
      </div>

      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Shirt size</p>
      <div className="flex items-baseline justify-between">
        <span className="text-[28px] font-semibold leading-none text-foreground">
          {shirtSize ?? "—"}
        </span>
        {locked ? null : (
          <Button type="button" variant="outline" className="rounded-pill" onClick={onChange}>
            Change
          </Button>
        )}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        {locked ? (
          <>
            <Lock size={12} aria-hidden="true" />
            Sizes closed{kitEditClosesAt ? ` ${fmt(kitEditClosesAt)}` : ""}. Contact the organiser to change yours.
          </>
        ) : kitEditClosesAt ? (
          <>
            <Clock size={12} aria-hidden="true" />
            Sizes lock {fmt(kitEditClosesAt)}.
          </>
        ) : (
          <>You can change your size any time before race day.</>
        )}
      </p>
    </section>
  );
}
```

- [ ] **Step 5: Expose the data**

In `apps/site/lib/registration.ts`, add `events(kit_edit_closes_at)` to `REG_SELECT` and map
in `mapReg`:

```ts
    kitEditClosesAt: r.events?.kit_edit_closes_at ?? null,
    shirtSize: (r.custom_data as Record<string, unknown> | null)?.shirt_size as string ?? null,
```

Do NOT mount the card in `TicketPanel.tsx` yet. Task 10 adds the card, the sheet, and the
state that connects them in one coherent change — mounting a Change button here would wire
it to a handler that does not exist until then.

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter site test && pnpm --filter site typecheck`
Expected: PASS, 8 new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/site/components/RaceKitCard.tsx apps/site/lib/kit.ts apps/site/lib/registration.ts apps/site/components/__tests__/race-kit-card.test.tsx apps/site/lib/__tests__/kit.test.ts
git commit -m "feat(site): add the race kit card with its lock state"
```

---

### Task 10: Runner size-change sheet

**Files:**
- Create: `apps/site/components/ShirtSizeSheet.tsx`
- Modify: `apps/site/lib/kit.ts` — add the mutation and result mapping
- Modify: `apps/site/lib/__tests__/kit.test.ts`
- Modify: `apps/site/app/ticket/[registrationId]/TicketPanel.tsx` — mount the kit card and the sheet

**Interfaces:**
- Consumes: `update_registration_fields_tx` (Task 4), `kitEditLocked` (Task 9), `SHIRT_SIZES` from `@race-pace/shared`.
- Produces:
  - `updateShirtSize(registrationId: string, size: string): Promise<KitEditResult>` where `type KitEditResult = "ok" | "locked" | "not_editable" | "no_change" | "error"`
  - `kitEditMessage(result: KitEditResult): string | null` — null for the results that need no message
  - `ShirtSizeSheet({ registrationId, current, onClose, onSaved }: { registrationId: string; current: string | null; onClose: () => void; onSaved: () => void })`

- [ ] **Step 1: Write the failing test**

Append to `apps/site/lib/__tests__/kit.test.ts`:

```ts
import { kitEditMessage } from "../kit";

describe("kitEditMessage", () => {
  it("explains a missed deadline in terms of what to do next", () => {
    expect(kitEditMessage("locked")).toMatch(/organiser|organizer/i);
  });

  it("explains a settled registration", () => {
    expect(kitEditMessage("not_editable")).toMatch(/no longer be changed/i);
  });

  it("says nothing for a successful save", () => {
    expect(kitEditMessage("ok")).toBeNull();
  });

  it("says nothing when the value did not change", () => {
    expect(kitEditMessage("no_change")).toBeNull();
  });

  it("falls back to a generic message for an unexpected failure", () => {
    expect(kitEditMessage("error")).toMatch(/couldn't|could not/i);
  });
});
```

Create the sheet test in the same file's sibling — append to
`apps/site/components/__tests__/race-kit-card.test.tsx`:

```tsx
import { fireEvent, waitFor } from "@testing-library/react";
import { ShirtSizeSheet } from "../ShirtSizeSheet";
import * as kit from "@/lib/kit";

describe("ShirtSizeSheet", () => {
  it("offers every canonical size and marks the current one pressed", () => {
    render(<ShirtSizeSheet registrationId="r1" current="L" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "XS" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "L" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves the picked size and reports success upward", async () => {
    const spy = vi.spyOn(kit, "updateShirtSize").mockResolvedValue("ok");
    const onSaved = vi.fn();
    render(<ShirtSizeSheet registrationId="r1" current="M" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "XL" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("r1", "XL"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("surfaces the deadline message instead of closing when the RPC says locked", async () => {
    vi.spyOn(kit, "updateShirtSize").mockResolvedValue("locked");
    const onSaved = vi.fn();
    render(<ShirtSizeSheet registrationId="r1" current="M" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/organiser|organizer/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter site test lib/__tests__/kit.test.ts components/__tests__/race-kit-card.test.tsx`
Expected: FAIL — `kitEditMessage is not a function`, cannot resolve `../ShirtSizeSheet`.

- [ ] **Step 3: Add the mutation and messages**

Append to `apps/site/lib/kit.ts`:

```ts
import { createClient } from "@/lib/supabase/client";

export type KitEditResult = "ok" | "locked" | "not_editable" | "no_change" | "error";

/** The RPC is the authority. The client's clock only decides what to render, so a runner
 *  who opens the page at 11:58pm and saves at 12:01am gets 'locked' here, not a silent
 *  success. Anything unrecognised collapses to 'error' rather than being trusted. */
export async function updateShirtSize(registrationId: string, size: string): Promise<KitEditResult> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("update_registration_fields_tx", {
    p_registration_id: registrationId,
    p_changes: { shirt_size: size },
  });
  if (error) return "error";
  if (data === "ok" || data === "locked" || data === "not_editable" || data === "no_change") return data;
  return "error";
}

export function kitEditMessage(result: KitEditResult): string | null {
  switch (result) {
    case "ok":
    case "no_change":
      return null;
    case "locked":
      return "Shirt sizes are closed for this race. Contact the organiser to change yours.";
    case "not_editable":
      return "This registration can no longer be changed.";
    default:
      return "We couldn't save that. Please try again.";
  }
}
```

Match the existing client import path used elsewhere in `apps/site/lib` (see
`apps/site/lib/registration.ts:108`) rather than assuming `@/lib/supabase/client`.

- [ ] **Step 4: Write the sheet**

Create `apps/site/components/ShirtSizeSheet.tsx`:

```tsx
"use client";

import { useState } from "react";
import { SHIRT_SIZES } from "@race-pace/shared";
import { Button } from "@/components/ui/button";
import { updateShirtSize, kitEditMessage, type KitEditResult } from "@/lib/kit";

export function ShirtSizeSheet({
  registrationId,
  current,
  onClose,
  onSaved,
}: {
  registrationId: string;
  current: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState(current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    if (!picked) return;
    setSaving(true);
    setMessage(null);
    const result: KitEditResult = await updateShirtSize(registrationId, picked);
    setSaving(false);
    const msg = kitEditMessage(result);
    if (msg) {
      setMessage(msg);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" role="dialog" aria-label="Change shirt size">
      <div className="w-full rounded-t-2xl bg-card p-5">
        <h2 className="text-[17px] font-semibold text-foreground">Shirt size</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Pick the size you want printed. You can change it until the organiser locks sizes.
        </p>

        {/* min-h-11 keeps every option at the 44px minimum touch target. */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {SHIRT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={picked === s}
              onClick={() => setPicked(s)}
              className={`min-h-11 rounded-xl border text-[15px] font-semibold ${
                picked === s
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {message ? (
          <p role="alert" className="mt-4 rounded-xl border border-amber bg-amber-tint px-4 py-3 text-[13px] text-foreground">
            {message}
          </p>
        ) : null}

        <div className="mt-5 flex gap-3">
          <Button type="button" variant="outline" className="flex-1 rounded-pill" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="flex-1 rounded-pill" disabled={saving || !picked} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Mount the card and the sheet on the ticket page**

In `apps/site/app/ticket/[registrationId]/TicketPanel.tsx`, add
`const [editingSize, setEditingSize] = useState(false);` next to the existing `profile`
state, import both components, and render the card immediately after the closing `/>` of
`<TicketCard ... />` (line 53):

```tsx
      <RaceKitCard
        shirtSize={reg.data.shirtSize}
        kitEditClosesAt={reg.data.kitEditClosesAt}
        onChange={() => setEditingSize(true)}
      />
```

Then render the sheet after it:

```tsx
      {editingSize ? (
        <ShirtSizeSheet
          registrationId={registrationId}
          current={reg.data.shirtSize}
          onClose={() => setEditingSize(false)}
          onSaved={() => { setEditingSize(false); reg.refetch(); }}
        />
      ) : null}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter site test && pnpm --filter site typecheck`
Expected: PASS, 8 new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/site/components/ShirtSizeSheet.tsx apps/site/lib/kit.ts apps/site/app/ticket apps/site/lib/__tests__/kit.test.ts apps/site/components/__tests__/race-kit-card.test.tsx
git commit -m "feat(site): let runners change their shirt size before the kit cutoff"
```

The ticket page now renders the kit card for the first time, so run the full site suite
rather than only the two changed test files — `TicketPanel` has existing tests that will see
the new section.

```bash
pnpm --filter site test
```

---

### Task 11: Admin history section

> `apps/web` is a **Next.js** app; tests sit beside their subject as `Foo.test.tsx`.
> `RegistrationDetail.tsx` is a **client** component that fetches on mount.

**Files:**
- Create: `apps/web/lib/audit.ts`
- Create: `apps/web/lib/audit.test.ts`
- Create: `apps/web/components/RegistrationHistory.tsx`
- Create: `apps/web/components/RegistrationHistory.test.tsx`
- Modify: `apps/web/components/RegistrationDetail.tsx` — mount the section
- Modify: `apps/web/components/RegistrationDetail.test.tsx` — its Supabase mock must branch by table

**Interfaces:**
- Consumes: `registration_audit` (Tasks 3 and 5).
- Produces:
  - `type AuditRow = { id: string; action: string; detail: Record<string, unknown>; actor_role: string | null; created_at: string }`
  - `groupByDay(rows: AuditRow[]): { day: string; rows: AuditRow[] }[]` — pure, in `lib/audit.ts`
  - `RegistrationHistory({ registrationId }: { registrationId: string })`

**Do NOT add a field-label fix.** `apps/web/lib/field-labels.ts` already exports `fieldLabel`
(with acronym overrides like `city_psgc_code` → "City (PSGC)") and `fieldValue`, and
`RegistrationDetail.tsx` already renders `custom_data` through them. Import that existing
`fieldLabel` for the history rows; do not write another.

**Do NOT use TanStack Query here.** This component fetches with a plain `useEffect` +
`useState` and the browser client — see the add-ons fetch in `RegistrationDetail.tsx`
(`createClient` from `@/lib/supabase/client`, a `cancelled` guard, and `null` meaning
not-yet-loaded versus `[]` meaning confirmed-empty). Match that idiom exactly.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/audit.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupByDay, type AuditRow } from "./audit";

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: Math.random().toString(36).slice(2), action: "field_changed",
  detail: { field: "shirt_size", from: "M", to: "L" },
  actor_role: "runner", created_at: "2026-08-08T06:22:00Z", ...over,
});

describe("groupByDay", () => {
  it("groups entries under one heading per day, newest day first", () => {
    const groups = groupByDay([
      row({ created_at: "2026-08-08T06:22:00Z" }),
      row({ created_at: "2026-08-06T01:10:00Z" }),
      row({ created_at: "2026-08-06T09:58:00Z" }),
    ]);
    expect(groups.length).toBe(2);
    expect(groups[0].rows.length).toBe(1);
    expect(groups[1].rows.length).toBe(2);
  });

  it("returns nothing for an empty log", () => {
    expect(groupByDay([])).toEqual([]);
  });
});

Create `apps/web/components/RegistrationHistory.test.tsx`. Mock the browser Supabase client
the same way `RegistrationDetail.test.tsx` does — a module-level `vi.mock` of
`@/lib/supabase/client` — and drive the result per test:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RegistrationHistory } from "./RegistrationHistory";
import type { AuditRow } from "@/lib/audit";

let auditResult: { data: AuditRow[] | null; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve(auditResult) }) }),
    }),
  }),
}));

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: Math.random().toString(36).slice(2), action: "field_changed",
  detail: { field: "shirt_size", from: "M", to: "L" },
  actor_role: "runner", created_at: "2026-08-08T06:22:00Z", ...over,
});

beforeEach(() => { auditResult = { data: [], error: null }; });

describe("RegistrationHistory", () => {
  it("shows the old value alongside the new one", async () => {
    auditResult = { data: [row({})], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText("Shirt size")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("renders an absent previous value as empty rather than blank", async () => {
    auditResult = { data: [row({ detail: { field: "blood_type", from: null, to: "B-" } })], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText("empty")).toBeInTheDocument();
  });

  it("attributes an organiser edit to the organiser, not the runner", async () => {
    auditResult = { data: [row({ actor_role: "admin" })], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText(/organiser/i)).toBeInTheDocument();
  });

  it("collapses a payment entry to a single line", async () => {
    auditResult = { data: [row({ action: "paid", detail: { method: "gcash", amount: 230000 }, actor_role: "system" })], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText(/paid/i)).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });

  it("says so plainly when there is no history yet", async () => {
    auditResult = { data: [], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText(/no changes yet/i)).toBeInTheDocument();
  });

  it("renders nothing rather than an empty-state lie when the query fails", async () => {
    auditResult = { data: null, error: new Error("boom") };
    render(<RegistrationHistory registrationId="r1" />);
    await waitFor(() => expect(screen.queryByText(/no changes yet/i)).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter web test lib/audit.test.ts components/RegistrationHistory.test.tsx`
Expected: FAIL — cannot resolve `./audit` or `./RegistrationHistory`.

- [ ] **Step 3: Write the pure audit helpers**

Create `apps/web/lib/audit.ts` — types and grouping only. The fetch lives in the component,
matching the add-ons idiom in `RegistrationDetail.tsx`.

```ts
export type AuditRow = {
  id: string;
  action: string;
  detail: Record<string, unknown>;
  actor_role: string | null;
  created_at: string;
};

/** Newest day first, entries newest-first within each day. Grouping by local calendar day
 *  keeps a single afternoon of edits under one heading instead of repeating the date on
 *  every row. Input is expected already sorted newest-first by the query. */
export function groupByDay(rows: AuditRow[]): { day: string; rows: AuditRow[] }[] {
  const buckets = new Map<string, AuditRow[]>();
  for (const r of rows) {
    const day = new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const bucket = buckets.get(day);
    if (bucket) bucket.push(r);
    else buckets.set(day, [r]);
  }
  return [...buckets.entries()].map(([day, rs]) => ({ day, rows: rs }));
}
```

- [ ] **Step 4: Write the history component**

Create `apps/web/components/RegistrationHistory.tsx`. It fetches on mount with the browser
client and a `cancelled` guard, exactly like the add-ons fetch in `RegistrationDetail.tsx`:
`null` means not-yet-loaded or failed, `[]` means confirmed empty.

```tsx
"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fieldLabel } from "@/lib/field-labels";
import { groupByDay, type AuditRow } from "@/lib/audit";

const peso = (c: number) => `₱${(c / 100).toLocaleString()}`;
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Showing the PREVIOUS value is the point of this section: reconciling a box of printed
 *  shirts against a roster needs "M → L", not "shirt size changed". Non-field events
 *  collapse to one line so the section stays short in a 420px drawer. */
function Entry({ row }: { row: AuditRow }) {
  if (row.action === "field_changed") {
    const from = row.detail.from as string | null;
    const to = row.detail.to as string | null;
    return (
      <div className="rounded-lg bg-muted/40 p-2.5">
        <div className="text-[13px] font-medium">{fieldLabel(String(row.detail.field ?? ""))}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="rounded bg-muted px-2 py-0.5 text-[12px] text-muted-foreground line-through">
            {from ?? "empty"}
          </span>
          <ArrowRight size={12} className="text-muted-foreground" aria-hidden="true" />
          <span className="rounded bg-accent/15 px-2 py-0.5 text-[12px] font-medium text-accent">{to}</span>
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {row.actor_role === "admin" ? "Organiser" : "Runner"} · {time(row.created_at)}
        </div>
      </div>
    );
  }

  const amount = typeof row.detail.amount === "number" ? ` ${peso(row.detail.amount)}` : "";
  const label = row.action === "paid" ? `Paid${amount}` : row.action === "refunded" ? `Refunded${amount}` : row.action;
  return (
    <div className="flex justify-between px-0.5 py-1">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[11px] text-muted-foreground">{time(row.created_at)}</span>
    </div>
  );
}

export function RegistrationHistory({ registrationId }: { registrationId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("registration_audit")
      .select("id,action,detail,actor_role,created_at")
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        setRows(error ? null : ((data ?? []) as AuditRow[]));
      });
    return () => { cancelled = true; };
  }, [registrationId]);

  // null covers both "still loading" and "the query failed". Rendering the empty state in
  // either case would assert "nothing ever happened to this registration", which is a
  // stronger claim than we can make — so render nothing until we actually know.
  if (rows === null) return null;
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">No changes yet.</p>;

  return (
    <div className="flex flex-col gap-2.5">
      {groupByDay(rows).map((g) => (
        <div key={g.day}>
          <div className="mb-1 text-[11px] text-muted-foreground">{g.day}</div>
          <div className="flex flex-col gap-1.5">
            {g.rows.map((r) => <Entry key={r.id} row={r} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Mount it in the drawer**

In `apps/web/components/RegistrationDetail.tsx`, add
`import { RegistrationHistory } from "./RegistrationHistory";` and insert the section
immediately after the "Registration fields" `Section` block closes (`) : null}`) and before
the scroll region's closing `</div>` — so it sits inside the scrollable area, after the
fields, above the refund footer. Wrap it in the file's existing local `Section` component so
it gets the same heading treatment as its neighbours:

```tsx
        <Section title="History">
          <RegistrationHistory registrationId={row.id} />
        </Section>
```

Do NOT touch the `custom_data` rendering — it already uses `fieldLabel` and `fieldValue`.

`RegistrationDetail.test.tsx` mocks `@/lib/supabase/client` with a single `from()` shape that
only serves the add-ons query. Mounting the history adds a second table, so that mock must now
branch by table name — otherwise the existing drawer tests break on a missing `.order`:

```tsx
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) =>
      table === "registration_audit"
        ? { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }
        : { select: selectMock },
  }),
}));
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter web test && pnpm --filter web typecheck`
Expected: PASS, 11 new tests plus every pre-existing drawer test.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/audit.ts apps/web/lib/audit.test.ts apps/web/components/RegistrationHistory.tsx apps/web/components/RegistrationHistory.test.tsx apps/web/components/RegistrationDetail.tsx apps/web/components/RegistrationDetail.test.tsx
git commit -m "feat(admin): show a registration change timeline in the drawer"
```

---

### Task 12: Event page deadline notice

**Files:**
- Modify: `apps/site/lib/kit.ts` — add `deadlineNotice`
- Modify: `apps/site/lib/__tests__/kit.test.ts`
- Modify: `apps/site/components/event/EventPageBody.tsx` — render near the register CTA
- Modify: `apps/site/components/event/__tests__/event-page-body.test.tsx`

**Interfaces:**
- Consumes: `daysUntil` (Task 9), `events.registration_closes_at` (Task 1), the `closed` flag already computed at `apps/site/app/events/[id]/page.tsx:50` and passed into `EventPageBody`.
- Produces: `deadlineNotice(registrationClosesAt: string | null): string | null` — null when there is no deadline or it has passed (the closed state already covers that case).

- [ ] **Step 1: Write the failing test**

Append to `apps/site/lib/__tests__/kit.test.ts`:

```ts
import { deadlineNotice } from "../kit";

describe("deadlineNotice", () => {
  it("says nothing when the event has no deadline", () => {
    expect(deadlineNotice(null)).toBeNull();
  });

  it("says nothing once the deadline has passed — the closed state covers it", () => {
    expect(deadlineNotice("2020-01-01T00:00:00Z")).toBeNull();
  });

  it("names the date when the deadline is far off", () => {
    const far = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect(deadlineNotice(far)).toMatch(/^Registration closes /);
  });

  it("switches to relative time inside the final week, where urgency reads better", () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(deadlineNotice(soon)).toBe("Closes in 3 days");
  });

  it("uses the singular on the last day", () => {
    const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
    expect(deadlineNotice(tomorrow)).toBe("Closes in 1 day");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter site test lib/__tests__/kit.test.ts`
Expected: FAIL — `deadlineNotice is not a function`.

- [ ] **Step 3: Implement the notice**

Append to `apps/site/lib/kit.ts`:

```ts
/** A bare date reads as trivia; time remaining reads as an instruction. Inside the final
 *  week the relative form carries the urgency, and before that the absolute date is what a
 *  runner actually plans around. Returns null once the deadline passes, because the closed
 *  state already says so more clearly than a countdown could. */
export function deadlineNotice(registrationClosesAt: string | null): string | null {
  if (!registrationClosesAt) return null;
  const days = daysUntil(registrationClosesAt);
  if (days === 0) return null;
  if (days <= 7) return `Closes in ${days} ${days === 1 ? "day" : "days"}`;
  const when = new Date(registrationClosesAt).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
  return `Registration closes ${when}`;
}
```

- [ ] **Step 4: Render it near the register CTA**

In `apps/site/components/event/EventPageBody.tsx`, accept a new prop
`registrationClosesAt: string | null` on the component, and render immediately below the
register CTA (the same block guarded by `closed` around line 331):

```tsx
        {!closed && deadlineNotice(registrationClosesAt) ? (
          <p className="mt-2 text-center text-[13px] text-muted-foreground">
            {deadlineNotice(registrationClosesAt)}
          </p>
        ) : null}
```

Import it: `import { deadlineNotice } from "@/lib/kit";`

In `apps/site/app/events/[id]/page.tsx`, pass the prop through:
`registrationClosesAt={event.registration_closes_at}`.

- [ ] **Step 5: Add the component test**

Append to `apps/site/components/event/__tests__/event-page-body.test.tsx`, following the
render helper the file already defines:

```tsx
it("shows the deadline near the register CTA while registration is open", () => {
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
  renderBody({ closed: false, registrationClosesAt: soon });
  expect(screen.getByText("Closes in 3 days")).toBeInTheDocument();
});

it("does not show a countdown once registration is closed", () => {
  renderBody({ closed: true, registrationClosesAt: "2020-01-01T00:00:00Z" });
  expect(screen.queryByText(/closes in/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter site test && pnpm --filter site typecheck`
Expected: PASS, 7 new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/site/lib/kit.ts apps/site/components/event apps/site/app/events apps/site/lib/__tests__/kit.test.ts
git commit -m "feat(site): show the registration deadline on the event page"
```

---

## Final verification

- [ ] **Run the whole suite**

```bash
pnpm test && pnpm --filter web test && pnpm --filter site test && pnpm typecheck
```

Expected: all green. If any pre-existing test broke, fix it before proceeding — the plan
changes one shared function signature (`isRegistrationClosed`) and two RPC bodies, which are
the likely culprits.

- [ ] **Manual smoke, admin**

Set a registration deadline in the past on a test event, confirm the public event page shows
it closed, and confirm the register route refuses. Set a kit cutoff in the future and confirm
the runner ticket page offers Change.

- [ ] **Manual smoke, runner**

Change a shirt size on a paid registration and confirm the admin drawer's History shows
`M → L` with the runner as actor.
