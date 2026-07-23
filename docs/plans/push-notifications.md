# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Facebook-style notification system — a persisted in-app inbox (bell, unread badge, read/unread, mark-all) plus Expo device push — driven by Postgres triggers across the 7 required triggers.

**Architecture:** Postgres triggers write `notifications` rows in the same transaction as each state change (register/pay/event-change/check-in) and a daily `pg_cron` job enqueues reminders. Two channels read that table: Supabase Realtime powers the live in-app inbox, and a `pg_cron`-drained `send-push` Edge Function delivers Expo push. A minimal `checkins` table + `check-in` Edge Function gives the attendance-scan trigger a real hook.

**Tech Stack:** Supabase (Postgres 17, RLS, pg_cron, pg_net, Vault, Edge Functions/Deno), Expo SDK 57 + Expo Router, `@tanstack/react-query`, `@supabase/supabase-js`, NativeWind/RNR. Backend/shared tests: Vitest. Mobile tests: Jest (`jest-expo`) + `@testing-library/react-native`.

**Full design spec:** [docs/specs/2026-07-23-push-notifications-design.md](../specs/2026-07-23-push-notifications-design.md)

## Global Constraints

- **Migrations:** new files in `supabase/migrations/` named `YYYYMMDDHHMMSS_<snake_name>.sql`; use the timestamps assigned per task (all after the latest existing `20260722154132`). Apply locally with `pnpm exec supabase db reset`; apply to the hosted project with `pnpm exec supabase db push`.
- **New tables are NOT auto-exposed** to `anon`/`authenticated`/`service_role` — every new table needs explicit `grant`s (follow `20260720150000_user_roles.sql`). RLS still restricts rows.
- **DB integration tests** (`supabase/tests/*.test.ts`, Vitest) require a running local stack. One-time per machine/session: `pnpm exec supabase start` → `pnpm exec supabase db reset` → `pnpm exec supabase status -o env > .env.local`. They use seeded fixtures: org `RWP = 00000000-0000-0000-0000-0000000000a1`, event `E1 = 00000000-0000-0000-0000-0000000000e1`, category `C4 = 00000000-0000-0000-0000-0000000000c4`.
- **Mobile tests:** run from `apps/mobile` with `pnpm test -- <pattern>`. Typecheck: `cd apps/mobile && npx tsc --noEmit`.
- **Backend/shared tests:** run from repo root with `pnpm exec vitest run <path>`.
- **Hosted project ref:** `ytwdrsmclwghwktpupqd` → Edge Function base URL `https://ytwdrsmclwghwktpupqd.supabase.co/functions/v1/`.
- **Ticket secret:** Edge Functions read `TICKET_SIGNING_SECRET` (default `"dev-secret"` locally).
- **Brand accent:** trail-green `#159A55`.
- **Every commit message** ends with a blank line then: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **DRY / YAGNI / TDD / frequent commits.** No per-type preference toggles, no org-follow, no results/timing concept (all out of scope per spec).

## File Structure

**Backend (new):**
- `supabase/migrations/20260723090000_notifications_table.sql` — enum, `notifications` table, RLS, grants, indexes, realtime publication
- `supabase/migrations/20260723090100_device_tokens_table.sql` — `device_tokens` table, RLS, grants
- `supabase/migrations/20260723090200_checkins_table.sql` — `checkins` table, RLS, grants
- `supabase/migrations/20260723090300_notify_registration_trigger.sql` — `fn_notify_on_registration` + trigger
- `supabase/migrations/20260723090400_notify_event_trigger.sql` — `fn_notify_on_event_change` + trigger
- `supabase/migrations/20260723090500_notify_checkin_trigger.sql` — `fn_notify_on_checkin` + trigger
- `supabase/migrations/20260723090600_event_reminders.sql` — `fn_enqueue_event_reminders` + pg_cron daily job
- `supabase/migrations/20260723090700_push_drain_cron.sql` — pg_net + pg_cron drain job
- `supabase/functions/send-push/index.ts` + `supabase/functions/_shared/push.ts` — Expo delivery
- `supabase/functions/check-in/index.ts` + `supabase/functions/_shared/authz.ts` — scan endpoint
- `supabase/tests/notifications-triggers.test.ts` — trigger integration tests
- `supabase/functions/_shared/push.test.ts`, `supabase/functions/_shared/authz.test.ts` — Vitest unit tests

**Mobile (new):**
- `apps/mobile/lib/notifications.ts` — react-query hooks + realtime subscription
- `apps/mobile/lib/notificationMeta.ts` — icon + route mapping (pure)
- `apps/mobile/lib/push.ts` — expo-notifications registration + token upsert
- `apps/mobile/components/NotificationsBridge.tsx` — mounts realtime, push registration, tap routing
- `apps/mobile/app/notifications.tsx` — inbox screen
- `apps/mobile/__mocks__/expo-notifications.js`, `apps/mobile/__mocks__/expo-device.js`
- `apps/mobile/__tests__/notifications-hooks.test.tsx`, `notification-meta.test.ts`, `notifications-screen.test.tsx`, `brand-header.test.tsx`, `push-register.test.ts`

**Mobile (modified):**
- `apps/mobile/components/BrandHeader.tsx` — bell → route + unread badge
- `apps/mobile/app/(tabs)/profile.tsx` — route the "Notifications" row
- `apps/mobile/app/_layout.tsx` — render `<NotificationsBridge />`
- `apps/mobile/app.json` — add `expo-notifications` plugin
- `apps/mobile/package.json` — add `expo-notifications`, `expo-device`

**Shared (modified):**
- `packages/shared/src/index.ts` — `NOTIFICATION_TYPE`

---

## Phase 0 — Shared types

### Task 1: Add `NOTIFICATION_TYPE` to shared

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

**Interfaces:**
- Produces: `NOTIFICATION_TYPE` (readonly string tuple), `type NotificationType`.

- [ ] **Step 1: Write the failing test** — append to `packages/shared/src/index.test.ts`:

```typescript
import { NOTIFICATION_TYPE } from "./index";

describe("NOTIFICATION_TYPE", () => {
  it("lists the 8 notification types the triggers emit", () => {
    expect(NOTIFICATION_TYPE).toEqual([
      "registered", "paid", "event_reminder", "event_cancelled",
      "event_rescheduled", "event_created", "checked_in", "event_completed",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/shared/src/index.test.ts`
Expected: FAIL — `NOTIFICATION_TYPE` is not exported.

- [ ] **Step 3: Write minimal implementation** — add near `REGISTRATION_STATUS` in `packages/shared/src/index.ts`:

```typescript
/** Notification types emitted by the DB triggers (push-notifications design §5.1). */
export const NOTIFICATION_TYPE = [
  "registered", "paid", "event_reminder", "event_cancelled",
  "event_rescheduled", "event_created", "checked_in", "event_completed",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPE)[number];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/shared/src/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts
git commit -m "feat(shared): add NOTIFICATION_TYPE enum"
```

---

## Phase 1 — Database schema

> Tasks 2–4 are verified together by the integration harness. If the local stack is not yet running, first: `pnpm exec supabase start && pnpm exec supabase db reset && pnpm exec supabase status -o env > .env.local`.

### Task 2: `notifications` table

**Files:**
- Create: `supabase/migrations/20260723090000_notifications_table.sql`
- Test: `supabase/tests/notifications-triggers.test.ts` (schema-presence case; grows in Phase 2)

**Interfaces:**
- Produces: table `notifications (id, user_id, type notification_type, title, body, data jsonb, read_at, push_sent_at, dedup_key unique, created_at)`; enum `notification_type`; RLS `notifications_read_own` / `notifications_update_own`; column grant `update (read_at)`.

- [ ] **Step 1: Write the failing test** — create `supabase/tests/notifications-triggers.test.ts`:

```typescript
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

describe("notifications table", () => {
  it("is owner-scoped: a user reads only their own rows and can mark them read", async () => {
    const svc = service();
    const me = await makeUser(`ntf_me_${Date.now()}@test.dev`);
    const other = await makeUser(`ntf_ot_${Date.now()}@test.dev`);
    const ins = await svc.from("notifications").insert({
      user_id: me.id, type: "registered", title: "hi", body: "b", data: {},
    }).select().single();
    expect(ins.error).toBeNull();

    // owner reads it; other user does not
    expect((await authed(me.token).from("notifications").select("id").eq("id", ins.data!.id)).data).toHaveLength(1);
    expect((await authed(other.token).from("notifications").select("id").eq("id", ins.data!.id)).data ?? []).toHaveLength(0);

    // owner can set read_at on their own row
    const upd = await authed(me.token).from("notifications").update({ read_at: new Date().toISOString() }).eq("id", ins.data!.id);
    expect(upd.error).toBeNull();
    // a client cannot INSERT (no insert grant/policy)
    const badInsert = await authed(me.token).from("notifications").insert({ user_id: me.id, type: "paid", title: "x", body: "y", data: {} });
    expect(badInsert.error).not.toBeNull();

    await svc.from("notifications").delete().eq("id", ins.data!.id);
    for (const u of [me, other]) await svc.auth.admin.deleteUser(u.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/notifications-triggers.test.ts`
Expected: FAIL — relation `notifications` does not exist.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20260723090000_notifications_table.sql`:

```sql
-- Facebook-style notification inbox. Rows are created by DB triggers (Phase 2);
-- clients only read their own and toggle read_at. See push-notifications design §5.2.
create type notification_type as enum (
  'registered','paid','event_reminder','event_cancelled',
  'event_rescheduled','event_created','checked_in','event_completed'
);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         notification_type not null,
  title        text not null,
  body         text not null,
  data         jsonb not null default '{}'::jsonb,   -- { event_id?, registration_id? }
  read_at      timestamptz,                          -- null = unread
  push_sent_at timestamptz,                          -- null = device push pending
  dedup_key    text unique,                          -- nulls distinct; guards reminders/broadcast
  created_at   timestamptz not null default now()
);
create index notifications_user_created_idx on notifications (user_id, created_at desc);
create index notifications_user_unread_idx on notifications (user_id) where read_at is null;
create index notifications_push_pending_idx on notifications (created_at) where push_sent_at is null;

alter table notifications enable row level security;

create policy "notifications_read_own" on notifications
  for select using (user_id = auth.uid());
-- Clients may only flip read_at on their own rows (column grant below enforces which columns).
create policy "notifications_update_own" on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Data API grants: select + a column-scoped update. No insert for clients (triggers/service insert).
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
grant all on notifications to service_role;

-- Live in-app inbox: this is the project's first realtime consumer.
alter publication supabase_realtime add table notifications;
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/notifications-triggers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090000_notifications_table.sql supabase/tests/notifications-triggers.test.ts
git commit -m "feat(db): add notifications table with owner-scoped RLS + realtime"
```

### Task 3: `device_tokens` table

**Files:**
- Create: `supabase/migrations/20260723090100_device_tokens_table.sql`
- Test: `supabase/tests/notifications-triggers.test.ts` (add a case)

**Interfaces:**
- Produces: table `device_tokens (id, user_id, token unique, platform, created_at, updated_at)`; owner-scoped RLS for all verbs.

- [ ] **Step 1: Write the failing test** — add inside `supabase/tests/notifications-triggers.test.ts`:

```typescript
describe("device_tokens table", () => {
  it("lets a user upsert and read only their own token", async () => {
    const svc = service();
    const me = await makeUser(`dt_me_${Date.now()}@test.dev`);
    const tok = `ExponentPushToken[${Date.now()}]`;
    const up = await authed(me.token).from("device_tokens").upsert(
      { user_id: me.id, token: tok, platform: "ios" }, { onConflict: "token" });
    expect(up.error).toBeNull();
    expect((await authed(me.token).from("device_tokens").select("token").eq("token", tok)).data).toHaveLength(1);
    await svc.from("device_tokens").delete().eq("token", tok);
    await svc.auth.admin.deleteUser(me.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "device_tokens"`
Expected: FAIL — relation `device_tokens` does not exist.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20260723090100_device_tokens_table.sql`:

```sql
-- Expo push tokens per device. Mobile upserts its own token on login. Design §5.3.
create table device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  platform   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_tokens_user_idx on device_tokens (user_id);

alter table device_tokens enable row level security;
create policy "device_tokens_read_own"   on device_tokens for select using (user_id = auth.uid());
create policy "device_tokens_insert_own" on device_tokens for insert with check (user_id = auth.uid());
create policy "device_tokens_update_own" on device_tokens for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "device_tokens_delete_own" on device_tokens for delete using (user_id = auth.uid());

grant select, insert, update, delete on device_tokens to authenticated;
grant all on device_tokens to service_role;
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "device_tokens"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090100_device_tokens_table.sql supabase/tests/notifications-triggers.test.ts
git commit -m "feat(db): add device_tokens table with owner-scoped RLS"
```

### Task 4: `checkins` table

**Files:**
- Create: `supabase/migrations/20260723090200_checkins_table.sql`
- Test: `supabase/tests/notifications-triggers.test.ts` (add a case)

**Interfaces:**
- Produces: table `checkins (id, org_id, registration_id unique, event_id, checked_in_at, checked_in_by)`; read own-or-org-admin; insert service-role only.

- [ ] **Step 1: Write the failing test** — add inside `supabase/tests/notifications-triggers.test.ts`:

```typescript
describe("checkins table", () => {
  it("is insertable by service role and unique per registration; clients cannot insert", async () => {
    const svc = service();
    const runner = await makeUser(`ci_run_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({
      org_id: "00000000-0000-0000-0000-0000000000a1", event_id: "00000000-0000-0000-0000-0000000000e1",
      category_id: "00000000-0000-0000-0000-0000000000c4", user_id: runner.id, status: "paid", total_amount: 100000,
    }).select().single();

    const ins = await svc.from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    expect(ins.error).toBeNull();
    // second insert for same registration violates the unique constraint
    const dup = await svc.from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    expect(dup.error).not.toBeNull();
    // a runner cannot insert a check-in (no client insert policy)
    const bad = await authed(runner.token).from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    expect(bad.error).not.toBeNull();

    await svc.from("checkins").delete().eq("registration_id", reg.data!.id);
    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "checkins"`
Expected: FAIL — relation `checkins` does not exist.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20260723090200_checkins_table.sql`:

```sql
-- Minimal race-day check-in (Plan 14 shape). Written only by the check-in Edge
-- Function (service role); one row per registration. Design §5.4.
create table checkins (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  registration_id uuid not null unique references registrations(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  checked_in_at   timestamptz not null default now(),
  checked_in_by   uuid references auth.users(id)
);
create index checkins_event_idx on checkins (event_id);

alter table checkins enable row level security;
-- The runner reads their own check-in; org admins read their org's.
create policy "checkins_read_own_or_admin" on checkins for select
  using (exists (select 1 from registrations r
                 where r.id = checkins.registration_id
                   and (r.user_id = auth.uid() or auth_can_admin_org(r.org_id))));

grant select on checkins to authenticated;
grant all on checkins to service_role;
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "checkins"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090200_checkins_table.sql supabase/tests/notifications-triggers.test.ts
git commit -m "feat(db): add checkins table (service-role insert, own/admin read)"
```

---

## Phase 2 — Notification triggers

### Task 5: Registration trigger (registered + paid)

**Files:**
- Create: `supabase/migrations/20260723090300_notify_registration_trigger.sql`
- Test: `supabase/tests/notifications-triggers.test.ts` (add a case)

**Interfaces:**
- Consumes: `notifications`, `registrations`, `events`.
- Produces: `fn_notify_on_registration()` + trigger `trg_registrations_notify` on `registrations` (AFTER INSERT OR UPDATE). Emits `registered` on a new pending row, `paid` on insert-as-paid or a `status → paid` transition.

- [ ] **Step 1: Write the failing test** — add inside `supabase/tests/notifications-triggers.test.ts`:

```typescript
async function latestNote(svc: ReturnType<typeof service>, userId: string) {
  const { data } = await svc.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  return data?.[0];
}

describe("registration trigger", () => {
  it("emits 'registered' on a new pending registration and 'paid' on the paid transition", async () => {
    const svc = service();
    const runner = await makeUser(`rt_run_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({
      org_id: "00000000-0000-0000-0000-0000000000a1", event_id: "00000000-0000-0000-0000-0000000000e1",
      category_id: "00000000-0000-0000-0000-0000000000c4", user_id: runner.id, status: "pending", total_amount: 100000,
    }).select().single();

    const n1 = await latestNote(svc, runner.id);
    expect(n1?.type).toBe("registered");
    expect(n1?.data.registration_id).toBe(reg.data!.id);

    await svc.from("registrations").update({ status: "paid" }).eq("id", reg.data!.id);
    const n2 = await latestNote(svc, runner.id);
    expect(n2?.type).toBe("paid");

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "registration trigger"`
Expected: FAIL — no notification row is created (`n1` is undefined).

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20260723090300_notify_registration_trigger.sql`:

```sql
-- #2 registered (new pending row) and #1 paid (insert-as-paid or status->paid).
-- security definer so it can insert into notifications regardless of caller. Design §6.1.
create or replace function fn_notify_on_registration() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_name from events where id = new.event_id;
    if new.status = 'paid' then
      insert into notifications (user_id, type, title, body, data)
      values (new.user_id, 'paid', 'Payment received',
              'You''re confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    else
      insert into notifications (user_id, type, title, body, data)
      values (new.user_id, 'registered', 'You''re registered',
              'Complete payment to secure your slot for ' || coalesce(v_name,'the event') || '.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from 'paid' and new.status = 'paid' then
    select name into v_name from events where id = new.event_id;
    insert into notifications (user_id, type, title, body, data)
    values (new.user_id, 'paid', 'Payment received',
            'You''re confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
  end if;
  return new;
end; $$;

create trigger trg_registrations_notify after insert or update on registrations
  for each row execute function fn_notify_on_registration();
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "registration trigger"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090300_notify_registration_trigger.sql supabase/tests/notifications-triggers.test.ts
git commit -m "feat(db): notify on registration created + paid"
```

### Task 6: Event-change trigger (cancelled / rescheduled / completed / created)

**Files:**
- Create: `supabase/migrations/20260723090400_notify_event_trigger.sql`
- Test: `supabase/tests/notifications-triggers.test.ts` (add a case)

**Interfaces:**
- Consumes: `notifications`, `events`, `registrations`, `profiles`.
- Produces: `fn_notify_on_event_change()` + trigger `trg_events_notify` (AFTER INSERT OR UPDATE). Fans out cancelled/rescheduled/completed to registrants; broadcasts `event_created` to all profiles on publish (`status → open`) with a `dedup_key`.

- [ ] **Step 1: Write the failing test** — add inside `supabase/tests/notifications-triggers.test.ts` (clones the seeded event so seed state is untouched):

```typescript
async function cloneEvent(svc: ReturnType<typeof service>, over: Record<string, unknown>) {
  const base = (await svc.from("events").select("*").eq("id", "00000000-0000-0000-0000-0000000000e1").single()).data!;
  const { id: _i, created_at: _c, ...rest } = base;
  return (await svc.from("events").insert({ ...rest, ...over }).select().single()).data!;
}
async function notesFor(svc: ReturnType<typeof service>, userId: string, type: string) {
  const { data } = await svc.from("notifications").select("type").eq("user_id", userId).eq("type", type);
  return data ?? [];
}

describe("event-change trigger", () => {
  it("notifies registrants on cancel/reschedule/complete and broadcasts new events on publish", async () => {
    const svc = service();
    const runner = await makeUser(`et_run_${Date.now()}@test.dev`);
    const ev = await cloneEvent(svc, { name: `ET ${Date.now()}`, status: "open" });
    await svc.from("registrations").insert({
      org_id: ev.org_id, event_id: ev.id, category_id: "00000000-0000-0000-0000-0000000000c4",
      user_id: runner.id, status: "paid", total_amount: 100000,
    });

    await svc.from("events").update({ original_date: "2026-01-01" }).eq("id", ev.id);
    expect((await notesFor(svc, runner.id, "event_rescheduled")).length).toBe(1);
    await svc.from("events").update({ status: "completed" }).eq("id", ev.id);
    expect((await notesFor(svc, runner.id, "event_completed")).length).toBe(1);
    await svc.from("events").update({ status: "cancelled" }).eq("id", ev.id);
    expect((await notesFor(svc, runner.id, "event_cancelled")).length).toBe(1);

    // publish a fresh event (draft -> open) broadcasts to the runner (a profile holder)
    await svc.from("profiles").upsert({ id: runner.id, full_name: "Runner" });
    const draft = await cloneEvent(svc, { name: `NEW ${Date.now()}`, status: "draft" });
    await svc.from("events").update({ status: "open" }).eq("id", draft.id);
    expect((await notesFor(svc, runner.id, "event_created")).length).toBeGreaterThanOrEqual(1);
    // re-publish does not duplicate (dedup_key)
    await svc.from("events").update({ status: "draft" }).eq("id", draft.id);
    await svc.from("events").update({ status: "open" }).eq("id", draft.id);
    expect((await notesFor(svc, runner.id, "event_created")).length).toBe(1);

    await svc.from("notifications").delete().eq("user_id", runner.id);
    // the publish broadcast created event_created rows for every profile — clear them by event
    for (const e of [ev.id, draft.id]) await svc.from("notifications").delete().eq("data->>event_id", e);
    for (const e of [ev.id, draft.id]) await svc.from("events").delete().eq("id", e);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "event-change trigger"`
Expected: FAIL — no `event_rescheduled` notification created.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20260723090400_notify_event_trigger.sql`:

```sql
-- #4 cancelled/rescheduled/created + #5 completed. Design §6.2.
create or replace function fn_notify_on_event_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from 'cancelled' and new.status = 'cancelled' then
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_cancelled', 'Event cancelled',
           new.name || ' has been cancelled.', jsonb_build_object('event_id', new.id)
    from registrations r where r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and new.original_date is distinct from old.original_date and new.original_date is not null then
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_rescheduled', 'Event rescheduled',
           new.name || ' has a new date. Check the details.', jsonb_build_object('event_id', new.id)
    from registrations r where r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from 'completed' and new.status = 'completed' then
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_completed', 'You completed ' || new.name || '!',
           'Thanks for joining. See you at the next race.', jsonb_build_object('event_id', new.id)
    from registrations r where r.event_id = new.id and r.status = 'paid';
  end if;

  -- newly published (draft/insert -> open): broadcast to all users, deduped per (event,user).
  if (tg_op = 'INSERT' and new.status = 'open')
     or (tg_op = 'UPDATE' and old.status is distinct from 'open' and new.status = 'open') then
    insert into notifications (user_id, type, title, body, data, dedup_key)
    select p.id, 'event_created', 'New event',
           new.name || ' was just listed. Take a look.',
           jsonb_build_object('event_id', new.id),
           'event_created:' || new.id || ':' || p.id
    from profiles p
    on conflict (dedup_key) do nothing;
  end if;

  return new;
end; $$;

create trigger trg_events_notify after insert or update on events
  for each row execute function fn_notify_on_event_change();
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "event-change trigger"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090400_notify_event_trigger.sql supabase/tests/notifications-triggers.test.ts
git commit -m "feat(db): notify on event cancel/reschedule/complete/publish"
```

### Task 7: Check-in trigger

**Files:**
- Create: `supabase/migrations/20260723090500_notify_checkin_trigger.sql`
- Test: `supabase/tests/notifications-triggers.test.ts` (add a case)

**Interfaces:**
- Consumes: `notifications`, `checkins`, `registrations`, `events`.
- Produces: `fn_notify_on_checkin()` + trigger `trg_checkins_notify` (AFTER INSERT). Emits `checked_in` to the registration's owner.

- [ ] **Step 1: Write the failing test** — add inside `supabase/tests/notifications-triggers.test.ts`:

```typescript
describe("check-in trigger", () => {
  it("emits 'checked_in' to the registrant when a check-in row is inserted", async () => {
    const svc = service();
    const runner = await makeUser(`ck_run_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({
      org_id: "00000000-0000-0000-0000-0000000000a1", event_id: "00000000-0000-0000-0000-0000000000e1",
      category_id: "00000000-0000-0000-0000-0000000000c4", user_id: runner.id, status: "paid", total_amount: 100000,
    }).select().single();
    await svc.from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    const n = await latestNote(svc, runner.id);
    expect(n?.type).toBe("checked_in");
    expect(n?.data.registration_id).toBe(reg.data!.id);

    await svc.from("checkins").delete().eq("registration_id", reg.data!.id);
    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "check-in trigger"`
Expected: FAIL — no `checked_in` notification created.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20260723090500_notify_checkin_trigger.sql`:

```sql
-- #6 attendance scanned. Design §6.3.
create or replace function fn_notify_on_checkin() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_name text;
begin
  select r.user_id into v_uid from registrations r where r.id = new.registration_id;
  select name into v_name from events where id = new.event_id;
  if v_uid is not null then
    insert into notifications (user_id, type, title, body, data)
    values (v_uid, 'checked_in', 'You''re checked in',
            'Checked in at ' || coalesce(v_name,'the event') || '. Enjoy your race.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.registration_id));
  end if;
  return new;
end; $$;

create trigger trg_checkins_notify after insert on checkins
  for each row execute function fn_notify_on_checkin();
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "check-in trigger"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090500_notify_checkin_trigger.sql supabase/tests/notifications-triggers.test.ts
git commit -m "feat(db): notify registrant on check-in"
```

### Task 8: Event reminders (function + daily cron)

**Files:**
- Create: `supabase/migrations/20260723090600_event_reminders.sql`
- Test: `supabase/tests/notifications-triggers.test.ts` (add a case)

**Interfaces:**
- Consumes: `notifications`, `events`, `registrations`.
- Produces: `fn_enqueue_event_reminders()` (void, granted to `service_role`) inserting `event_reminder` rows for `open` events 7 or 1 days out, deduped per `(event,user,days)`; a daily `pg_cron` job `event-reminders-daily`.

- [ ] **Step 1: Write the failing test** — add inside `supabase/tests/notifications-triggers.test.ts` (calls the function directly; no cron needed):

```typescript
describe("event reminders", () => {
  it("enqueues 7-day + 1-day reminders once (idempotent) for paid registrants", async () => {
    const svc = service();
    const runner = await makeUser(`rm_run_${Date.now()}@test.dev`);
    const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const ev = await cloneEvent(svc, { name: `RM ${Date.now()}`, status: "open", event_date: inDays(7) });
    await svc.from("registrations").insert({
      org_id: ev.org_id, event_id: ev.id, category_id: "00000000-0000-0000-0000-0000000000c4",
      user_id: runner.id, status: "paid", total_amount: 100000,
    });

    await svc.rpc("fn_enqueue_event_reminders");
    await svc.rpc("fn_enqueue_event_reminders"); // second run must not duplicate
    const { data } = await svc.from("notifications").select("id").eq("user_id", runner.id).eq("type", "event_reminder");
    expect(data).toHaveLength(1); // 7 days out today → exactly one reminder

    await svc.from("notifications").delete().eq("user_id", runner.id);
    await svc.from("events").delete().eq("id", ev.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "event reminders"`
Expected: FAIL — function `fn_enqueue_event_reminders` does not exist.

- [ ] **Step 3: Write the migration** — create `supabase/migrations/20260723090600_event_reminders.sql`:

```sql
-- #3 event N days away. Reminder days are the array below. Deduped per (event,user,days)
-- so the daily cron is safe to re-run. Design §6.4.
create or replace function fn_enqueue_event_reminders() returns void
  language plpgsql security definer set search_path = public as $$
declare d int;
begin
  foreach d in array array[7,1] loop
    insert into notifications (user_id, type, title, body, data, dedup_key)
    select r.user_id, 'event_reminder',
           case when d = 1 then '1 day to go' else d || ' days to go' end,
           e.name || case when d = 1 then ' is tomorrow. Get your gear ready.' else ' is coming up. Get ready.' end,
           jsonb_build_object('event_id', e.id),
           'reminder:' || e.id || ':' || r.user_id || ':' || d
    from events e
    join registrations r on r.event_id = e.id and r.status = 'paid'
    where e.status = 'open' and e.event_date = current_date + d
    on conflict (dedup_key) do nothing;
  end loop;
end; $$;

grant execute on function fn_enqueue_event_reminders() to service_role;

-- Daily at 01:00 UTC (~09:00 PH). pg_cron ships on Supabase (local + hosted).
create extension if not exists pg_cron;
select cron.schedule('event-reminders-daily', '0 1 * * *', $$ select fn_enqueue_event_reminders(); $$);
```

- [ ] **Step 4: Apply locally and run the test**

Run: `pnpm exec supabase db reset && pnpm exec vitest run supabase/tests/notifications-triggers.test.ts -t "event reminders"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723090600_event_reminders.sql supabase/tests/notifications-triggers.test.ts
git commit -m "feat(db): daily event reminder enqueue (7 + 1 day, deduped)"
```

---

## Phase 3 — Delivery (Edge Functions + push drain)

### Task 9: `send-push` Edge Function + push helpers

**Files:**
- Create: `supabase/functions/_shared/push.ts`
- Create: `supabase/functions/send-push/index.ts`
- Modify: `supabase/config.toml` (add `[functions.send-push] verify_jwt = false`)
- Test: `supabase/functions/_shared/push.test.ts`

**Interfaces:**
- Produces: `buildExpoMessages(notes, tokensByUser): ExpoMessage[]`, `chunk<T>(arr, size): T[][]`, `deadTokens(messages, tickets): string[]`; types `PushNotification = { id; user_id; type; title; body; data }`, `ExpoMessage = { to; title; body; data }`, `ExpoTicket = { status; details? }`. The Edge Function drains `notifications where push_sent_at is null`, sends via Expo, sets `push_sent_at`, deletes dead tokens.

- [ ] **Step 1: Write the failing test** — create `supabase/functions/_shared/push.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildExpoMessages, chunk, deadTokens } from "./push";

describe("push helpers", () => {
  it("fans out one Expo message per (notification, token) with type in the payload", () => {
    const notes = [{ id: "n1", user_id: "u1", type: "paid", title: "T", body: "B", data: { event_id: "e1" } }];
    const tokens = new Map([["u1", ["ExponentPushToken[a]", "ExponentPushToken[b]"]]]);
    const msgs = buildExpoMessages(notes, tokens);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ to: "ExponentPushToken[a]", title: "T", body: "B", data: { event_id: "e1", type: "paid" } });
  });
  it("chunks into batches of at most 100", () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i), 100).map((c) => c.length)).toEqual([100, 100, 50]);
  });
  it("collects DeviceNotRegistered tokens from Expo tickets", () => {
    const msgs = [{ to: "tokA", title: "", body: "", data: {} }, { to: "tokB", title: "", body: "", data: {} }];
    const tickets = [{ status: "ok" as const }, { status: "error" as const, details: { error: "DeviceNotRegistered" } }];
    expect(deadTokens(msgs, tickets)).toEqual(["tokB"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/functions/_shared/push.test.ts`
Expected: FAIL — cannot find module `./push`.

- [ ] **Step 3: Write the helpers** — create `supabase/functions/_shared/push.ts`:

```typescript
// Pure helpers for the send-push Edge Function (unit-tested with Vitest). Design §7.2.
export type PushNotification = {
  id: string; user_id: string; type: string; title: string; body: string; data: Record<string, unknown>;
};
export type ExpoMessage = { to: string; title: string; body: string; data: Record<string, unknown> };
export type ExpoTicket = { status: "ok" | "error"; details?: { error?: string } };

export function buildExpoMessages(notes: PushNotification[], tokensByUser: Map<string, string[]>): ExpoMessage[] {
  const msgs: ExpoMessage[] = [];
  for (const n of notes) {
    for (const to of tokensByUser.get(n.user_id) ?? []) {
      msgs.push({ to, title: n.title, body: n.body, data: { ...n.data, type: n.type } });
    }
  }
  return msgs;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Expo returns one ticket per message in order; a DeviceNotRegistered ticket means prune that token.
export function deadTokens(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  const dead: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === "error" && t.details?.error === "DeviceNotRegistered" && messages[i]) dead.push(messages[i].to);
  });
  return [...new Set(dead)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run supabase/functions/_shared/push.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Edge Function** — create `supabase/functions/send-push/index.ts`:

```typescript
import { serviceClient } from "../_shared/supabase.ts";
import { buildExpoMessages, chunk, deadTokens, type PushNotification, type ExpoTicket } from "../_shared/push.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Drains pending notifications and delivers them as Expo push. Invoked every minute by
// pg_cron via pg_net with the service-role key in the Authorization header (verify_jwt=false).
Deno.serve(async (req) => {
  const auth = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (auth !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return json({ error: "unauthorized" }, 401);

  const db = serviceClient();
  const { data: notes } = await db.from("notifications")
    .select("id,user_id,type,title,body,data").is("push_sent_at", null)
    .order("created_at", { ascending: true }).limit(200);
  if (!notes || notes.length === 0) return json({ sent: 0 });

  const userIds = [...new Set(notes.map((n) => n.user_id))];
  const { data: tokenRows } = await db.from("device_tokens").select("user_id,token").in("user_id", userIds);
  const tokensByUser = new Map<string, string[]>();
  for (const r of tokenRows ?? []) tokensByUser.set(r.user_id, [...(tokensByUser.get(r.user_id) ?? []), r.token]);

  const messages = buildExpoMessages(notes as PushNotification[], tokensByUser);
  const allDead: string[] = [];
  for (const batch of chunk(messages, 100)) {
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch),
      });
      const body = await res.json().catch(() => ({ data: [] }));
      allDead.push(...deadTokens(batch, (body.data ?? []) as ExpoTicket[]));
    } catch { /* leave push_sent_at set; realtime already delivered in-app */ }
  }

  // Best-effort: mark every drained row sent so the queue never clogs (tokenless users included).
  await db.from("notifications").update({ push_sent_at: new Date().toISOString() }).in("id", notes.map((n) => n.id));
  if (allDead.length) await db.from("device_tokens").delete().in("token", [...new Set(allDead)]);
  return json({ sent: messages.length, pruned: allDead.length });
});
```

- [ ] **Step 6: Register the function as public (no JWT) in `supabase/config.toml`** — add alongside the existing `[functions.*]` blocks:

```toml
[functions.send-push]
verify_jwt = false
```

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/push.ts supabase/functions/_shared/push.test.ts supabase/functions/send-push/index.ts supabase/config.toml
git commit -m "feat(fn): send-push edge function with Expo delivery + token pruning"
```

### Task 10: Push-drain cron (pg_net + pg_cron)

**Files:**
- Create: `supabase/migrations/20260723090700_push_drain_cron.sql`

**Interfaces:**
- Consumes: `send-push` Edge Function (Task 9), Vault secret `service_role_key`.
- Produces: pg_cron job `drain-push-1min` calling `send-push` via `net.http_post`.

> This wiring is validated on the hosted project (it needs the deployed function + the Vault secret), not by the local Vitest suite. It is a single migration + one manual secret step.

- [ ] **Step 1: Create the migration** — `supabase/migrations/20260723090700_push_drain_cron.sql`:

```sql
-- Every minute, ping send-push to drain pending device pushes. Design §7.2.
-- The service-role key is read from Supabase Vault (secret created out-of-band, see plan).
create extension if not exists pg_net;

select cron.schedule('drain-push-1min', '* * * * *', $$
  select net.http_post(
    url := 'https://ytwdrsmclwghwktpupqd.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
$$);
```

- [ ] **Step 2: Apply locally to confirm the SQL is valid**

Run: `pnpm exec supabase db reset`
Expected: completes without error (the job is scheduled; locally it just no-ops against a missing secret/function, which is fine — we only assert the migration applies).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260723090700_push_drain_cron.sql
git commit -m "feat(db): pg_cron push-drain calling send-push via pg_net"
```

- [ ] **Step 4: Document the one-time hosted secret step** — append to the design spec's §15 (or a deploy note) and run against hosted when deploying:

```bash
# One-time on the hosted project (NOT committed — the key is a secret):
pnpm exec supabase db query --linked "select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');"
```

(No test/commit for the manual secret — it's an ops step performed at deploy time in Phase 6.)

### Task 11: `check-in` Edge Function + authz helper

**Files:**
- Create: `supabase/functions/_shared/authz.ts`
- Create: `supabase/functions/check-in/index.ts`
- Test: `supabase/functions/_shared/authz.test.ts`

**Interfaces:**
- Consumes: `verifyTicketToken` (`_shared/ticket.ts`), `serviceClient`, `checkins`/`registrations`/`user_roles`.
- Produces: `canCheckIn(roles, orgId): boolean`, `canAdminOrg(roles, orgId): boolean`, `type RoleRow = { role: string; org_id: string | null }`. Edge Function `check-in` accepts `{ ticket_token }`, verifies it, authorizes staff, inserts a `checkins` row.

- [ ] **Step 1: Write the failing test** — create `supabase/functions/_shared/authz.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { canCheckIn, canAdminOrg } from "./authz";

const ORG = "org-1";
describe("authz", () => {
  it("canCheckIn allows super_admin and org marshal/editor/admin only", () => {
    expect(canCheckIn([{ role: "super_admin", org_id: null }], ORG)).toBe(true);
    expect(canCheckIn([{ role: "marshal", org_id: ORG }], ORG)).toBe(true);
    expect(canCheckIn([{ role: "marshal", org_id: "other" }], ORG)).toBe(false);
    expect(canCheckIn([{ role: "user", org_id: ORG }], ORG)).toBe(false);
  });
  it("canAdminOrg excludes marshal", () => {
    expect(canAdminOrg([{ role: "marshal", org_id: ORG }], ORG)).toBe(false);
    expect(canAdminOrg([{ role: "admin", org_id: ORG }], ORG)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run supabase/functions/_shared/authz.test.ts`
Expected: FAIL — cannot find module `./authz`.

- [ ] **Step 3: Write the helper** — create `supabase/functions/_shared/authz.ts`:

```typescript
// Shared role checks (service-role bypasses RLS, so these gate authorization in code).
export type RoleRow = { role: string; org_id: string | null };

export function canAdminOrg(roles: RoleRow[], orgId: string): boolean {
  return roles.some((r) => r.role === "super_admin" || (r.org_id === orgId && (r.role === "editor" || r.role === "admin")));
}
export function canCheckIn(roles: RoleRow[], orgId: string): boolean {
  return roles.some((r) => r.role === "super_admin" ||
    (r.org_id === orgId && (r.role === "marshal" || r.role === "editor" || r.role === "admin")));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run supabase/functions/_shared/authz.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the Edge Function** — create `supabase/functions/check-in/index.ts`:

```typescript
import { serviceClient } from "../_shared/supabase.ts";
import { verifyTicketToken } from "../_shared/ticket.ts";
import { canCheckIn, type RoleRow } from "../_shared/authz.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Staff-only. Verifies the scanned QR ticket, authorizes the scanner for the event's org,
// records the check-in (one per registration). The DB trigger notifies the runner.
Deno.serve(async (req) => {
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const token = (await req.json().catch(() => ({})))?.ticket_token as string | undefined;
    if (!token) return json({ error: "ticket_token_required" }, 400);

    const secret = Deno.env.get("TICKET_SIGNING_SECRET") ?? "dev-secret";
    const payload = await verifyTicketToken(token, secret);
    if (!payload) return json({ error: "invalid_ticket" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);

    const { data: reg } = await db.from("registrations").select("id,org_id,event_id,status").eq("id", payload.rid).single();
    if (!reg) return json({ error: "not_found" }, 404);
    if (reg.status !== "paid") return json({ error: "not_paid" }, 409);

    const { data: roles } = await db.from("user_roles").select("role,org_id").eq("user_id", userRes.user.id);
    if (!canCheckIn((roles ?? []) as RoleRow[], reg.org_id)) return json({ error: "forbidden" }, 403);

    const { data: inserted, error: insErr } = await db.from("checkins")
      .insert({ org_id: reg.org_id, registration_id: reg.id, event_id: reg.event_id, checked_in_by: userRes.user.id })
      .select("id");
    if (insErr) return json({ ok: true, registration_id: reg.id, already: true }); // unique violation = already checked in
    return json({ ok: true, registration_id: reg.id, checkin_id: inserted?.[0]?.id });
  } catch {
    return json({ error: "server_error" }, 500);
  }
});
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/authz.ts supabase/functions/_shared/authz.test.ts supabase/functions/check-in/index.ts
git commit -m "feat(fn): check-in edge function verifies QR ticket + records scan"
```

---

## Phase 4 — Mobile data layer

### Task 12: `lib/notifications.ts` — react-query hooks

**Files:**
- Create: `apps/mobile/lib/notifications.ts`
- Test: `apps/mobile/__tests__/notifications-hooks.test.tsx`

**Interfaces:**
- Produces: `type NotificationRow = { id; type; title; body; data: { event_id?; registration_id? } | null; read_at: string | null; created_at }`; hooks `useNotifications()`, `useUnreadCount()`, `useMarkRead()`, `useMarkUnread()`, `useMarkAllRead()`; query keys `["notifications"]`, `["notifications-unread"]`.

- [ ] **Step 1: Write the failing test** — create `apps/mobile/__tests__/notifications-hooks.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNotifications, useUnreadCount } from "../lib/notifications";

const rows = [{ id: "n1", type: "paid", title: "Payment received", body: "b", data: { registration_id: "r1" }, read_at: null, created_at: "2026-07-23T00:00:00Z" }];
const limit = jest.fn(async () => ({ data: rows, error: null }));
const order = jest.fn(() => ({ limit }));
const isNull = jest.fn(async () => ({ count: 3, error: null }));
const select = jest.fn(() => ({ order, is: isNull }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ select })) } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("notifications hooks", () => {
  it("useNotifications returns the list newest-first", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].type).toBe("paid");
  });
  it("useUnreadCount returns the head count", async () => {
    const { result } = renderHook(() => useUnreadCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test -- notifications-hooks`
Expected: FAIL — cannot find module `../lib/notifications`.

- [ ] **Step 3: Write the implementation** — create `apps/mobile/lib/notifications.ts`:

```typescript
import { supabase } from "./supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type NotificationRow = {
  id: string; type: string; title: string; body: string;
  data: { event_id?: string; registration_id?: string } | null;
  read_at: string | null; created_at: string;
};

const KEY = ["notifications"] as const;
const UNREAD = ["notifications-unread"] as const;

export async function fetchNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications").select("id,type,title,body,data,read_at,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}
export function useNotifications() {
  return useQuery({ queryKey: KEY, queryFn: fetchNotifications });
}

export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}
export function useUnreadCount() {
  return useQuery({ queryKey: UNREAD, queryFn: fetchUnreadCount });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: UNREAD }); };
}

export function useMarkRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
export function useMarkUnread() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read_at: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
export function useMarkAllRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      // RLS restricts to the caller's own rows, so no user filter is needed.
      const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test -- notifications-hooks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/notifications.ts apps/mobile/__tests__/notifications-hooks.test.tsx
git commit -m "feat(mobile): notifications react-query hooks (list, unread, mark read/unread/all)"
```

### Task 13: Realtime subscription hook

**Files:**
- Modify: `apps/mobile/lib/notifications.ts` (add `useNotificationsRealtime`)
- Test: `apps/mobile/__tests__/notifications-hooks.test.tsx` (add a case)

**Interfaces:**
- Produces: `useNotificationsRealtime(userId: string | undefined): void` — subscribes to `postgres_changes` on `notifications` filtered to the user and invalidates the query keys on any change.

- [ ] **Step 1: Write the failing test** — in `apps/mobile/__tests__/notifications-hooks.test.tsx`, replace the existing `jest.mock("../lib/supabase", ...)` block with the channel-aware version below, then add the new case:

```tsx
const channelObj: any = {};
const on = jest.fn(() => channelObj);
const subscribe = jest.fn(() => channelObj);
channelObj.on = on; channelObj.subscribe = subscribe;
const channel = jest.fn(() => channelObj);
const removeChannel = jest.fn();
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ select })), channel, removeChannel } }));
```

Then add the case:

```tsx
import { useNotificationsRealtime } from "../lib/notifications";

it("useNotificationsRealtime subscribes for a user and cleans up on unmount", async () => {
  const { unmount } = renderHook(() => useNotificationsRealtime("u1"), { wrapper });
  expect(channel).toHaveBeenCalledWith("notifications:u1");
  expect(on).toHaveBeenCalled();
  expect(subscribe).toHaveBeenCalled();
  unmount();
  expect(removeChannel).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test -- notifications-hooks`
Expected: FAIL — `useNotificationsRealtime` is not exported.

- [ ] **Step 3: Write the implementation** — first add a React import at the **top** of `apps/mobile/lib/notifications.ts` (above the existing imports):

```typescript
import { useEffect } from "react";
```

Then append the hook to the bottom of the same file:

```typescript
export function useNotificationsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: UNREAD }); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test -- notifications-hooks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/notifications.ts apps/mobile/__tests__/notifications-hooks.test.tsx
git commit -m "feat(mobile): realtime notifications subscription hook"
```

### Task 14: Push registration (`lib/push.ts`) + deps + mocks

**Files:**
- Modify: `apps/mobile/package.json` (add `expo-notifications`, `expo-device`)
- Modify: `apps/mobile/app.json` (add `expo-notifications` plugin)
- Create: `apps/mobile/lib/push.ts`
- Create: `apps/mobile/__mocks__/expo-notifications.js`, `apps/mobile/__mocks__/expo-device.js`
- Test: `apps/mobile/__tests__/push-register.test.ts`

**Interfaces:**
- Produces: `registerForPush(userId: string): Promise<string | null>` — returns the Expo token (or null on simulator / denied permission) and upserts `device_tokens`.

- [ ] **Step 1: Install dependencies**

Run: `cd apps/mobile && pnpm expo install expo-notifications expo-device`
Expected: both added to `apps/mobile/package.json` at SDK-57-compatible versions.

- [ ] **Step 2: Add the Jest mocks** — create `apps/mobile/__mocks__/expo-notifications.js`:

```javascript
// expo-notifications binds a native module at import; stub it for Jest.
module.exports = {
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
};
```

Create `apps/mobile/__mocks__/expo-device.js`:

```javascript
module.exports = { isDevice: true };
```

- [ ] **Step 3: Write the failing test** — create `apps/mobile/__tests__/push-register.test.ts`:

```typescript
import { registerForPush } from "../lib/push";

const upsert = jest.fn(async () => ({ error: null }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ upsert })) } }));

describe("registerForPush", () => {
  it("gets an Expo token and upserts it against device_tokens", async () => {
    const token = await registerForPush("u1");
    expect(token).toBe("ExponentPushToken[test]");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", token: "ExponentPushToken[test]" }),
      { onConflict: "token" },
    );
  });

  it("returns null on a simulator (no device)", async () => {
    jest.resetModules();
    jest.doMock("expo-device", () => ({ isDevice: false }));
    const { registerForPush: reg } = await import("../lib/push");
    expect(await reg("u1")).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test -- push-register`
Expected: FAIL — cannot find module `../lib/push`.

- [ ] **Step 5: Write the implementation** — create `apps/mobile/lib/push.ts`:

```typescript
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// Show a banner + bump the badge when a push arrives in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

// Registers this device's Expo push token. No-op on simulators (no APNs token) and when
// the user denies permission — the in-app inbox still works everywhere. Design §6/§9.
export async function registerForPush(userId: string): Promise<string | null> {
  if (!Device.isDevice) return null;
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.status === "granted"
    ? existing.status
    : (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;

  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await supabase.from("device_tokens").upsert(
    { user_id: userId, token, platform: Platform.OS }, { onConflict: "token" });
  return token;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test -- push-register`
Expected: PASS.

- [ ] **Step 7: Add the Expo plugin** — in `apps/mobile/app.json`, add to the `plugins` array (after `"expo-web-browser"`):

```json
      ["expo-notifications", { "color": "#159A55" }]
```

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json apps/mobile/lib/push.ts apps/mobile/__mocks__/expo-notifications.js apps/mobile/__mocks__/expo-device.js apps/mobile/__tests__/push-register.test.ts pnpm-lock.yaml
git commit -m "feat(mobile): expo push token registration + device mocks"
```

---

## Phase 5 — Mobile UI

### Task 15: Notification metadata (icon + route mapping)

**Files:**
- Create: `apps/mobile/lib/notificationMeta.ts`
- Test: `apps/mobile/__tests__/notification-meta.test.ts`

**Interfaces:**
- Produces: `routeFor(type: string, data): string | null`; `iconFor(type: string): LucideIcon`; `accentFor(type: string): string` (NativeWind text-color class).

- [ ] **Step 1: Write the failing test** — create `apps/mobile/__tests__/notification-meta.test.ts`:

```typescript
import { routeFor } from "../lib/notificationMeta";

describe("routeFor", () => {
  it("routes ticket-bearing types to the ticket, registered to pay, else the event", () => {
    expect(routeFor("paid", { registration_id: "r1" })).toBe("/ticket/r1");
    expect(routeFor("checked_in", { registration_id: "r1" })).toBe("/ticket/r1");
    expect(routeFor("registered", { registration_id: "r1" })).toBe("/pay/r1");
    expect(routeFor("event_reminder", { event_id: "e1" })).toBe("/event/e1");
    expect(routeFor("event_created", {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test -- notification-meta`
Expected: FAIL — cannot find module `../lib/notificationMeta`.

- [ ] **Step 3: Write the implementation** — create `apps/mobile/lib/notificationMeta.ts`:

```typescript
import {
  Bell, Ticket, QrCode, Clock, ClipboardCheck, CalendarClock, CalendarX, Sparkles, Trophy,
  type LucideIcon,
} from "lucide-react-native";

type Data = { event_id?: string; registration_id?: string } | null | undefined;

// Deep-link target per type (design §3). Null → fall back to the events tab.
export function routeFor(type: string, data: Data): string | null {
  const d = data ?? {};
  if ((type === "paid" || type === "checked_in") && d.registration_id) return `/ticket/${d.registration_id}`;
  if (type === "registered" && d.registration_id) return `/pay/${d.registration_id}`;
  if (d.event_id) return `/event/${d.event_id}`;
  return null;
}

const ICONS: Record<string, LucideIcon> = {
  registered: ClipboardCheck, paid: Ticket, event_reminder: Clock, event_cancelled: CalendarX,
  event_rescheduled: CalendarClock, event_created: Sparkles, checked_in: QrCode, event_completed: Trophy,
};
export function iconFor(type: string): LucideIcon {
  return ICONS[type] ?? Bell;
}

// Sentiment accent (NativeWind text color): positive=primary(green), info, time=amber, bad=destructive.
const ACCENTS: Record<string, string> = {
  paid: "text-primary", checked_in: "text-primary", event_completed: "text-primary",
  registered: "text-info", event_created: "text-info", event_rescheduled: "text-info",
  event_reminder: "text-amber", event_cancelled: "text-destructive",
};
export function accentFor(type: string): string {
  return ACCENTS[type] ?? "text-foreground";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test -- notification-meta`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/notificationMeta.ts apps/mobile/__tests__/notification-meta.test.ts
git commit -m "feat(mobile): notification icon + deep-link route mapping"
```

### Task 16: Inbox screen (`app/notifications.tsx`)

**Files:**
- Create: `apps/mobile/app/notifications.tsx`
- Test: `apps/mobile/__tests__/notifications-screen.test.tsx`

**Interfaces:**
- Consumes: `useNotifications`, `useMarkRead`, `useMarkAllRead` (Task 12); `routeFor`, `iconFor`, `accentFor` (Task 15).
- Produces: default-exported `NotificationsScreen`.

- [ ] **Step 1: Write the failing test** — create `apps/mobile/__tests__/notifications-screen.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import NotificationsScreen from "../app/notifications";

const push = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push, back: jest.fn() }) }));

const markAll = jest.fn();
const markReadMutate = jest.fn();
jest.mock("../lib/notifications", () => ({
  useNotifications: () => ({
    data: [
      { id: "n1", type: "paid", title: "Payment received", body: "You're confirmed", data: { registration_id: "r1" }, read_at: null, created_at: new Date().toISOString() },
      { id: "n2", type: "event_created", title: "New event", body: "Sierra Madre", data: { event_id: "e9" }, read_at: "2026-07-20T00:00:00Z", created_at: "2026-07-20T00:00:00Z" },
    ],
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useMarkRead: () => ({ mutate: markReadMutate }),
  useMarkAllRead: () => ({ mutate: markAll }),
}));

describe("NotificationsScreen", () => {
  it("renders notifications and marks all read", () => {
    render(<NotificationsScreen />);
    expect(screen.getByText("Payment received")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Mark all read"));
    expect(markAll).toHaveBeenCalled();
  });
  it("marks read and deep-links on row press", () => {
    render(<NotificationsScreen />);
    fireEvent.press(screen.getByText("Payment received"));
    expect(markReadMutate).toHaveBeenCalledWith("n1");
    expect(push).toHaveBeenCalledWith("/ticket/r1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test -- notifications-screen`
Expected: FAIL — cannot find module `../app/notifications`.

- [ ] **Step 3: Write the screen** — create `apps/mobile/app/notifications.tsx`:

```tsx
import { View, SectionList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { useNotifications, useMarkAllRead, useMarkRead, type NotificationRow } from "../lib/notifications";
import { routeFor, iconFor, accentFor } from "../lib/notificationMeta";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString();
}
function relative(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useNotifications();
  const markAll = useMarkAllRead();
  const markRead = useMarkRead();

  const list = data ?? [];
  const sections = [
    { title: "Today", data: list.filter((n) => isToday(n.created_at)) },
    { title: "Earlier", data: list.filter((n) => !isToday(n.created_at)) },
  ].filter((s) => s.data.length > 0);

  const onRow = (n: NotificationRow) => {
    if (!n.read_at) markRead.mutate(n.id);
    const route = routeFor(n.type, n.data);
    router.push((route ?? "/(tabs)/events") as never);
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between border-b border-divider px-[18px] py-2.5">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} className="p-1">
          <Icon as={ChevronLeft} size={24} />
        </Pressable>
        <Text className="text-[16px] font-semibold text-foreground">Notifications</Text>
        <Pressable onPress={() => markAll.mutate()} accessibilityRole="button" hitSlop={10} className="p-1">
          <Text className="text-[13px] text-primary">Mark all read</Text>
        </Pressable>
      </View>

      {isLoading && !data ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator className="text-primary" /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          showsVerticalScrollIndicator={false}
          contentContainerClassName="pb-8"
          ListEmptyComponent={
            <View className="items-center pt-24">
              <Text className="text-lg font-semibold text-foreground">You're all caught up</Text>
              <Text className="mt-1.5 max-w-[240px] text-center text-sm text-muted-foreground">
                Registrations, payments, and race-day updates will show up here.
              </Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text className="bg-background px-[22px] pb-1 pt-3 text-xs font-medium text-muted-foreground">{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable onPress={() => onRow(item)} accessibilityRole="button"
              className={cn("flex-row items-start gap-3 px-[22px] py-3 border-t border-border", !item.read_at && "bg-primary/5")}>
              <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-full bg-secondary">
                <Icon as={iconFor(item.type)} size={18} className={accentFor(item.type)} />
              </View>
              <View className="flex-1">
                <Text className="text-[14px] font-semibold text-foreground">{item.title}</Text>
                <Text className="mt-0.5 text-[13px] text-muted-foreground">{item.body}</Text>
                <Text className="mt-1 text-[11px] text-muted-foreground/70">{relative(item.created_at)}</Text>
              </View>
              {!item.read_at ? <View className="mt-2 h-2 w-2 rounded-full bg-primary" /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test -- notifications-screen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/notifications.tsx apps/mobile/__tests__/notifications-screen.test.tsx
git commit -m "feat(mobile): notification center inbox screen"
```

### Task 17: Bell wiring + unread badge (`BrandHeader`)

**Files:**
- Modify: `apps/mobile/components/BrandHeader.tsx`
- Test: `apps/mobile/__tests__/brand-header.test.tsx`

**Interfaces:**
- Consumes: `useUnreadCount` (Task 12), `useRouter`.

- [ ] **Step 1: Write the failing test** — create `apps/mobile/__tests__/brand-header.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import { BrandHeader } from "../components/BrandHeader";

const push = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
jest.mock("../lib/notifications", () => ({ useUnreadCount: () => ({ data: 3 }) }));

describe("BrandHeader", () => {
  it("shows the unread count and opens the inbox on bell press", () => {
    render(<BrandHeader />);
    expect(screen.getByText("3")).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText("Notifications"));
    expect(push).toHaveBeenCalledWith("/notifications");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test -- brand-header`
Expected: FAIL — no "3" text; `onPress` is a no-op.

- [ ] **Step 3: Update `BrandHeader.tsx`** — replace the file body with:

```tsx
import { Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useUnreadCount } from "@/lib/notifications";

const MARK = require("../assets/topnav-logo.png");
const BAR_HEIGHT = 52;

// App brand bar shown across the tab shell: mark + app name on the left, a notifications
// bell (with unread badge) on the right. Owns the top safe-area inset.
export function BrandHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: unread } = useUnreadCount();
  return (
    <View
      className="flex-row items-center justify-between border-b border-divider bg-background px-[22px]"
      style={{ paddingTop: insets.top, height: BAR_HEIGHT + insets.top }}
    >
      <View className="flex-row items-center gap-2.5">
        <Image source={MARK} style={{ width: 30, height: 30 }} resizeMode="contain" />
        <Text className="text-[17px] font-bold tracking-[-0.3px] text-foreground">Race Pace</Text>
      </View>
      <Pressable className="p-1" accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={10}
        onPress={() => router.push("/notifications")}>
        <Icon as={Bell} size={24} strokeWidth={1.8} />
        {unread ? (
          <View className="absolute -right-1 -top-1 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1" style={{ height: 16 }}>
            <Text className="text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test -- brand-header`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/BrandHeader.tsx apps/mobile/__tests__/brand-header.test.tsx
git commit -m "feat(mobile): wire bell to inbox + unread badge"
```

### Task 18: Bridge (realtime + push + tap routing) and profile row

**Files:**
- Create: `apps/mobile/components/NotificationsBridge.tsx`
- Modify: `apps/mobile/app/_layout.tsx` (render the bridge inside `AuthProvider`)
- Modify: `apps/mobile/app/(tabs)/profile.tsx` (route the "Notifications" row)
- Test: `apps/mobile/__tests__/notifications-bridge.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (`lib/auth`), `useNotificationsRealtime`, `registerForPush`, `routeFor`, `expo-notifications` response listeners.
- Produces: default-exported `NotificationsBridge` (renders null).

- [ ] **Step 1: Write the failing test** — create `apps/mobile/__tests__/notifications-bridge.test.tsx`:

```tsx
import { render } from "@testing-library/react-native";
import NotificationsBridge from "../components/NotificationsBridge";

const realtime = jest.fn();
const register = jest.fn(async () => "ExponentPushToken[test]");
jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1" } } }) }));
jest.mock("../lib/notifications", () => ({ useNotificationsRealtime: (id: string) => realtime(id) }));
jest.mock("../lib/push", () => ({ registerForPush: (id: string) => register(id) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe("NotificationsBridge", () => {
  it("subscribes to realtime and registers push for the signed-in user", () => {
    render(<NotificationsBridge />);
    expect(realtime).toHaveBeenCalledWith("u1");
    expect(register).toHaveBeenCalledWith("u1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile && pnpm test -- notifications-bridge`
Expected: FAIL — cannot find module `../components/NotificationsBridge`.

- [ ] **Step 3: Write the bridge** — create `apps/mobile/components/NotificationsBridge.tsx`:

```tsx
import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../lib/auth";
import { useNotificationsRealtime } from "../lib/notifications";
import { registerForPush } from "../lib/push";
import { routeFor } from "../lib/notificationMeta";

// Headless: wires the live inbox, registers the device token, and routes notification taps.
// Mounted once inside AuthProvider (app/_layout.tsx).
export default function NotificationsBridge() {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const router = useRouter();

  useNotificationsRealtime(userId);

  useEffect(() => {
    if (userId) registerForPush(userId).catch(() => {});
  }, [userId]);

  useEffect(() => {
    const go = (data: { type?: string; event_id?: string; registration_id?: string } | undefined) => {
      const route = routeFor(data?.type ?? "", data ?? {});
      if (route) router.push(route as never);
    };
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) go(r.notification.request.content.data as never);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      go(r.notification.request.content.data as never);
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/mobile && pnpm test -- notifications-bridge`
Expected: PASS.

- [ ] **Step 5: Mount the bridge** — in `apps/mobile/app/_layout.tsx`, add the import and render it inside `AuthProvider` (above `<StatusBar>`):

```tsx
import NotificationsBridge from "../components/NotificationsBridge";
```

```tsx
          <AuthProvider>
            <NotificationsBridge />
            <StatusBar style={dark ? "light" : "dark"} />
            <Stack screenOptions={{ headerShown: false }} />
            <PortalHost />
          </AuthProvider>
```

- [ ] **Step 6: Route the profile "Notifications" row** — in `apps/mobile/app/(tabs)/profile.tsx`, change the `ACCOUNT.map` row's `onPress` so "Notifications" navigates (leave the others as the "Coming soon" alert):

```tsx
              <Pressable key={m} onPress={() => m === "Notifications" ? router.push("/notifications") : Alert.alert(m, "Coming soon.")} accessibilityRole="button" className={cn("flex-row items-center py-3", i > 0 && "border-t border-border")}>
```

- [ ] **Step 7: Run the full mobile suite + typecheck**

Run: `cd apps/mobile && pnpm test && npx tsc --noEmit`
Expected: PASS (all suites green, no type errors).

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/components/NotificationsBridge.tsx apps/mobile/app/_layout.tsx apps/mobile/app/(tabs)/profile.tsx apps/mobile/__tests__/notifications-bridge.test.tsx
git commit -m "feat(mobile): mount realtime + push bridge, route profile notifications row"
```

---

## Phase 6 — Ship & verify

### Task 19: Full test sweep, deploy, and end-to-end verification

**Files:** none (verification + deploy).

- [ ] **Step 1: Run the full backend + shared suite** (local stack up)

Run: `pnpm exec vitest run`
Expected: PASS — includes `supabase/tests/notifications-triggers.test.ts`, `_shared/push.test.ts`, `_shared/authz.test.ts`, and all pre-existing suites.

- [ ] **Step 2: Run the full mobile suite + typecheck**

Run: `cd apps/mobile && pnpm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Push migrations to hosted**

Run: `pnpm exec supabase db push`
Expected: all 8 new migrations apply. Verify the tables exist:

Run: `pnpm exec supabase db query --linked "select count(*) from notifications; select count(*) from device_tokens; select count(*) from checkins;"`
Expected: three `0` counts (tables exist, empty).

- [ ] **Step 4: Create the Vault secret + confirm cron jobs (hosted, one-time)**

Run: `pnpm exec supabase db query --linked "select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');"`
Then: `pnpm exec supabase db query --linked "select jobname, schedule from cron.job;"`
Expected: rows `event-reminders-daily` (`0 1 * * *`) and `drain-push-1min` (`* * * * *`).

- [ ] **Step 5: Deploy the Edge Functions**

Run: `pnpm exec supabase functions deploy send-push && pnpm exec supabase functions deploy check-in`
Expected: both deploy successfully.

- [ ] **Step 6: End-to-end smoke (device build required for push)**

Set `EXPO_PUBLIC_EAS_PROJECT_ID` and ensure an APNs key is configured in EAS, then run a dev-client build on a physical device. Verify: (a) the bell badge increments live when a registration/payment happens (realtime, app open); (b) a lock-screen push arrives within ~60s when the app is backgrounded; (c) tapping a notification deep-links correctly; (d) "Mark all read" clears the badge. The in-app inbox can also be verified on the simulator (realtime only, no device push).

- [ ] **Step 7: Final commit (if any config/docs changed during verification)**

```bash
git add -A
git commit -m "chore(notifications): deploy config + verification notes"
```

---

## Notes for the executor

- **Local stack first.** Every Phase 1–3 test needs `supabase start` → `db reset` → `supabase status -o env > .env.local`. If a trigger test fails with "relation does not exist", you skipped `db reset` after adding the migration.
- **pg_cron/pg_net/Vault** are hosted-validated (Task 10 + Task 19). Locally the drain job is scheduled but harmlessly inert.
- **Push needs credentials.** `registerForPush` no-ops on the simulator by design; device push is only verifiable on a real device with an APNs key + `EXPO_PUBLIC_EAS_PROJECT_ID`. Do not treat a missing simulator push as a bug.
- **Triggers do the fan-out** — do not add notification inserts to `confirm.ts`, `registrations-checkout`, or the web admin; that would double-send.
