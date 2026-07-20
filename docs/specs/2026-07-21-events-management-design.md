# Admin — Events Management (core CRUD + lifecycle) — Design Spec (Plan 10; M3)

- **Status:** Approved (brainstorm 2026-07-21)
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Relates to:** [Plan 09 admin foundation](2026-07-20-admin-foundation-design.md) (roles, `auth_can_admin_org`, read-only Events list); the Create/Edit-event, Reschedule/Cancel screens in [screen-design-brief](../design/2026-07-20-screen-design-brief.md) §4; the `Race Pace Admin` handover mockup (Event editor)

## 1. Goal

Give org admins the **first write path** in the admin console: create and edit events with their **categories** and **add-ons**, and manage the event **lifecycle** (reschedule, cancel). Turns the Plan 09 read-only Events list into a working management screen. This is the second slice of M3.

Today events/categories/addons are **read-only** (Plan 09 added admin *read* of drafts; there are no write policies and `authenticated` holds only `grant select`). This plan adds the write policies, grants, the editor page, and the reschedule/cancel modals.

## 2. Decisions (from brainstorm)

1. **Direct `supabase-js` writes gated by RLS** — not an Edge Function. Admin content editing is trusted + org-scoped; the client writes directly, validated by shared Zod + DB constraints. (Registration *checkout* stays an Edge Function because it's untrusted runners + slot-holding + payment; admin content editing is neither.)
2. **Events are cancel-only; hard-delete is draft-only.** `registrations.event_id` cascades, so deleting a *published* event would wipe registrations — the DELETE policy is gated to `status='draft'` (drafts never have registrations). Published events end via **Cancel** (status).
3. **Category/add-on writes key on the parent event's org** (`auth_can_admin_org((select org_id from events where id = event_id))`), so an admin can only touch children of their own org's events. Deleting a category that has registrations is blocked by the existing FK (`registrations.category_id` is `NO ACTION`) → surfaced as a friendly error.
4. **Single "Save event" with by-id child reconcile** (new→insert, changed→update, removed→delete) — matches the handover's one-Save editor.
5. **Hero image is a pasted URL for now.** Real hero/gallery upload (Supabase Storage — not configured today) is a separate plan. `PLACE`/`REGION` are the legacy free-text fields (the structured PSGC picker for admin is a later enhancement, per the Plan 08 deferral).
6. **Custom-field editor is deferred to Plan 11** (form_fields stays read-only here).

## 3. Backend — write RLS + grants

New migration (additive; **do not** touch the existing `*_read_published` / `*_read_org_admin` policies). Reuses the Plan 09 `security definer` helper `auth_can_admin_org(uuid)`.

```sql
-- events: admins create/update their org's events; hard-delete drafts only.
create policy "events_insert_org_admin" on events for insert
  with check (auth_can_admin_org(org_id));
create policy "events_update_org_admin" on events for update
  using (auth_can_admin_org(org_id)) with check (auth_can_admin_org(org_id));
create policy "events_delete_org_admin_draft" on events for delete
  using (auth_can_admin_org(org_id) and status = 'draft');

-- categories + addons: gated by the PARENT EVENT's org (source of truth).
create policy "categories_insert_org_admin" on categories for insert
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "categories_update_org_admin" on categories for update
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)))
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "categories_delete_org_admin" on categories for delete
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)));
-- addons: the same three policies, s/categories/addons/.

grant insert, update, delete on events, categories, addons to authenticated;
```

- **`form_fields` gets no write policy here** (Plan 11).
- The app sets a child row's `org_id` to the parent event's `org_id` on insert (denormalized column kept consistent; RLS keys on the event's org regardless).

## 4. Editor page — Create / Edit event

Routes: **`/events/new`** and **`/events/:id/edit`** (full-page, matching the handover). Reached from the Events list's now-functional **"+ Create event"** and a row **⋯ → Edit**. Layout (grid `1.4fr 1fr`):

**Left — "Event details" card** (maps to `events` columns):

| Field | Column | Input |
| --- | --- | --- |
| EVENT NAME | `name` | text (required) |
| PLACE / REGION | `place` / `region` | text, text |
| DATE / FLAG-OFF / STATUS | `event_date` / `flag_off` / `status` | date, time, select (`draft/open/almost_full/closed/completed`; `cancelled` is set via the Cancel modal, not here) |
| ELEVATION GAIN (M) / CUTOFF (HOURS) | `elevation_gain_m` / `cutoff_hours` | number, number |
| DESCRIPTION | `description` | textarea |
| HERO IMAGE | `hero_image_url` | text (URL) — real upload deferred |

**Right — sub-editors** (stacked cards):
- **Categories** — "+ Add" + rows of `{ code, label, distance_km, base_price (₱ centavos), slots_total }`. `slots_taken` is read-only (shown, never edited). Remove per row.
- **Add-ons** — "+ Add" + rows of `{ name, price (₱ centavos) }`. Remove per row.
- (Custom registration fields card is shown in the handover but **out of scope → Plan 11**.)

**Bottom bar:** Cancel (back to list) · **Save event**.

**Save (one action, by-id reconcile):**
1. **Event:** new (no id) → `insert` (defaults `status='draft'`), capture the new id; edit → `update` the event columns.
2. **Categories & add-ons:** compare the editor list against what was loaded —
   - client-only rows (temp id) → `insert` with `event_id` + `org_id`;
   - existing rows (real id, still present) → `update`;
   - loaded rows now absent → `delete` (a category with registrations fails the FK → caught, surfaced as "Can't remove — has registrations", row kept).
3. On success → navigate back to the Events list (the list re-queries).

State handling: loading (edit fetches the event + its categories/addons), saving (button busy), and per-field validation errors (§6). A failed child delete does not abort the rest; it reports which row couldn't be removed.

## 5. Reschedule / Cancel (lifecycle modals)

Triggered from the Events-list row **⋯** menu (wired in this plan) — and optionally from the editor.

- **Reschedule** — inputs: new date (required) + optional note. Writes `original_date := (current) event_date`, `event_date := new`, `status_note := note`. The runner app already renders "Rescheduled — was …" from `original_date`.
- **Cancel** — confirm (red) + optional note. Writes `status := 'cancelled'`, `status_note := note`. The runner app already renders the cancelled banner. Registrations are untouched (refunds are Plan 11).

Both are `update`s under `events_update_org_admin`.

## 6. Validation + shared types

In `@race-pace/shared` (framework-neutral; reused by the editor; DB constraints are the backstop):

```ts
// integer centavos for money; ints ≥ 0 where noted
eventInput:    { name: nonempty; place/region/description/hero_image_url: string|null;
                 event_date: 'YYYY-MM-DD'|null; flag_off: 'HH:MM'|null; status: enum;
                 elevation_gain_m/cutoff_hours: int≥0|null }
categoryInput: { code: nonempty; label: nonempty; distance_km: number≥0|null;
                 base_price: int≥0; slots_total: int≥0 }
addonInput:    { name: nonempty; price: int≥0 }
```

The editor blocks Save on invalid input and shows per-field messages.

## 7. Edge cases & error handling

| Case | Behavior |
| --- | --- |
| Admin edits another org's event (crafted request) | RLS `with check` rejects → error surfaced; UI never offers it (list is org-scoped) |
| Delete a **published** event | No DELETE policy path (gated to `draft`) → blocked |
| Remove a category with registrations | FK (`registrations.category_id`) blocks the delete → "Can't remove — has registrations"; row stays |
| Remove an add-on | No FK from registrations (add-ons snapshot into `custom_data`) → deletes cleanly |
| New event with no categories | Allowed (draft); can be added later. Publishing rules (must have ≥1 category) are **not** enforced here |
| Reschedule to an earlier/invalid date | Validated (valid date); no business rule beyond that this plan |
| Concurrent `slots_taken` | Never written by the editor (read-only display); registrations own it |
| Non-admin (runner) attempts a write | No write policy matches → rejected |

## 8. Testing

- **Backend (root Vitest, live stack)** — mirrors `admin-roles.test.ts` style:
  - An org admin `insert`s an event + a category + an add-on for **their** org; `update`s them; a runner (no role) cannot; an admin of **another** org cannot write to this org's event/children.
  - `delete` a **draft** event succeeds; `delete` a non-draft is blocked; `delete` a category that has a registration is blocked (FK), an unreferenced one succeeds.
  - Reschedule/Cancel `update`s set `original_date`/`event_date`/`status`/`status_note` as specified.
- **Web (Vitest + RTL, jsdom)** — mock supabase + the router:
  - Editor renders the event form + Categories/Add-ons sub-editors; blocks Save on invalid input (empty name, negative price); a valid Save issues the expected insert/update calls.
  - The child reconcile computes add/update/remove correctly from a before/after list.
  - Reschedule and Cancel modals call `update` with the right fields; a category-delete FK error surfaces without losing the row.
- **Shared (Vitest)** — the three Zod validators accept valid input and reject the documented invalids.

## 9. Out of scope (later plans)

- **Custom-field editor** (form_fields: reorderable typed fields) → **Plan 11**.
- **Real hero/gallery image upload** (Supabase Storage bucket + policies + upload UI) → its own plan; `hero_image_url` is a pasted URL until then.
- **Registrations / Payments / refunds**, gross ₱ on the list, the ⋯ menu's non-lifecycle actions → **Plan 11**.
- **Structured PSGC address picker** for admin event creation (place/region stay free text here).
- **Publish-time business rules** (e.g., "must have ≥1 category / a date before opening").

## 10. File touch-list (for writing-plans)

- **Create (backend):** migration — write RLS (events insert/update/delete-draft; categories/addons insert/update/delete) + grants · `supabase/tests/admin-events.test.ts`.
- **Create (shared):** `eventInput`/`categoryInput`/`addonInput` Zod schemas + types in `packages/shared/src/index.ts` (+ tests).
- **Create (web):** `apps/web/src/routes/EventEditor.tsx` (create/edit) · `apps/web/src/components/CategoryEditor.tsx` · `AddonEditor.tsx` · `RescheduleModal.tsx` · `CancelModal.tsx` · `apps/web/src/lib/eventWrites.ts` (upsert event + reconcile children; reschedule/cancel) · web tests.
- **Modify (web):** `apps/web/src/lib/events.ts` (a single-event fetch with categories+addons for the editor; extend `AdminEventRow`/query as needed) · `apps/web/src/routes/Events.tsx` (wire "+ Create event" → `/events/new`; add the row ⋯ menu → Edit / Reschedule / Cancel) · `apps/web/src/App.tsx` (routes `/events/new`, `/events/:id/edit`).
- **Docs:** add Plan 10 to `docs/plans/` and to the `docs/README.md` roadmap.
