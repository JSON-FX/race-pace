# Organization management — rename · manage admins · suspend · delete — Design Spec

- **Status:** Approved (brainstorm 2026-08-18)
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Relates to:** [Plan 9 admin foundation](2026-07-20-admin-foundation-design.md) (`user_roles`, capabilities, the `(admin)` shell); the super-admin Organizations page and `org-provision` Edge Function shipped 2026-08-06; `org-members` (invite / setRole / remove); the column-scoped `organizations` UPDATE grant (`20260724140000_scope_org_update_grant.sql`) and the terms grant + policy (`20260807090600_page_support_rpcs.sql`).
- **Discharges:** the KNOWN LIMITATION recorded in `apps/web/lib/queries/organizations.ts:78` — "`orgs_read_active` restricts `organizations` SELECT to `is_active = true` for every authenticated caller, super admin included … the Status column can only ever read 'Active' today."

## 1. Goal

Give a super admin the four things the Organizations page implies but does not
have: **rename** an organization, **manage who administers it**, **suspend** it,
and **delete** it. Plus two corrections found on the way:

1. The create dialog defaults the commission rate to **10%**, contradicting the
   database default of `0.03`. It becomes **3%**.
2. The invite link `org-provision` hands back points at `http://localhost:3000`
   and, even pointed correctly, lands on a route that cannot consume it.

**Non-goals:** an organization detail page (row actions instead — §7); an
org-level audit log; editing commercial terms (already shipped on the Commission
page); any runner-facing surface beyond a suspended org's events disappearing.

## 2. Decisions (from brainstorm)

1. **All four operations are actions on `org-provision`,** not a new function.
   It already holds the super-admin gate, the CORS shape and the org row shape.
   A second function would duplicate the authorization boundary, and this repo
   has been bitten by keeping two copies of one rule in step.
2. **The slug is immutable.** Rename changes `name` only. The slug is in live
   event URLs and in any link an organizer has already shared.
3. **Suspend means "stop selling", not "lock out".** Existing paid entries,
   tickets, check-in, refunds and payouts keep working. Org admins keep console
   access to run the races they already sold.
4. **Delete refuses once money has moved** — any `payments` row for the org in
   `paid`, `refunded` or `partially_refunded`. A refund is still money that
   moved and still a PayMongo record that may have to be reconciled. There is no
   override; Suspend is the answer for a live organization.
5. **The delete cascade is one RPC,** not a client-side sequence — matching the
   house rule that multi-step money mutations are single Postgres RPCs.
6. **`is_active` is never granted to `authenticated`.** Service role is the only
   route. See §4.1 for why this is not a style preference.
7. **The invite link gets a real landing route.** Fixing `site_url` alone moves
   where the link fails; it does not make it work.

## 3. Component 1 — `org-provision` grows four actions

Today: `check_slug`, `create`. Added:

```ts
// action: "update"        { org_id, name }              → { ok, org }
// action: "set_active"    { org_id, is_active }         → { ok, org }
// action: "delete_preview"{ org_id }                    → { ok, counts, blocked, blocking }
// action: "delete"        { org_id, slug }              → { ok, deleted }
```

The existing super-admin check at `index.ts:124` already runs before the action
branch, so every one of these inherits it. `create`'s validation helpers are
untouched.

### 3.1 `update`

`name` only, trimmed, non-empty — the same `name_required` code `create` uses.
Written with the service client, so it does not depend on `name` happening to be
in the column grant.

### 3.2 `set_active`

A single-column write of `is_active`. Returns the updated row so the table can
re-render without a refetch.

### 3.3 `delete_preview`

Returns what the confirm dialog shows and what the guard decided:

```ts
{
  counts:   { events, categories, registrations, payments, checkins, members, payout_statements },
  blocked:  boolean,
  blocking: { paid: number, refunded: number, partially_refunded: number } | null
}
```

`blocked` is computed from the payment statuses, not inferred in the browser.
The dialog renders the reason; it does not decide it.

### 3.4 `delete`

Requires `slug` in the body and checks it against the row being deleted. A wrong
slug returns `slug_mismatch` (400). This is not the UI's confirmation — the UI
has its own — it is the guard against a mis-targeted call reaching the function
at all.

Re-runs the money guard server-side (the preview is advisory; the gate is here),
calls `delete_organization_tx`, then empties the org's storage prefixes.

## 4. Component 2 — the migration

One migration, four changes. New to the hosted project, so it is written as a
follow-up rather than an edit to anything already applied.

### 4.1 Widen `orgs_read_active`

```sql
-- was: for select using (is_active = true)
drop policy if exists orgs_read_active on organizations;
create policy orgs_read_active on organizations
  for select using (
    is_active
    or (select public.auth_is_super_admin())
    or id in (
      select ur.org_id
      from public.user_roles ur
      where ur.user_id = (select auth.uid())
        and ur.org_id is not null
        and ur.role in ('editor', 'admin')
    )
  );
```

**Not a call to `auth_can_admin_org(id)`, shipped as its predicate inlined
instead.** `20260808161720_rls_scope_once_not_per_row.sql` measured that
passing a *column* to a `STABLE` function on this shape of predicate defeats
Postgres's ability to evaluate it once per statement and forces per-row
re-evaluation instead — a query going from 4.9ms to 1,220ms and into a
production statement timeout. Inlined here from the start rather than shipped
correlated and fixed later. `org_id is not null` keeps the `in` exactly
equivalent to `auth_can_admin_org`'s own `exists` in the presence of
`super_admin` rows, whose `org_id` is `NULL`.

This covers both the platform operator and the org's own admins in one
predicate. Without it, suspending an org removes it from the page you would
un-suspend it from, and breaks the console for its own staff.

Anonymous callers match neither the super-admin nor the `user_roles` branch,
so a suspended org stays invisible on the storefront.

**`is_active` is still not in the UPDATE grant, and must not be.** Postgres RLS
cannot be scoped to a column, and `organizations_update_branding_org_admin` is
column-agnostic (`using auth_can_admin_org(id)`). Granting `is_active` to
`authenticated` would let every org admin unsuspend their own organization. This
is the same trap `20260811097000_org_fee_mode_grant.sql` documents at length for
`fee_mode`.

### 4.2 A suspended org's events leave the storefront

```sql
-- was: for select using (status <> 'draft')
drop policy if exists events_read_published on events;
create policy events_read_published on events
  for select using (
    status <> 'draft'::event_status
    and org_id in (select id from public.organizations where is_active)
  );
```

**Not a correlated `exists (... where o.id = events.org_id ...)`, shipped as an
uncorrelated `in` instead.** `20260808161720_rls_scope_once_not_per_row.sql` —
the same migration behind §4.1's inlining — found a correlated per-row subplan
on this table's read path put a production query 250x over budget. The
uncorrelated form lets the planner hoist the inner `select` into a hashed
InitPlan evaluated once per statement, and this is the hottest anonymous query
in the app, so the shape is not optional.

`events_read_org_admin` (`auth_can_admin_org(org_id)`) is a separate permissive
policy and is untouched, so org staff keep seeing their own events while
suspended. Policies are OR'd.

### 4.3 `delete_organization_tx`

```sql
create or replace function delete_organization_tx(p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
```

**Not `set search_path = public`.** `20260806202000_harden_auth_helper_search_path.sql`
found that `= public` still leaves `pg_temp` implicitly searched *first* —
Postgres always does, unless a path explicitly lists it — so a caller-created
`pg_temp` object can still shadow a `public` one even with `public` named
explicitly. The shipped function uses `set search_path = ''` and fully
qualifies every reference (`public.organizations`, `public.registrations`,
etc.) instead.

**Why an RPC and not `delete from organizations`:** not because a plain delete
fails on an ordering hazard — see the correction below, it doesn't. The actual
reasons: (1) the money guard and the deletes must be one atomic unit — a plain
`delete from organizations` has no way to check `payments` first and abort
before touching anything; (2) the console's delete action consumes the
returned counts (events/categories/registrations/payments/checkins/
members/payout_statements) to show what was removed, and a bare `delete`
returns nothing structured; (3) the explicit `registrations` → `categories` →
`organizations` order costs nothing and is defence-in-depth against a future
schema change that turns the `NO ACTION` constraint into one Postgres enforces
mid-cascade.

Order inside the transaction:

1. `delete from registrations where org_id = p_org_id`
   — cascades `registration_addons`, `registration_audit`, `payments`, `checkins`
2. `delete from categories where org_id = p_org_id`
3. `delete from organizations where id = p_org_id`
   — cascades `events`, `addons`, `form_fields`, `payout_statements`, `user_roles`

Re-checks the money guard as its first statement and raises if it trips, so the
invariant holds even if the function is ever called from somewhere other than
`org-provision`. Returns the deleted counts as jsonb.

**Grant it explicitly.** Postgres grants EXECUTE to PUBLIC on every new
function by built-in default, and a missing grant has bitten this repo three
times — `20260808120200`, an event trigger that once enforced this at DDL
time, was reversed by `20260808130000` because it also fired on `CREATE OR
REPLACE` and silently stripped grants from existing functions; the guard now
is `supabase/tests/function-grants.test.ts`, which audits every `public`
function's grants. Grant `delete_organization_tx` to `service_role` only —
nothing else should be able to call this — and verify with
`has_function_privilege` in the same migration.

**Verified (2026-08-18):** the ordering-hazard claim above (why an RPC and not
a plain `delete`) was tested against the exact fixture this spec describes
(one event, two categories, a registration in each) and does not reproduce —
a plain `delete from organizations` succeeds. Every cascade and the
`registrations_category_id_fkey` NO ACTION check resolve inside the same
top-level statement's after-trigger queue, so by the time that constraint is
checked the registrations are already gone. The constraint itself is real — a
direct `delete from categories` with registrations still present does fail —
an org-level delete just never reaches that state. This is why the function's
justification above is the money guard's atomicity and the returned counts,
not the ordering hazard.

### 4.4 Nothing is granted to `authenticated`

The migration adds no column grants at all. Every write in this spec goes
through the service role.

## 5. Component 3 — the checkout gate

RLS hides a suspended org's events from the storefront. It does not stop a POST
to `registrations-checkout` carrying an event id someone already holds — the
function runs on the service role and RLS does not apply to it.

`registrations-checkout/index.ts:42` already loads the event
(`.select("status, registration_closes_at")`) for exactly this class of check —
its own comment says the function must refuse "even via a direct call with a
stale category id already in hand". Extend that select to
`"status, registration_closes_at, organizations(is_active)"` and refuse with
`org_suspended` (409) when the org is inactive, alongside the existing
closed-event refusal.

`payment-session` needs no change: it can only be reached by a registration that
`registrations-checkout` already created.

## 6. Component 4 — the invite link

The link `org-provision` returns today is
`…/auth/v1/verify?token=…&type=magiclink&redirect_to=http://localhost:3000`.
Two independent faults.

### 6.1 `redirect_to` — project config

`generateLink` falls back to the project's **Site URL** when no explicit
redirect is passed. It is still `http://localhost:3000`.

```toml
[auth]
site_url = "https://race-pace-site.vercel.app"
additional_redirect_urls = [
  "https://race-pace-admin.vercel.app/auth/confirm",
  "https://race-pace-admin.vercel.app/auth/callback",
  "https://race-pace-site.vercel.app/auth/callback",
  "http://localhost:3000/auth/callback",
  "http://localhost:3001/auth/confirm",
  "http://localhost:3001/auth/callback",
  "https://racepace.lan/auth/callback",
  "https://admin.racepace.lan/auth/confirm",
  "https://admin.racepace.lan/auth/callback",
]
```

Pushed with `supabase config push`, so the auth configuration is versioned in
the repo rather than clicked into a dashboard. The storefront wins `site_url`
because runners are the volume; the console gets explicit redirects.

### 6.2 The landing route — `apps/web/app/auth/confirm/route.ts` (new)

**This is the half that makes the link work at all.** Both existing callbacks —
`apps/web/app/auth/callback/route.ts` and `apps/site/app/auth/callback/route.ts`
— handle `?code=` and nothing else. There is no `verifyOtp` or `token_hash`
handling anywhere in the repo. Supabase's `/auth/v1/verify` endpoint lands on
`redirect_to` carrying tokens in the URL **fragment**, which a server route
cannot read. Pointing the current link at the console would only move where it
fails.

The new route reads `token_hash` and `type`, calls
`supabase.auth.verifyOtp({ token_hash, type })`, and on success redirects with
the same `redirectRelative` helper the callback uses — relative Location on
purpose, for the reasons already documented in that file (Traefik, Vercel
internal hosts). On failure it redirects to `/login?oauth=invite_expired` and a matching entry
is added to `OAUTH_MESSAGES` in `login-form.tsx:12` — that map is how the
console already surfaces callback failures, and a param it does not know
renders nothing at all.

### 6.3 `org-provision` builds the link

Instead of returning `link.properties.action_link` raw, build:

```
${ADMIN_APP_URL}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=/team
```

`ADMIN_APP_URL` is a new Edge Function secret (§10). It stays best-effort: the
org and its admin role are already committed by this point, so a link failure
still returns `ok` with `invite_link: null`, exactly as today.

`inviteUserByEmail` gets the same `redirectTo`, so the emailed link matches the
manual one once SMTP is configured.

**Verify early.** This is the one place in the spec reasoned from the documented
shape of `generateLink`'s response rather than from code in this repo. The first
implementation task is to generate a real link against the hosted project and
confirm `hashed_token` is present and that `verifyOtp` accepts it. If it does
not, fall back to a client component that reads the fragment — but do not build
that until the cheap check fails.

## 7. Component 5 — the console

### 7.1 The create dialog's default

`apps/web/app/(admin)/organizations/new-org-dialog.tsx:69` and the reset on
line 77: `useState("10")` → `useState("3")`. The database default on
`organizations.commission_rate` is already `0.03`; this stops the form
contradicting it.

### 7.2 Row actions

A `⋯` menu per row on the existing table. No new route — an organization detail
page was considered and rejected as roughly double the work for the same four
operations.

| Item | Behaviour |
|---|---|
| **Rename** | One field, pre-filled. Calls `update`. |
| **Manage admins** | Lists the org's members with emails and roles; invite, change role, remove. Calls `org-members` with that row's `org_id`. |
| **Suspend** / **Unsuspend** | Confirm with a one-line consequence. Calls `set_active`. |
| **Delete** | Calls `delete_preview` on open, shows the counts, requires typing the slug. Disabled with the reason shown when `blocked`. |

**Manage admins needs no new backend.** `org-members` already authorizes a super
admin for any `org_id` (`index.ts:60`). The gap is reach: `/team` scopes to
`requireOrgId(roles)`, which is `null` for a super admin with no org-scoped row,
so that page shows `NoOrgScope` and there is no other way in. The dialog reuses
the existing member components against an explicit org id.

### 7.3 The Status column starts working

`getPlatformOrganizations` already selects `is_active` and maps it to
`isActive`. Once §4.1 lands, the column stops reading "Active" for everything
and the KNOWN LIMITATION comment on line 78 is deleted.

## 8. Data flow — delete

```
console  ─ delete_preview ─▶ org-provision ─ counts + guard ─▶ dialog
console  ─ delete{slug}  ─▶ org-provision
                              │ super_admin gate
                              │ slug match
                              │ money guard  ─── blocked ──▶ 409 org_has_payments
                              ├─▶ delete_organization_tx()   (one transaction)
                              └─▶ storage.remove(event-images/<id>/…, org-images/<id>/…)
```

Storage is emptied **after** the transaction commits, and a storage failure does
not fail the request — the rows are already gone and a retry has nothing left to
key off. Orphaned files are logged and reported in the response as
`storage_cleanup: "partial"`.

Worth recording: this is the path that actually works. The `supabase storage rm`
CLI is a silent no-op against this project (it looks for a legacy `service_role`
JWT and the project is on `sb_secret_` keys), but an Edge Function holds a real
key and its `storage.remove` is unaffected.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Suspend an org mid-race | Check-in, refunds and payouts keep working. Only new sales stop. |
| Runner is on the checkout page when the org is suspended | The POST returns `org_suspended` (409). No half-created registration. |
| Org admin's console while suspended | Fully readable — `orgs_read_active` and `events_read_org_admin` both still match for them. |
| Delete an org whose only payments are `pending` or `failed` | Allowed. No money moved. |
| Removing the last admin | `org-members` already refuses via `wouldLeaveNoAdmin`. Unchanged. |
| Deleted org's runner notifications | `notifications` has no FK to events or orgs (event ids live in its `data` jsonb), so a delete can leave dead deep-links. Accepted: the money guard means a deletable org has generated almost no notifications. |
| Two operators delete the same org | Second call finds no row and returns `not_found` (404). |
| Slug of a deleted org | Freed. It was only reserved by the unique constraint on the row. |

## 10. Secrets & one-time setup (operator-run)

1. `supabase secrets set ADMIN_APP_URL=https://race-pace-admin.vercel.app` —
   consumed by BOTH `org-provision` (create) and `org-members` (invite). Without
   it `buildInviteLink` returns null and a newly invited admin has no way in,
   because SMTP is not configured either.
2. `supabase config push` — applies §6.1. **Read the diff first**: `config.toml`
   holds the whole `[auth]` block, and pushing it applies every setting in it,
   not only `site_url`.
3. Redeploy `org-provision`, `org-members`, `registrations-checkout` and
   `payment-session`. The last two both refuse a suspended org (`org_suspended`,
   409) — checkout for a new entry, payment-session for an existing one — and a
   half-deployed pair leaves one of those doors open.
4. **When SMTP is eventually configured, edit the invite email template.**
   Supabase's default body uses `{{ .ConfirmationURL }}`, which routes through
   `/auth/v1/verify` and arrives at `redirect_to` with the tokens in the URL
   FRAGMENT and **no `token_hash` query parameter** — so `/auth/confirm`, a
   server route, cannot read them and answers
   `/login?oauth=invite_expired`. The template must instead build the link from
   `{{ .TokenHash }}`, pointed at the ADMIN console — e.g.
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite&next=%2Fteam`,
   `.RedirectTo` being the `<ADMIN_APP_URL>/auth/confirm` these functions already
   pass. Do **not** reach for `{{ .SiteURL }}`: `config.toml` points that at the
   runner storefront, which has no `/auth/confirm` route. Check the variable
   names against Supabase's current email-template docs before saving.
   This is the same reason `buildInviteLink` never returns generateLink's raw
   `action_link`; `apps/web/app/auth/confirm/route.ts` documents the mechanism.
   Until this edit is made, the MANUAL link the console hands back is the only
   invite path that works — configuring SMTP alone does not make the emailed one
   work.

## 11. Testing

**Backend (`supabase/tests/`, root vitest):**

- `delete_organization_tx` on an org with registrations spread across several
  categories, and a separate **structural** test asserting the lock order
  (`registrations` before `payments`) via `pg_get_functiondef`. The structural
  test exists because the behavioural race it guards against — a concurrent
  `confirm_payment_tx` and delete taking locks in opposite orders — is a
  deadlock (`40P01`), and a deadlock is symmetric: it happens regardless of
  which of the two orders either transaction used, so no behavioural test can
  tell a correct lock order from its reverse by outcome alone. Reading the
  order out of the function body is the only way to pin it.
- The money guard trips on each of `paid`, `refunded`, `partially_refunded`, and
  does not trip on `pending` / `failed`.
- `registrations-checkout` refuses a suspended org's event.
- A suspended org: invisible to anon, visible to its own admin, visible to a
  super admin. Its events, likewise.
- An org admin still cannot write `is_active` — extends the existing assertion
  at `supabase/tests/processor-fee-ledger.test.ts:192`.
- `has_function_privilege` on `delete_organization_tx` for `service_role`, and
  its absence for `authenticated`.

**Console (`apps/web`, colocated tests):**

- The delete dialog is disabled with the reason shown when `blocked`, and the
  confirm button stays disabled until the typed slug matches.
- The create dialog opens at 3%.
- The Status column renders Suspended.

`pnpm --filter web typecheck` and both suites are the gate. There is no CI; they
run locally.

## 12. File touch-list (for writing-plans)

**New**
- `supabase/migrations/<ts>_org_management.sql` — §4
- `apps/web/app/auth/confirm/route.ts` + test — §6.2
- `apps/web/app/(admin)/organizations/org-actions.tsx` + test — §7.2
- `apps/web/app/(admin)/organizations/manage-admins-dialog.tsx` + test — §7.2
- `supabase/tests/org-management.test.ts` — §11

**Changed**
- `supabase/functions/org-provision/index.ts` — §3, §6.3
- `supabase/functions/registrations-checkout/index.ts` — §5
- `apps/web/app/(admin)/organizations/page.tsx` — mount row actions
- `apps/web/app/(admin)/organizations/new-org-dialog.tsx` — §7.1
- `apps/web/lib/queries/organizations.ts` — delete the KNOWN LIMITATION comment
- `apps/web/app/(auth)/login/login-form.tsx` — one `OAUTH_MESSAGES` entry — §6.2
- `supabase/config.toml` — §6.1
- `docs/README.md` — roadmap ledger entry
