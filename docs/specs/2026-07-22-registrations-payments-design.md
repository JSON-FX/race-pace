# Admin — Registrations & Payments (roster + detail + admin refunds) — Design Spec (Plan 13; M3)

- **Status:** Approved (brainstorm 2026-07-22)
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Relates to:** [Plan 09 admin foundation](2026-07-20-admin-foundation-design.md) (roles, `auth_can_admin_org`, RequireAdmin shell); [Plan 10 events management](2026-07-21-events-management-design.md) (the editor + `CancelModal`'s "refunds are handled from Payments" hint); the `registrations` / `registration_addons` / `payments` schema (`20260718183018_registrations_payments.sql`) and the paid-transition `confirmPayment` (`supabase/functions/_shared/confirm.ts`). **Supersedes** the "Registrations / Payments / refunds → Plan 11" deferral in the Plan 10 spec §9 (that item renumbered to **Plan 13**).

## 1. Goal

Give org admins the **first read + action path over registration data**: see **who registered** for each of their events, with **payment status**, and **issue refunds**. Today the whole registration graph is **runner-only** — `registrations`, `registration_addons`, `payments`, and `profiles` each carry a single `*_read_own` policy (`auth.uid() = user_id` / self), so an admin cannot see another runner's registration at all. This plan adds org-scoped admin **read** policies, a refund **Edge Function**, and the **Registrations** + **Payments** console surfaces (today `Placeholder` stubs). Next slice of M3, after foundation (09), events (10), images (11), and structured inputs (12).

## 2. Decisions (from brainstorm)

1. **Registrations-first IA.** `/registrations` is the primary surface (event-scoped roster + detail); the **refund action lives in the registration detail**. `/payments` is a **read-only** org-wide money projection of the same rows that links back into the detail. A payment is 1:1 with a registration (`payments.unique(registration_id)`), so these are two views of one graph, not two data models.
2. **Event-scoped roster.** The admin picks an event (selector, deep-linkable `/registrations?event=<id>`; also reachable from an Events-list row **"View registrations"**), then sees that event's registrations. Filters within: payment status, category, name search. A **registration count** shows on each Events-list row.
3. **Name + bib only → pure-RLS reads.** The roster shows `full_name` + `bib_name` from `profiles` via a new `profiles_read_org_admin` policy; the entire read path stays direct RLS queries (no service-role read, no view). **Email is out** — it lives in `auth.users` (not client-readable via RLS) and is deferred to a later plan (export/comms) that adds a scoped `security definer` view.
4. **Refund = full, frees the slot.** A refund flips `payments.status` and `registrations.status` to `refunded` and **decrements the category `slots_taken`** (the spot reopens; keeps the runner-facing "spots left" honest). **Full amount only** (no partial), **only on a `paid` registration**, **idempotent** (re-running on an already-`refunded` row is a no-op), optional admin note. No enum/column migration — `refunded` already exists in both `registration_status` and `payment_status`; note metadata rides in `payments.raw`.
5. **Refund via an `admin-refund` Edge Function** (service-role), mirroring `confirmPayment`. A refund is a **money + slot** state transition (and the future PayMongo refund call needs a server secret), so it belongs in the Edge/`_shared` layer with checkout/confirm — **not** the direct-RLS path Plan 10 uses for trusted content editing. The org-admin authorization is enforced **inside the function** (service-role bypasses RLS).
6. **Two-step roster read.** There is **no FK** `registrations → profiles` (both reference `auth.users`), so PostgREST cannot embed the runner. The hook does ① registrations with `categories` + `payments` embedded (those FKs exist), then ② `profiles` for the distinct `user_id`s, merged client-side. Both queries are RLS-gated.

## 3. Backend — admin read RLS + slot RPC + grants

New migration (**additive**; do **not** touch the existing `*_read_own` policies — RLS policies are OR'd, so runners keep self-access). Reuses the Plan 09 `security definer` helper `auth_can_admin_org(uuid)`.

```sql
-- Org admins READ their org's registration graph (runner *_read_own stays intact).
create policy "registrations_read_org_admin" on registrations for select
  using (auth_can_admin_org(org_id));

create policy "payments_read_org_admin" on payments for select
  using (auth_can_admin_org(org_id));                        -- payments has org_id directly

create policy "registration_addons_read_org_admin" on registration_addons for select
  using (exists (select 1 from registrations r
                 where r.id = registration_addons.registration_id
                   and auth_can_admin_org(r.org_id)));

-- Admin reads the profile (name/bib) of anyone who registered in their org — and ONLY them.
create policy "profiles_read_org_admin" on profiles for select
  using (exists (select 1 from registrations r
                 where r.user_id = profiles.id
                   and auth_can_admin_org(r.org_id)));

-- Slot release on refund — mirror of increment_slot; floored at 0 (defensive).
create or replace function decrement_slot(p_category_id uuid)
returns void language sql as $$
  update categories set slots_taken = greatest(slots_taken - 1, 0) where id = p_category_id;
$$;
grant execute on function decrement_slot(uuid) to service_role;  -- only the Edge Function calls it
```

- **No new table grants.** `select` is already granted to `authenticated` on all four tables (init + registrations migrations); these policies only widen row visibility. **No `insert/update` policy** on registrations/payments for admins — the only admin write is the refund, which runs service-role inside the function.
- **No enum/column change.** Refund note + audit ride in `payments.raw` (`{ refunded_at, refunded_by, note }`).

## 4. Edge Function — `admin-refund`

New `supabase/functions/admin-refund/index.ts` + `supabase/functions/_shared/refund.ts` (`refundRegistration()`), structured exactly like `registrations-checkout` + `_shared/confirm.ts` (`serviceClient()`, the `json(body, status)` helper, `db.auth.getUser(jwt)`):

**Input:** `POST { registration_id }`, header `Authorization: Bearer <caller JWT>`.

**Flow:**
1. Read the JWT (`Authorization` → strip `Bearer `); empty → `401`. Parse `registration_id`; missing → `400`.
2. `db.auth.getUser(jwt)` → caller `userId`; error/absent → `401`.
3. Load the registration (service client): `id, org_id, category_id, status`. Not found → `404`.
4. **Authorize (the security boundary):** read the caller's `user_roles`; allow if `super_admin`, or a row with `org_id = reg.org_id and role in ('editor','admin')` (mirrors `auth_can_admin_org`). Otherwise → `403`.
5. **Guard / idempotency:** `status === 'refunded'` → `200 { ok:true, already:true }`; `status !== 'paid'` (pending/cancelled) → `409 not_refundable`.
6. **Refund** (service client, mirrors `confirmPayment`'s inverse; *provider refund call is the future PayMongo swap point — no-op for the fake provider*):
   - `payments.update({ status:'refunded', raw: { ...raw, refunded_at, refunded_by:userId, note } }).eq('registration_id', id)`
   - `registrations.update({ status:'refunded' }).eq('id', id)`
   - `rpc('decrement_slot', { p_category_id })`
7. → `200 { ok:true, registration_id }`.

**Idempotency note:** the `status==='paid'` gate (step 5) is what makes a double-invoke safe — a second call sees `refunded` and returns `already` **without** decrementing the slot again. This mirrors how `confirmPayment` guards on already-`paid`. Web calls it via `supabase.functions.invoke('admin-refund', { body: { registration_id } })`.

**Ticket handling:** the refund **leaves `ticket_token` intact** (no column write beyond `status`); `registrations.status` is the source of truth, and a `refunded` row is not `paid`. **Cross-plan dependency:** race-day check-in (Plan 14) must gate on `status === 'paid'`, not merely on a cryptographically valid token — otherwise a refunded runner's old ticket would still scan. Called out here so Plan 14 inherits the constraint.

## 5. Registrations surface — roster + detail

Route **`/registrations`** (replaces the `Placeholder`; still under `RequireAdmin`). Query param `?event=<id>` deep-links a selection.

**Top:** an **event selector** — dropdown of the org's events (label + registration count), defaulting to the `?event` param or the most recent event. Below it, the **filters row**: payment-status chips (all / pending / paid / refunded / failed), a category dropdown (the selected event's categories), and a **name search** box (client-side over loaded rows).

**Roster table** columns:

| Column | Source |
| --- | --- |
| Runner | `profiles.full_name` (+ `bib_name` subline) |
| Category | `categories.label` |
| Amount | `registrations.total_amount` (₱ from centavos) |
| Payment | `payments.status` badge (pending / paid / refunded / failed) |
| Registered | `registrations.created_at` (date) |

A row opens the **registration detail** (drawer/modal): runner name/bib, category, amount breakdown + **add-ons** (`registration_addons`), **custom-field answers** (`registrations.custom_data`), waiver-accepted, payment status/method, ticket presence, registered-at. A **Refund** button is shown, **enabled only when `payments.status === 'paid'`**; once refunded it shows the refund metadata (from `payments.raw`) instead.

**Refund** → `RefundModal` confirm ("Refund ₱X to <runner>? This reopens the slot and can't be undone.") + optional note → calls the Edge Function → on success closes and invalidates the roster + the event (slots changed) + the counts. Errors (`403/404/409/500`) surface as friendly messages in the modal.

**States:** loading (roster query), empty ("No registrations yet"), no-event-selected (prompt to pick), refunding (button busy).

## 6. Payments surface — read-only ledger

Route **`/payments`** (replaces the `Placeholder`). An **org-wide**, read-only table of the org's payments (reuses the same read model), money-focused columns: **Event · Runner · Amount · Fee (`platform_fee`) · Net (`net_to_org`) · Method · Status · Date**, with a payment-status filter. Each row **links into the registration detail** (§5), where the refund action lives — so Payments stays a pure projection with no write path of its own. (`CancelModal`'s "refunds are handled from Payments" copy stays honest: Payments → row → detail → Refund. Optional light copy tweak during implementation.)

## 7. Web — read model

New `apps/web/src/lib/registrations.ts` (TanStack Query, RLS-gated, mirrors `lib/events.ts`):

- **`useEventRegistrations(eventId)`** — two-step (§2.6): ① `registrations` for the event with `categories(label)` + `payments(status,method,amount,platform_fee,net_to_org)` embedded; ② `profiles(id,full_name,bib_name)` where `id in (distinct user_ids)`; merge into a row type. Returns roster rows.
- **`useEventRegistrationCounts(orgId)`** — minimal `select('event_id')` across the org's registrations (RLS already scopes to the admin's org), tallied per event for the selector + Events-list rows. *(Client-tally is fine at MVP volume; a grouped RPC/view is a later optimization.)*
- **`usePayments(orgId)`** — org-wide payments + embedded registration→category/event + the merged profile, for the ledger.
- **`refundRegistration(id)`** — `supabase.functions.invoke('admin-refund', …)`; the caller invalidates roster/event/counts on success.

Wire `/registrations` and `/payments` in `App.tsx` (drop the two `Placeholder`s). Add the count + "View registrations" link to `routes/Events.tsx` rows.

## 8. Edge cases & error handling

| Case | Behavior |
| --- | --- |
| Admin of **another org** reads/refunds these rows | Read: RLS returns no rows (roster empty). Refund: function `403` (step 4) |
| Runner (no role) hits `/registrations` or the function | Blocked by `RequireAdmin`; direct API read returns only their own rows; function `403` |
| Refund a **pending / cancelled** registration | `409 not_refundable`; button is disabled in the UI anyway (enabled only on `paid`) |
| **Double refund** (double-click / retry) | Idempotent: second call sees `refunded` → `{already:true}`, **no** second slot decrement |
| `slots_taken` already `0` at refund | `greatest(slots_taken - 1, 0)` floors at 0 |
| Registrant profile missing / null name | Row renders with a fallback label (e.g. bib or a short id); refund unaffected |
| Event with no registrations | Roster empty state; count shows 0 |
| Provider (PayMongo) refund failure — *future* | Swap-point wrapper returns the provider error **before** any DB mutation; MVP fake provider can't fail |

## 9. Testing

- **Backend RLS (root Vitest, live stack)** — new `supabase/tests/admin-registrations.test.ts`, `admin-roles.test.ts` style: an org admin reads its own event's `registrations` / `registration_addons` / `payments` and its registrants' `profiles`; an admin of **another org** reads none of them; a plain runner still reads only their own rows; `profiles_read_org_admin` exposes **only** users who registered in the admin's org (not arbitrary profiles).
- **Edge function (`backend.test.ts` pattern, live stack)** — `admin-refund`: an org admin refunds a **paid** registration → `payments`+`registrations` become `refunded` and `slots_taken` drops by one; a **non-admin** → `403`; an admin of **another org** → `403`; refunding a **pending** reg → `409`; a **second** refund is idempotent (status stays `refunded`, slot **not** decremented again).
- **Web (Vitest + RTL, jsdom)** — mock supabase + router: the read hook merges profiles/categories/payments into roster rows; status/category/name filters narrow the list; the roster renders rows + payment badges + empty state; the Refund button is disabled unless `paid`; confirming Refund invokes the function (mocked) and triggers invalidation; the Payments ledger renders money columns; an Events row shows its count + "View registrations" link.

## 10. Out of scope (later plans)

- **Partial refunds** (`refunded_amount` column + provider partial-refund handling).
- **Email / contact / CSV export** of the roster — needs a `security definer` view over `auth.users.email`; its own plan.
- **Real PayMongo refund execution** — the function has the swap point; wiring the provider is the payments-integration plan.
- **Race-day check-in** (QR scan / manual lookup) → Plan 14.
- **Dashboard KPIs** (fill rate, revenue, sign-ups over time) → Plan 15.
- **super_admin** cross-org payments, commission, and payout/settlement statements → Plan 16.

## 11. File touch-list (for writing-plans)

- **Create (backend):** migration — `registrations_read_org_admin`, `payments_read_org_admin`, `registration_addons_read_org_admin`, `profiles_read_org_admin` + `decrement_slot(uuid)` RPC + its `service_role` grant · `supabase/functions/_shared/refund.ts` (`refundRegistration`) · `supabase/functions/admin-refund/index.ts` · `supabase/tests/admin-registrations.test.ts` · refund cases in `supabase/tests/backend.test.ts`.
- **Create (web):** `apps/web/src/lib/registrations.ts` (read hooks + `refundRegistration`) · `apps/web/src/routes/Registrations.tsx` · `apps/web/src/routes/Payments.tsx` · `apps/web/src/components/RegistrationDetail.tsx` · `apps/web/src/components/RefundModal.tsx` · web tests.
- **Modify (web):** `apps/web/src/App.tsx` (routes `/registrations`, `/payments` → real components) · `apps/web/src/routes/Events.tsx` (registration count + "View registrations" link) · optional copy tweak in `apps/web/src/components/CancelModal.tsx`.
- **Docs:** add Plan 13 to `docs/plans/` and tick it in the `docs/README.md` roadmap.
