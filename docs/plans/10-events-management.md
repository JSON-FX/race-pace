# Admin — Events Management (core CRUD + lifecycle) Implementation Plan (Plan 10; M3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give org admins the first write path in the admin console — create/edit events with their categories + add-ons, and manage lifecycle (reschedule, cancel) — turning the Plan 09 read-only Events list into a working management screen.

**Architecture:** Direct `supabase-js` writes from the admin's browser, gated by new **additive RLS write policies** keyed on the Plan 09 helper `auth_can_admin_org()`. A full-page Create/Edit editor (`/events/new`, `/events/:id/edit`) holds the event + its categories/add-ons in client state and persists them in one **Save** via a by-id child reconcile. Reschedule/Cancel are modals off the Events-list row `⋯`. Money is integer centavos; the editor's price fields edit pesos and convert.

**Tech Stack:** Supabase (Postgres RLS migration), root Vitest (backend, live local stack), Vite + React 19 + React Router v6 + `@tanstack/react-query` + `@supabase/supabase-js`, `zod` (new web dep, local validators), Vitest + React Testing Library (jsdom, web).

## Global Constraints

- **Direct writes gated by RLS, not an Edge Function.** Admin content edits are trusted + org-scoped. Validation = local `zod` schemas + DB constraints.
- **Additive RLS only** — never alter the existing `*_read_published` / `*_read_org_admin` policies. Reuse `auth_can_admin_org(uuid)` (Plan 09, `security definer`).
- **Events are cancel-only; hard-delete is `status='draft'` only** (`registrations.event_id` cascades — deleting a published event would wipe registrations).
- **Category/add-on writes key on the parent event's org:** `auth_can_admin_org((select org_id from events where id = event_id))`. Deleting a category with registrations is blocked by the FK (`registrations.category_id` is `NO ACTION`) → surface a friendly error, keep the row.
- **The write path also needs `addons_read_org_admin`** (Plan 09 added events+categories admin-read but NOT addons; the editor must read a *draft* event's add-ons).
- **`grant insert, update, delete on events, categories, addons to authenticated`** (Postgres checks GRANT before RLS).
- **Money is integer centavos** (`base_price`, `price`). Editor price inputs are pesos → `Math.round(pesos * 100)`.
- **Hero image = pasted URL** (`hero_image_url` text); real upload deferred. `place`/`region` are free-text (no PSGC picker here). `status` select excludes `cancelled` (set via the Cancel modal).
- **Validators live in `apps/web/src/lib/validation.ts`** (local, admin-only) with a direct `zod` dep — NOT `@race-pace/shared` (avoids adding a workspace-TS dep to the Dockerized Vite app). *(Deviation from the spec's "shared"; see Notes.)*
- **Deferred:** custom-field editor → Plan 11; real image upload → a Storage plan; registrations/payments/refunds + gross ₱ → Plan 11.
- **Run:** web tests `cd apps/web && pnpm test` + `pnpm typecheck`; backend `pnpm test -- admin-events` from root (needs `supabase start`). RWP org id = `00000000-0000-0000-0000-0000000000a1`.

## File Structure

```
supabase/
├── migrations/20260721100000_events_write_rls.sql   NEW — addons admin-read + write policies + grants
└── tests/admin-events.test.ts                        NEW — write RLS (root Vitest, live stack)
apps/web/
├── package.json                                      MODIFY — add "zod"
└── src/
    ├── lib/
    │   ├── validation.ts                             NEW — eventInput/categoryInput/addonInput zod schemas
    │   ├── events.ts                                 MODIFY — useEventForEditor(id) (event + categories + addons)
    │   └── eventWrites.ts                            NEW — saveEvent (upsert + child reconcile), reschedule/cancel
    ├── routes/
    │   ├── EventEditor.tsx                            NEW — create/edit page
    │   └── Events.tsx                                 MODIFY — wire "+ Create event" + row ⋯ menu
    ├── components/
    │   ├── CategoryEditor.tsx                         NEW — category rows sub-editor
    │   ├── AddonEditor.tsx                            NEW — add-on rows sub-editor
    │   ├── RescheduleModal.tsx                        NEW
    │   ├── CancelModal.tsx                            NEW
    │   └── TopBar.tsx                                 MODIFY — editor page titles
    ├── App.tsx                                        MODIFY — routes /events/new, /events/:id/edit
    └── __tests__/                                     NEW — validation, event-writes, event-editor, events-actions
```

---

## Task 1: Backend — write RLS + addons admin-read + grants

**Files:**
- Create: `supabase/migrations/20260721100000_events_write_rls.sql`
- Test: `supabase/tests/admin-events.test.ts`

**Interfaces:**
- Produces (SQL): admin-read policy `addons_read_org_admin`; write policies `events_insert_org_admin` / `events_update_org_admin` / `events_delete_org_admin_draft` and `{categories,addons}_{insert,update,delete}_org_admin`; grants.

- [ ] **Step 1: Write the migration** — `supabase/migrations/20260721100000_events_write_rls.sql`:

```sql
-- Admin write path for event content (Plan 10). Additive; reuses auth_can_admin_org (Plan 09).

-- The editor loads a DRAFT event's add-ons (Plan 09 gave events+categories admin-read, not addons).
create policy "addons_read_org_admin" on addons for select
  using (auth_can_admin_org((select e.org_id from events e where e.id = addons.event_id)));

-- events: create/update own-org; hard-delete drafts only (published => cancel).
create policy "events_insert_org_admin" on events for insert
  with check (auth_can_admin_org(org_id));
create policy "events_update_org_admin" on events for update
  using (auth_can_admin_org(org_id)) with check (auth_can_admin_org(org_id));
create policy "events_delete_org_admin_draft" on events for delete
  using (auth_can_admin_org(org_id) and status = 'draft');

-- categories: gated by the parent event's org.
create policy "categories_insert_org_admin" on categories for insert
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "categories_update_org_admin" on categories for update
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)))
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "categories_delete_org_admin" on categories for delete
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)));

-- addons: gated by the parent event's org.
create policy "addons_insert_org_admin" on addons for insert
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "addons_update_org_admin" on addons for update
  using (auth_can_admin_org((select e.org_id from events e where e.id = addons.event_id)))
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "addons_delete_org_admin" on addons for delete
  using (auth_can_admin_org((select e.org_id from events e where e.id = addons.event_id)));

grant insert, update, delete on events, categories, addons to authenticated;
```

- [ ] **Step 2: Apply** — `pnpm exec supabase db reset`. Expected: no error. (If Kong 502s on auth afterward, `docker restart supabase_kong_race-pace`.)

- [ ] **Step 3: Write the failing test** — `supabase/tests/admin-events.test.ts`:

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

describe("admin event writes", () => {
  it("an org admin creates/edits their org's event + children; other-org admin cannot", async () => {
    const svc = service();
    const admin = await makeUser(`ev_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const other = await makeUser(`ev_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO });

    // admin inserts a draft event for RWP
    const ins = await authed(admin.token).from("events").insert({ org_id: RWP, name: "Plan10 Race", status: "draft" }).select().single();
    expect(ins.error).toBeNull();
    const evId = ins.data!.id;
    // update it
    const upd = await authed(admin.token).from("events").update({ name: "Plan10 Race v2" }).eq("id", evId).select();
    expect(upd.data).toHaveLength(1);
    // child category + addon
    const cat = await authed(admin.token).from("categories").insert({ org_id: RWP, event_id: evId, code: "21k", label: "21K", base_price: 150000, slots_total: 100 }).select().single();
    expect(cat.error).toBeNull();
    const add = await authed(admin.token).from("addons").insert({ org_id: RWP, event_id: evId, name: "Singlet", price: 65000 }).select();
    expect(add.data).toHaveLength(1);

    // other-org admin cannot update RWP's event, nor add a category to it
    const hack = await authed(other.token).from("events").update({ name: "hacked" }).eq("id", evId).select();
    expect(hack.data ?? []).toEqual([]);
    const hackCat = await authed(other.token).from("categories").insert({ org_id: APO, event_id: evId, code: "x", label: "x", base_price: 0, slots_total: 0 }).select();
    expect(hackCat.error).not.toBeNull();

    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    await svc.from("events").delete().eq("id", evId); // cascades children
  });

  it("delete: draft event deletes; non-draft blocked; category-with-registration blocked", async () => {
    const svc = service();
    const admin = await makeUser(`ev_del_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });

    // draft delete OK
    const draft = await svc.from("events").insert({ org_id: RWP, name: "DraftDel", status: "draft" }).select().single();
    const delDraft = await authed(admin.token).from("events").delete().eq("id", draft.data!.id).select();
    expect(delDraft.data).toHaveLength(1);

    // non-draft delete blocked (policy gates to draft => 0 rows)
    const open = await svc.from("events").insert({ org_id: RWP, name: "OpenDel", status: "open" }).select().single();
    const delOpen = await authed(admin.token).from("events").delete().eq("id", open.data!.id).select();
    expect(delOpen.data ?? []).toEqual([]);

    // category with a registration: delete blocked by FK
    const cat = await svc.from("categories").insert({ org_id: RWP, event_id: open.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 }).select().single();
    const runner = await makeUser(`ev_run_${Date.now()}@test.dev`);
    await svc.from("registrations").insert({ org_id: RWP, event_id: open.data!.id, category_id: cat.data!.id, user_id: runner.id, total_amount: 100000 });
    const delCat = await authed(admin.token).from("categories").delete().eq("id", cat.data!.id).select();
    expect(delCat.error).not.toBeNull(); // FK restrict

    await svc.from("registrations").delete().eq("event_id", open.data!.id);
    await svc.from("events").delete().in("id", [open.data!.id]);
    await svc.from("user_roles").delete().eq("user_id", admin.id);
  });

  it("a runner (no admin role) cannot create an event", async () => {
    const runner = await makeUser(`ev_norole_${Date.now()}@test.dev`);
    const ins = await authed(runner.token).from("events").insert({ org_id: RWP, name: "nope", status: "draft" }).select();
    expect(ins.error).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run** — `pnpm test -- admin-events` (root; stack up). Expected: PASS (3 tests). Existing `admin-roles` still green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721100000_events_write_rls.sql supabase/tests/admin-events.test.ts
git commit -m "feat(admin): event write RLS (events/categories/addons) + addons admin-read"
```

---

## Task 2: Web — local `zod` validators

**Files:**
- Modify: `apps/web/package.json` (add `zod`)
- Create: `apps/web/src/lib/validation.ts`, `apps/web/src/__tests__/validation.test.ts`

**Interfaces:**
- Produces: `EVENT_STATUSES`; `eventInputSchema`, `categoryInputSchema`, `addonInputSchema` (+ inferred types `EventInput`, `CategoryInput`, `AddonInput`).

- [ ] **Step 1: Add zod** — in `apps/web/package.json` dependencies add `"zod": "^3.23.8"`, then from repo root run `pnpm install`.

- [ ] **Step 2: `apps/web/src/lib/validation.ts`**

```ts
import { z } from "zod";

// 'cancelled' is set via the Cancel modal, not the editor status field.
export const EVENT_STATUSES = ["draft", "open", "almost_full", "closed", "completed"] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable();
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").nullable();
const intNonNeg = z.number().int().min(0);

export const eventInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  place: z.string().nullable(),
  region: z.string().nullable(),
  event_date: dateStr,
  flag_off: timeStr,
  status: z.enum(EVENT_STATUSES),
  elevation_gain_m: intNonNeg.nullable(),
  cutoff_hours: intNonNeg.nullable(),
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
});
export const categoryInputSchema = z.object({
  code: z.string().trim().min(1, "Code required"),
  label: z.string().trim().min(1, "Label required"),
  distance_km: z.number().min(0).nullable(),
  base_price: intNonNeg,   // centavos
  slots_total: intNonNeg,
});
export const addonInputSchema = z.object({
  name: z.string().trim().min(1, "Name required"),
  price: intNonNeg,        // centavos
});

export type EventInput = z.infer<typeof eventInputSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type AddonInput = z.infer<typeof addonInputSchema>;
```

- [ ] **Step 3: `apps/web/src/__tests__/validation.test.ts`**

```ts
import { eventInputSchema, categoryInputSchema, addonInputSchema } from "../lib/validation";

const validEvent = { name: "Race", place: null, region: null, event_date: "2026-10-18", flag_off: "04:00", status: "open", elevation_gain_m: 4300, cutoff_hours: 18, description: null, hero_image_url: null };

it("accepts a valid event and rejects an empty name / bad date", () => {
  expect(eventInputSchema.safeParse(validEvent).success).toBe(true);
  expect(eventInputSchema.safeParse({ ...validEvent, name: "  " }).success).toBe(false);
  expect(eventInputSchema.safeParse({ ...validEvent, event_date: "10/18/2026" }).success).toBe(false);
});
it("category rejects empty code and negative price", () => {
  expect(categoryInputSchema.safeParse({ code: "21k", label: "21K", distance_km: 21, base_price: 150000, slots_total: 100 }).success).toBe(true);
  expect(categoryInputSchema.safeParse({ code: "", label: "21K", distance_km: null, base_price: 150000, slots_total: 100 }).success).toBe(false);
  expect(categoryInputSchema.safeParse({ code: "21k", label: "21K", distance_km: null, base_price: -1, slots_total: 100 }).success).toBe(false);
});
it("addon rejects negative price", () => {
  expect(addonInputSchema.safeParse({ name: "Singlet", price: 65000 }).success).toBe(true);
  expect(addonInputSchema.safeParse({ name: "Singlet", price: -5 }).success).toBe(false);
});
```

- [ ] **Step 4: Run** — `cd apps/web && pnpm test -- validation`. Expected: PASS. Then `pnpm typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/validation.ts apps/web/src/__tests__/validation.test.ts pnpm-lock.yaml
git commit -m "feat(admin): event/category/addon zod validators (web)"
```

---

## Task 3: Web — write helpers + editor fetch

**Files:**
- Create: `apps/web/src/lib/eventWrites.ts`, `apps/web/src/__tests__/event-writes.test.ts`
- Modify: `apps/web/src/lib/events.ts` (add `useEventForEditor`)

**Interfaces:**
- Consumes: `supabase` (`lib/supabase`); validation types (Task 2).
- Produces: types `CategoryDraft`, `AddonDraft`, `EventDraft`; `saveEvent(args) → Promise<{ eventId: string; childErrors: string[] }>`; `rescheduleEvent(id, currentDate, newDate, note) → Promise<{ error?: string }>`; `cancelEvent(id, note) → Promise<{ error?: string }>`; `useEventForEditor(id?) → { data?: EditorData, isLoading }`.

- [ ] **Step 1: Add `useEventForEditor` to `apps/web/src/lib/events.ts`** (append):

```ts
export type EditorEvent = {
  id: string; org_id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null; hero_image_url: string | null;
};
export type EditorCategory = { id: string; code: string; label: string; distance_km: number | null; base_price: number; slots_total: number; slots_taken: number };
export type EditorAddon = { id: string; name: string; price: number };
export type EditorData = { event: EditorEvent; categories: EditorCategory[]; addons: EditorAddon[] };

export function useEventForEditor(id?: string) {
  return useQuery<EditorData | null>({
    queryKey: ["event-editor", id],
    enabled: !!id,
    queryFn: async () => {
      const ev = await supabase.from("events")
        .select("id,org_id,name,place,region,event_date,flag_off,status,elevation_gain_m,cutoff_hours,description,hero_image_url")
        .eq("id", id!).single();
      if (ev.error) throw ev.error;
      const cats = await supabase.from("categories").select("id,code,label,distance_km,base_price,slots_total,slots_taken").eq("event_id", id!).order("base_price", { ascending: false });
      if (cats.error) throw cats.error;
      const adds = await supabase.from("addons").select("id,name,price").eq("event_id", id!).order("created_at");
      if (adds.error) throw adds.error;
      return { event: ev.data as EditorEvent, categories: (cats.data ?? []) as EditorCategory[], addons: (adds.data ?? []) as EditorAddon[] };
    },
  });
}
```

- [ ] **Step 2: Write the failing test** — `apps/web/src/__tests__/event-writes.test.ts`:

```ts
import { reconcileChildren } from "../lib/eventWrites";

it("reconcile computes insert/update/delete by id", () => {
  const original = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const current = [{ id: "a", v: 1 }, { id: "c", v: 9 }, { tempId: "t1", v: 2 }];
  const r = reconcileChildren(original, current);
  expect(r.toInsert.map((x) => (x as { v: number }).v)).toEqual([2]);   // the temp row
  expect(r.toUpdate.map((x) => x.id).sort()).toEqual(["a", "c"]);        // present real ids
  expect(r.toDelete).toEqual(["b"]);                                     // original id no longer present
});
```

- [ ] **Step 3: Run to verify it fails** — `cd apps/web && pnpm test -- event-writes`. Expected: FAIL (no `reconcileChildren`).

- [ ] **Step 4: `apps/web/src/lib/eventWrites.ts`**

```ts
import { supabase } from "./supabase";

export type CategoryDraft = { id?: string; tempId?: string; code: string; label: string; distance_km: number | null; base_price: number; slots_total: number };
export type AddonDraft = { id?: string; tempId?: string; name: string; price: number };
export type EventDraft = {
  id?: string; org_id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null; hero_image_url: string | null;
};

type WithId = { id?: string };
export function reconcileChildren<T extends WithId>(original: WithId[], current: T[]) {
  const currentIds = new Set(current.filter((c) => c.id).map((c) => c.id));
  return {
    toInsert: current.filter((c) => !c.id),
    toUpdate: current.filter((c) => c.id) as (T & { id: string })[],
    toDelete: original.filter((o) => o.id && !currentIds.has(o.id)).map((o) => o.id!) as string[],
  };
}

const EVENT_COLS = (e: EventDraft) => ({
  org_id: e.org_id, name: e.name, place: e.place, region: e.region, event_date: e.event_date,
  flag_off: e.flag_off, status: e.status, elevation_gain_m: e.elevation_gain_m, cutoff_hours: e.cutoff_hours,
  description: e.description, hero_image_url: e.hero_image_url,
});

export async function saveEvent(args: {
  event: EventDraft;
  categories: { current: CategoryDraft[]; original: { id?: string }[] };
  addons: { current: AddonDraft[]; original: { id?: string }[] };
}): Promise<{ eventId: string; childErrors: string[] }> {
  const { event } = args;
  let eventId = event.id;
  if (!eventId) {
    const ins = await supabase.from("events").insert(EVENT_COLS(event)).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    eventId = ins.data!.id;
  } else {
    const upd = await supabase.from("events").update(EVENT_COLS(event)).eq("id", eventId);
    if (upd.error) throw new Error(upd.error.message);
  }

  const childErrors: string[] = [];
  const cat = reconcileChildren(args.categories.original, args.categories.current);
  for (const c of cat.toInsert) {
    const r = await supabase.from("categories").insert({ org_id: event.org_id, event_id: eventId, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total });
    if (r.error) childErrors.push(`Category "${c.label}": ${r.error.message}`);
  }
  for (const c of cat.toUpdate) {
    const r = await supabase.from("categories").update({ code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total }).eq("id", c.id);
    if (r.error) childErrors.push(`Category "${c.label}": ${r.error.message}`);
  }
  for (const id of cat.toDelete) {
    const r = await supabase.from("categories").delete().eq("id", id);
    if (r.error) childErrors.push(`Couldn't remove a category — it has registrations.`);
  }

  const add = reconcileChildren(args.addons.original, args.addons.current);
  for (const a of add.toInsert) {
    const r = await supabase.from("addons").insert({ org_id: event.org_id, event_id: eventId, name: a.name, price: a.price });
    if (r.error) childErrors.push(`Add-on "${a.name}": ${r.error.message}`);
  }
  for (const a of add.toUpdate) {
    const r = await supabase.from("addons").update({ name: a.name, price: a.price }).eq("id", a.id);
    if (r.error) childErrors.push(`Add-on "${a.name}": ${r.error.message}`);
  }
  for (const id of add.toDelete) {
    const r = await supabase.from("addons").delete().eq("id", id);
    if (r.error) childErrors.push(`Couldn't remove an add-on.`);
  }

  return { eventId: eventId!, childErrors };
}

export async function rescheduleEvent(id: string, currentDate: string | null, newDate: string, note: string): Promise<{ error?: string }> {
  const r = await supabase.from("events").update({ original_date: currentDate, event_date: newDate, status_note: note || null }).eq("id", id);
  return r.error ? { error: r.error.message } : {};
}
export async function cancelEvent(id: string, note: string): Promise<{ error?: string }> {
  const r = await supabase.from("events").update({ status: "cancelled", status_note: note || null }).eq("id", id);
  return r.error ? { error: r.error.message } : {};
}
```

- [ ] **Step 5: Run to verify it passes** — `cd apps/web && pnpm test -- event-writes`. Expected: PASS. Then `pnpm typecheck` → 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/eventWrites.ts apps/web/src/lib/events.ts apps/web/src/__tests__/event-writes.test.ts
git commit -m "feat(admin): event write helpers (save + child reconcile, reschedule, cancel) + editor fetch"
```

---

## Task 4: Web — the Create / Edit event page

**Files:**
- Create: `apps/web/src/routes/EventEditor.tsx`, `apps/web/src/components/CategoryEditor.tsx`, `apps/web/src/components/AddonEditor.tsx`, `apps/web/src/__tests__/event-editor.test.tsx`
- Modify: `apps/web/src/App.tsx` (routes), `apps/web/src/components/TopBar.tsx` (editor titles)

**Interfaces:**
- Consumes: `useEventForEditor` (Task 3), `saveEvent`/`CategoryDraft`/`AddonDraft`/`EventDraft` (Task 3), `eventInputSchema`/`categoryInputSchema`/`addonInputSchema`/`EVENT_STATUSES` (Task 2), `useMyRoles` (Plan 09).
- Produces: `<EventEditor/>` at `/events/new` and `/events/:id/edit`.

- [ ] **Step 1: `apps/web/src/components/CategoryEditor.tsx`**

```tsx
import type { CategoryDraft } from "../lib/eventWrites";

const peso = (c: number) => (c / 100).toString();
const cent = (p: string) => Math.round((parseFloat(p) || 0) * 100);
const inp = { border: "1px solid var(--hairline)", borderRadius: 8, padding: "7px 9px", fontSize: 13, width: "100%" } as const;

export function CategoryEditor({ rows, onChange }: { rows: CategoryDraft[]; onChange: (r: CategoryDraft[]) => void }) {
  const set = (i: number, patch: Partial<CategoryDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { tempId: `t${Date.now()}${rows.length}`, code: "", label: "", distance_km: null, base_price: 0, slots_total: 0 }]);
  return (
    <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Categories</div>
        <button onClick={add} style={{ color: "var(--primary)", fontSize: 12, fontWeight: 600, background: "none", border: 0, cursor: "pointer" }}>+ Add</button>
      </div>
      {rows.map((r, i) => (
        <div key={r.id ?? r.tempId} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr 1fr 1fr auto", gap: 8, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--row-border)" }}>
          <input aria-label="Category code" placeholder="21k" style={inp} value={r.code} onChange={(e) => set(i, { code: e.target.value })} />
          <input aria-label="Category label" placeholder="21K" style={inp} value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input aria-label="Distance km" placeholder="km" type="number" style={inp} value={r.distance_km ?? ""} onChange={(e) => set(i, { distance_km: e.target.value === "" ? null : Number(e.target.value) })} />
          <input aria-label="Base price" placeholder="₱" type="number" step="0.01" style={inp} value={peso(r.base_price)} onChange={(e) => set(i, { base_price: cent(e.target.value) })} />
          <input aria-label="Slots" placeholder="slots" type="number" style={inp} value={r.slots_total} onChange={(e) => set(i, { slots_total: Number(e.target.value) })} />
          <button aria-label="Remove category" onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ color: "var(--danger)", background: "none", border: 0, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `apps/web/src/components/AddonEditor.tsx`**

```tsx
import type { AddonDraft } from "../lib/eventWrites";

const peso = (c: number) => (c / 100).toString();
const cent = (p: string) => Math.round((parseFloat(p) || 0) * 100);
const inp = { border: "1px solid var(--hairline)", borderRadius: 8, padding: "7px 9px", fontSize: 13, width: "100%" } as const;

export function AddonEditor({ rows, onChange }: { rows: AddonDraft[]; onChange: (r: AddonDraft[]) => void }) {
  const set = (i: number, patch: Partial<AddonDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { tempId: `t${Date.now()}${rows.length}`, name: "", price: 0 }]);
  return (
    <div style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Add-ons</div>
        <button onClick={add} style={{ color: "var(--primary)", fontSize: 12, fontWeight: 600, background: "none", border: 0, cursor: "pointer" }}>+ Add</button>
      </div>
      {rows.map((r, i) => (
        <div key={r.id ?? r.tempId} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--row-border)" }}>
          <input aria-label="Add-on name" placeholder="Event singlet" style={inp} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input aria-label="Add-on price" placeholder="₱" type="number" step="0.01" style={inp} value={peso(r.price)} onChange={(e) => set(i, { price: cent(e.target.value) })} />
          <button aria-label="Remove add-on" onClick={() => onChange(rows.filter((_, j) => j !== i))} style={{ color: "var(--danger)", background: "none", border: 0, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `apps/web/src/routes/EventEditor.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMyRoles } from "../lib/roles";
import { useEventForEditor } from "../lib/events";
import { saveEvent, type CategoryDraft, type AddonDraft, type EventDraft } from "../lib/eventWrites";
import { eventInputSchema, categoryInputSchema, addonInputSchema, EVENT_STATUSES } from "../lib/validation";
import { CategoryEditor } from "../components/CategoryEditor";
import { AddonEditor } from "../components/AddonEditor";

const label = { display: "block", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", color: "var(--ink-muted)", marginBottom: 6 } as const;
const input = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", color: "var(--ink)", fontSize: 14, width: "100%" } as const;
const card = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)", padding: 22 } as const;
const blank: EventDraft = { org_id: "", name: "", place: null, region: null, event_date: null, flag_off: null, status: "draft", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null };

export function EventEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const roles = useMyRoles();
  const loaded = useEventForEditor(id);

  const [event, setEvent] = useState<EventDraft>(blank);
  const [cats, setCats] = useState<CategoryDraft[]>([]);
  const [addons, setAddons] = useState<AddonDraft[]>([]);
  const [origCats, setOrigCats] = useState<{ id?: string }[]>([]);
  const [origAddons, setOrigAddons] = useState<{ id?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id && loaded.data) {
      const d = loaded.data;
      setEvent({ ...d.event });
      setCats(d.categories.map((c) => ({ id: c.id, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total })));
      setAddons(d.addons.map((a) => ({ id: a.id, name: a.name, price: a.price })));
      setOrigCats(d.categories.map((c) => ({ id: c.id })));
      setOrigAddons(d.addons.map((a) => ({ id: a.id })));
    }
  }, [id, loaded.data]);

  const orgId = event.org_id || roles.data?.orgId || "";
  const set = (patch: Partial<EventDraft>) => setEvent((e) => ({ ...e, ...patch }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const invalid = useMemo(() => {
    if (!eventInputSchema.safeParse({ ...event }).success) return "Fix the event fields (name is required, valid date/time).";
    for (const c of cats) if (!categoryInputSchema.safeParse(c).success) return "Fix the category rows (code, label, non-negative price/slots).";
    for (const a of addons) if (!addonInputSchema.safeParse(a).success) return "Fix the add-on rows (name, non-negative price).";
    return null;
  }, [event, cats, addons]);

  async function onSave() {
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(null);
    try {
      const res = await saveEvent({ event: { ...event, id, org_id: orgId }, categories: { current: cats, original: origCats }, addons: { current: addons, original: origAddons } });
      if (res.childErrors.length) { setError(res.childErrors.join(" ")); setBusy(false); return; }
      nav("/events");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  if (id && loaded.isLoading) return <div style={{ padding: "26px 30px" }}>Loading…</div>;

  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Event details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
            <div><span style={label}>EVENT NAME</span><input aria-label="Event name" style={input} value={event.name} onChange={(e) => set({ name: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><span style={label}>PLACE</span><input aria-label="Place" style={input} value={event.place ?? ""} onChange={(e) => set({ place: e.target.value || null })} /></div>
              <div><span style={label}>REGION</span><input aria-label="Region" style={input} value={event.region ?? ""} onChange={(e) => set({ region: e.target.value || null })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><span style={label}>DATE</span><input aria-label="Date" placeholder="YYYY-MM-DD" style={input} value={event.event_date ?? ""} onChange={(e) => set({ event_date: e.target.value || null })} /></div>
              <div><span style={label}>FLAG-OFF</span><input aria-label="Flag-off" placeholder="HH:MM" style={input} value={event.flag_off ?? ""} onChange={(e) => set({ flag_off: e.target.value || null })} /></div>
              <div><span style={label}>STATUS</span>
                <select aria-label="Status" style={input} value={event.status} onChange={(e) => set({ status: e.target.value })}>
                  {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><span style={label}>ELEVATION GAIN (M)</span><input aria-label="Elevation gain" type="number" style={input} value={event.elevation_gain_m ?? ""} onChange={(e) => set({ elevation_gain_m: num(e.target.value) })} /></div>
              <div><span style={label}>CUTOFF (HOURS)</span><input aria-label="Cutoff hours" type="number" style={input} value={event.cutoff_hours ?? ""} onChange={(e) => set({ cutoff_hours: num(e.target.value) })} /></div>
            </div>
            <div><span style={label}>DESCRIPTION</span><textarea aria-label="Description" style={{ ...input, height: 82, resize: "vertical" }} value={event.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} /></div>
            <div><span style={label}>HERO IMAGE URL</span><input aria-label="Hero image URL" placeholder="https://…" style={input} value={event.hero_image_url ?? ""} onChange={(e) => set({ hero_image_url: e.target.value || null })} /></div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CategoryEditor rows={cats} onChange={setCats} />
          <AddonEditor rows={addons} onChange={setAddons} />
        </div>
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {error ? <span style={{ color: "var(--danger)", fontSize: 13, marginRight: "auto" }}>{error}</span> : null}
          <button onClick={() => nav("/events")} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", color: "var(--ink)", fontSize: 14, fontWeight: 600, padding: "11px 22px", borderRadius: "var(--radius-pill)", cursor: "pointer" }}>Cancel</button>
          <button onClick={onSave} disabled={busy} style={{ background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 600, padding: "11px 26px", borderRadius: "var(--radius-pill)", border: 0, cursor: "pointer" }}>{busy ? "Saving…" : "Save event"}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire routes** — in `apps/web/src/App.tsx` add `import { EventEditor } from "./routes/EventEditor";` and, right after the `events` route (line ~29):

```tsx
            <Route path="events/new" element={<EventEditor />} />
            <Route path="events/:id/edit" element={<EventEditor />} />
```

- [ ] **Step 5: Editor titles in `apps/web/src/components/TopBar.tsx`** — replace the `const title = …` line with:

```tsx
  const title = pathname === "/events/new" ? "Create event"
    : /^\/events\/[^/]+\/edit$/.test(pathname) ? "Edit event"
    : TITLES[pathname] ?? "Dashboard";
```

- [ ] **Step 6: Write the failing test** — `apps/web/src/__tests__/event-editor.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EventEditor } from "../routes/EventEditor";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("../lib/events", () => ({ useEventForEditor: () => ({ data: null, isLoading: false }) }));
const mockSave = vi.fn().mockResolvedValue({ eventId: "e1", childErrors: [] });
vi.mock("../lib/eventWrites", async (orig) => ({ ...(await orig()), saveEvent: (a: unknown) => mockSave(a) }));
const mockNav = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig()), useNavigate: () => mockNav, useParams: () => ({}) }));

it("blocks save on an empty name, then saves a valid new event", async () => {
  render(<MemoryRouter><EventEditor /></MemoryRouter>);
  fireEvent.click(screen.getByText("Save event"));
  expect(await screen.findByText(/Fix the event fields/)).toBeInTheDocument();
  expect(mockSave).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Apo Sky Ultra" } });
  fireEvent.click(screen.getByText("Save event"));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());
  expect(mockSave.mock.calls[0][0].event).toMatchObject({ name: "Apo Sky Ultra", org_id: "a1", status: "draft" });
});
```

- [ ] **Step 7: Run** — `cd apps/web && pnpm test -- event-editor`. Expected: PASS. Then `pnpm typecheck` → 0.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/routes/EventEditor.tsx" apps/web/src/components/CategoryEditor.tsx apps/web/src/components/AddonEditor.tsx apps/web/src/App.tsx apps/web/src/components/TopBar.tsx apps/web/src/__tests__/event-editor.test.tsx
git commit -m "feat(admin): create/edit event page with categories + add-ons sub-editors"
```

---

## Task 5: Web — reschedule/cancel modals + Events-list actions

**Files:**
- Create: `apps/web/src/components/RescheduleModal.tsx`, `apps/web/src/components/CancelModal.tsx`, `apps/web/src/__tests__/events-actions.test.tsx`
- Modify: `apps/web/src/routes/Events.tsx` (wire "+ Create event" + row ⋯ menu)

**Interfaces:**
- Consumes: `rescheduleEvent`/`cancelEvent` (Task 3); `useNavigate` + `useQueryClient`.
- Produces: `<RescheduleModal event onClose onDone/>`, `<CancelModal event onClose onDone/>`; a row ⋯ menu on the Events list (Edit / Reschedule / Cancel).

- [ ] **Step 1: `apps/web/src/components/RescheduleModal.tsx`**

```tsx
import { useState } from "react";
import { rescheduleEvent } from "../lib/eventWrites";

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center", zIndex: 50 } as const;
const box = { width: 380, background: "var(--canvas)", borderRadius: 16, padding: 24 } as const;
const input = { border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", fontSize: 14, width: "100%" } as const;

export function RescheduleModal({ event, onClose, onDone }: { event: { id: string; event_date: string | null }; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError("Enter a date as YYYY-MM-DD"); return; }
    setBusy(true); setError(null);
    const { error } = await rescheduleEvent(event.id, event.event_date, date, note);
    setBusy(false);
    if (error) setError(error); else { onDone(); onClose(); }
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Reschedule event</div>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <input aria-label="New date" placeholder="YYYY-MM-DD" style={input} value={date} onChange={(e) => setDate(e.target.value)} />
          <input aria-label="Note" placeholder="Note (optional)" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "9px 18px", fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={submit} disabled={busy} style={{ background: "var(--primary)", color: "#fff", border: 0, borderRadius: "var(--radius-pill)", padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>{busy ? "Saving…" : "Reschedule"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `apps/web/src/components/CancelModal.tsx`**

```tsx
import { useState } from "react";
import { cancelEvent } from "../lib/eventWrites";

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "grid", placeItems: "center", zIndex: 50 } as const;
const box = { width: 380, background: "var(--canvas)", borderRadius: 16, padding: 24 } as const;
const input = { border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", fontSize: 14, width: "100%" } as const;

export function CancelModal({ event, onClose, onDone }: { event: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await cancelEvent(event.id, note);
    setBusy(false);
    if (error) setError(error); else { onDone(); onClose(); }
  }
  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Cancel “{event.name}”?</div>
        <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>Registrations are kept; refunds are handled from Payments.</p>
        <div style={{ display: "grid", gap: 12 }}>
          <input aria-label="Cancel note" placeholder="Reason (optional)" style={input} value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <span style={{ color: "var(--danger)", fontSize: 13 }}>{error}</span> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button onClick={onClose} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-pill)", padding: "9px 18px", fontWeight: 600, cursor: "pointer" }}>Keep it</button>
            <button onClick={submit} disabled={busy} style={{ background: "var(--danger)", color: "#fff", border: 0, borderRadius: "var(--radius-pill)", padding: "9px 20px", fontWeight: 600, cursor: "pointer" }}>{busy ? "Cancelling…" : "Cancel event"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the Events list** — in `apps/web/src/routes/Events.tsx`: add imports, a `useNavigate` + `useQueryClient`, per-row `⋯` state, and the modals. Add at the top:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { RescheduleModal } from "../components/RescheduleModal";
import { CancelModal } from "../components/CancelModal";
```

In `Events()`, add:

```tsx
  const nav = useNavigate();
  const qc = useQueryClient();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ kind: "reschedule" | "cancel"; ev: AdminEventRow } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["org-events"] });
```

Change the "+ Create event" button's tag to `onClick={() => nav("/events/new")}` (remove the `title` note). Add a final cell to each row (and a matching header `<span></span>` + widen `GRID` to end with ` auto`):

```tsx
              <div style={{ position: "relative", textAlign: "right" }}>
                <button aria-label={`Actions for ${e.name}`} onClick={() => setMenuId(menuId === e.id ? null : e.id)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--ink-muted)", fontSize: 18 }}>⋯</button>
                {menuId === e.id ? (
                  <div style={{ position: "absolute", right: 0, top: 24, background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.12)", zIndex: 20, minWidth: 140 }}>
                    <button style={menuItem} onClick={() => { setMenuId(null); nav(`/events/${e.id}/edit`); }}>Edit</button>
                    <button style={menuItem} onClick={() => { setMenuId(null); setModal({ kind: "reschedule", ev: e }); }}>Reschedule</button>
                    <button style={{ ...menuItem, color: "var(--danger)" }} onClick={() => { setMenuId(null); setModal({ kind: "cancel", ev: e }); }}>Cancel event</button>
                  </div>
                ) : null}
              </div>
```

Add the modal render before the closing `</Wrap>` and the `menuItem` style:

```tsx
      {modal?.kind === "reschedule" ? <RescheduleModal event={modal.ev} onClose={() => setModal(null)} onDone={refresh} /> : null}
      {modal?.kind === "cancel" ? <CancelModal event={modal.ev} onClose={() => setModal(null)} onDone={refresh} /> : null}
```
```tsx
const menuItem = { display: "block", width: "100%", textAlign: "left", background: "none", border: 0, padding: "9px 14px", fontSize: 13, cursor: "pointer" } as const;
```
Update `GRID` to `"2.4fr 1.2fr 1fr .9fr .8fr auto"` and add a trailing `<span></span>` to the thead row.

- [ ] **Step 4: Write the failing test** — `apps/web/src/__tests__/events-actions.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CancelModal } from "../components/CancelModal";

const mockCancel = vi.fn().mockResolvedValue({});
vi.mock("../lib/eventWrites", () => ({ cancelEvent: (id: string, note: string) => mockCancel(id, note) }));

it("cancel modal calls cancelEvent then onDone", async () => {
  const onClose = vi.fn(), onDone = vi.fn();
  render(<CancelModal event={{ id: "e1", name: "Apo Sky Ultra" }} onClose={onClose} onDone={onDone} />);
  expect(screen.getByText(/Cancel “Apo Sky Ultra”/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Cancel note"), { target: { value: "weather" } });
  fireEvent.click(screen.getByText("Cancel event"));
  await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("e1", "weather"));
  expect(onDone).toHaveBeenCalled();
});
```

- [ ] **Step 5: Run** — `cd apps/web && pnpm test`. Expected: whole suite PASS (existing + validation + event-writes + event-editor + events-actions). Then `pnpm typecheck` → 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/RescheduleModal.tsx apps/web/src/components/CancelModal.tsx apps/web/src/routes/Events.tsx apps/web/src/__tests__/events-actions.test.tsx
git commit -m "feat(admin): reschedule/cancel modals + Events list row actions + create wiring"
```

---

## Final verification (after all tasks)

- [ ] **Backend** (root, stack up): `pnpm test` → all green incl. `admin-events` (writes, draft-delete, FK block, runner-blocked) + `admin-roles` unaffected.
- [ ] **Web + types:** `cd apps/web && pnpm test` → all green; `pnpm typecheck` → 0; root `pnpm -r typecheck` → clean.
- [ ] **End-to-end** (`docker compose up` + stack up, at `https://admin.racepace.lan`, signed in as `admin@runwithpoint.test`):
  1. Events → **+ Create event** → fill name + date + a category + an add-on → **Save event** → lands back on Events with the new **draft** row.
  2. Row **⋯ → Edit** → change a field + add a category → Save → reflected.
  3. Row **⋯ → Reschedule** → new date → the row shows "· was …".
  4. Row **⋯ → Cancel event** → the row shows the **Cancelled** chip.
  5. Try to remove a category that has registrations (on a seeded event) → friendly "has registrations" error, row kept.
- [ ] **Docs:** add Plan 10 to `docs/README.md` roadmap (mark built). Commit.
- [ ] Then use **superpowers:finishing-a-development-branch**.

## Notes / decisions baked in

- **Validators are local** (`apps/web/src/lib/validation.ts` + a `zod` dep), NOT `@race-pace/shared` — they're admin-only and this avoids adding a workspace-TS dependency to the Dockerized Vite app. *(Deviation from the spec §6/§10, which named `@race-pace/shared`; flagged at plan handoff. If cross-surface reuse arrives, hoist them then.)*
- **Task 1 also adds `addons_read_org_admin`** — a gap from Plan 09 (events+categories had admin-read, addons didn't) that the editor needs to load a draft event's add-ons.
- **Money:** the DB stores integer centavos; the editor price fields edit pesos (`value = centavos/100`, `onChange = Math.round(pesos*100)`).
- **`status` select excludes `cancelled`** (set only via the Cancel modal); events hard-delete is draft-only (RLS), published events are cancel-only.
- **Child reconcile** is pure (`reconcileChildren`, unit-tested); a category delete blocked by the registrations FK surfaces as a friendly message and keeps the row.
- **Deferred:** custom-field editor → Plan 11; real hero/gallery upload → a Storage plan; registrations/payments/refunds + gross ₱ + the row menu beyond Edit/Reschedule/Cancel → Plan 11.
```
