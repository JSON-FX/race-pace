# Org Team Management (Admin Web)

**Status:** Approved, ready for implementation plan
**Scope:** `apps/web` (admin console) + Supabase — one enum migration, one RLS policy, one edge function. **No `apps/mobile` changes.**
**Branch:** `worktree-org-team-management` (isolated worktree at `.claude/worktrees/org-team-management`)

## 1. Goals

Let an **org admin** manage their staff from the admin web, all scoped to their own org and authorized server-side:

1. **Invite** a person by email and assign them a role.
2. **List** the org's team (name/email + role).
3. **Change** a member's role.
4. **Revoke** a member's access.

The role foundation already exists — `user_roles(user_id, role, org_id, event_scope)`, the `auth_can_admin_org()` check, and the `admin-refund` edge-function pattern. This slice adds the missing management surface, one new role, and the read/write plumbing.

## 2. Non-goals

- **No mobile changes.** Assigning `marshal`/`claiming`/`editor` here only *records* the role. What those roles actually *do* (check-in scanning, kit release, branding editing) are separate follow-on sub-projects (check-in; org branding). This slice is the accounts-and-roles plumbing only — a newly-invited staffer has an account and a role but no new mobile capability yet.
- **No multi-org admin UI.** One org per admin, matching today's `useMyRoles` (`apps/web/src/lib/roles.ts` returns a single `orgId`). Multi-org management is deferred.
- **`editor`/`marshal`/`claiming` cannot manage the team** — team management is `admin`-only (relaxable later). Managing people is more sensitive than editing events.
- **No `super_admin` management** from this surface (platform-only role; never assignable here).
- **No SMTP/email setup.** Invites use Supabase Auth email. The built-in email is heavily rate-limited — configuring real SMTP is a **go-live checklist item**, not built here.
- **No deletion of auth accounts.** Revoke removes the org-role row only; the person's login (and any runner profile) is untouched.

## 3. Roles

- **Add `claiming`** (Race Kit / shirt-bib distribution crew) to the `app_role` enum. Final enum: `user, marshal, editor, admin, super_admin, claiming`.
- **Assignable via team management:** `admin`, `editor`, `marshal`, `claiming`. **Never** `user` (runner self-signup) or `super_admin` (platform-only).
- Roles carry **no new capability** in this slice — capability arrives with the mobile sub-projects. `claiming` is registered now so the org chart can be captured; the "crew role + stations" refactor is explicitly deferred (YAGNI) unless operational roles proliferate.

### Account identity model (settled during brainstorming)

One `auth.users` account per human, keyed by email. An org role is **additive** — it never removes runner ability. So a staffer who is also a runner keeps one login for both, and the invite flow (§4) **attaches** a role to an existing account rather than duplicating it.

### One role per member (per org)

`user_roles`'s unique key is `(user_id, role, org_id, event_scope)`, so the schema technically allows a user to hold *several* roles in one org. Team management deliberately treats each member as having **exactly one role per org**: `invite` and `setRole` **replace** any existing role for that `(user_id, org_id)` rather than stacking, and `list` returns one row per member. This keeps "this person's role" unambiguous in the UI, and is forward-compatible with the deferred crew-role-plus-stations model (one role, many stations — not many roles).

## 4. Edge function — `supabase/functions/org-members`

A single Deno function, **action-discriminated** (`{ action, ...payload }`), following `admin-refund/index.ts` exactly: read the Bearer JWT → `serviceClient()` → `auth.getUser(jwt)` → confirm the caller is `admin`/`super_admin` of the target `org_id`. Because the service-role client bypasses RLS, **this authorization check IS the security boundary.**

**Authorization preamble (all actions):** resolve `userId` from the JWT; read the caller's `user_roles`; require `super_admin` OR (`org_id` matches AND `role = 'admin'`). Note this is stricter than `admin-refund` (which allows `editor`) — team management requires `admin`. Otherwise `403`.

**Actions:**

- **`list` `{ org_id }`** → `[{ user_id, email, full_name, role, created_at }]` for that org. Service-role joins `user_roles` (rows for `org_id`) with the auth email (`auth.admin.getUserById` per member — small N) and `profiles.full_name`.
- **`invite` `{ org_id, email, role }`**:
  1. Validate `role ∈ {admin, editor, marshal, claiming}` (reject `user`/`super_admin`) → `400 bad_role`.
  2. Find an existing auth user by that email.
     - **Exists** → **attach**: set that user's single `(user_id, org_id)` role to `role` (replacing any existing org role — §3). Re-inviting to the same role is a no-op (treat as success).
     - **New** → `auth.admin.inviteUserByEmail(email)` (sends a set-password link) → set the new user's `(user_id, org_id)` role to `role`.
  3. Return the resulting member row.
  *(The exact "find existing user by email" admin API call is pinned in the plan against supabase-js 2.110 — the logic is find-existing-else-invite.)*
- **`setRole` `{ org_id, user_id, role }`**: validate `role`; replace the member's role for `(user_id, org_id)`. **Last-admin guard** (below).
- **`remove` `{ org_id, user_id }`**: delete the `user_roles` row(s) for `(user_id, org_id)`. Keeps the auth account. **Last-admin guard** (below).

**Server-side guards (the boundary — never trust the client):**
- Role allowlist — no `super_admin`, no `user`.
- Caller is `admin`/`super_admin` of `org_id`; may only touch that org's rows.
- **Last-admin protection:** `setRole` (demoting an admin) and `remove` must refuse if it would leave the org with **zero admins** → `409 last_admin`. An org always retains ≥1 admin.

**Typed responses** mirroring `admin-refund`: `401 unauthorized`, `403 forbidden`, `400 bad_role`, `404 not_found`, `409 last_admin`, `500 server_error`, and `{ ok: true, member }` / `{ ok: true, members }` on success.

**Testable core:** the pure guard logic — role allowlist and last-admin computation — is extracted to `supabase/functions/_shared/team.ts` and unit-tested (Deno test, like `_shared/ticket.test.ts`); the `Deno.serve` handler stays thin.

## 5. Database — migration + RLS

New migration `supabase/migrations/20260724120000_org_members.sql` (sorts after the latest existing migration, `20260723120000`) — **just the enum value**:

- **Enum:** `alter type app_role add value if not exists 'claiming';` — placed alone; nothing else in the migration uses the new value in the same transaction, avoiding the Postgres "can't use a new enum value in the transaction that adds it" pitfall.
- **No new read policy.** The team list is served by the edge function (service-role, which also supplies emails), and `useMyRoles` already reads the caller's own roles via the existing `user_roles_read_own`. So this feature needs no additional client read on `user_roles`; a broader org-admin read policy is deferred to the mobile sub-project that actually needs it (YAGNI + least-privilege).
- **Writes stay function-only.** There are no client `insert`/`update`/`delete` policies on `user_roles` — role changes go exclusively through the service-role edge function, so privilege escalation from the client is impossible by construction.

## 6. Admin web UI

- **New "Team" page** — a Sidebar entry (`apps/web/src/components/Sidebar.tsx`) and route (`App.tsx`), gated on `roles.data?.isAdmin` exactly like the rest of the console.
- **`TeamPage`** — lists members (name/email + a role chip) with per-row actions (change role, remove).
- **`InviteMemberForm`** — email input + role `Select` (`admin`/`editor`/`marshal`/`claiming`) + submit → `invite`.
- **Change role** — inline `Select` or a small modal → `setRole`.
- **Remove** — a confirm modal (pattern of the existing `CancelModal`/`RefundModal`) → `remove`.
- **Data layer** — new `apps/web/src/lib/team.ts`: `useOrgMembers(orgId)`, `inviteMember`, `setMemberRole`, `removeMember`, each calling the edge function via `supabase.functions.invoke("org-members", { body: {...} })` (same shape as the mobile `registration.ts` calls). React Query for the list; invalidate on every mutation.

## 7. Error handling

- The edge function returns the typed errors above; the data layer surfaces `body.error` (like the mobile `startCheckout` `FunctionsHttpError` handling).
- UI: invite errors inline under the form ("That role can't be assigned", "Couldn't send the invite — try again"); `last_admin` on remove/demote shows inline in the confirm modal ("An org needs at least one admin"). The whole page is already `isAdmin`-gated, so `403` is not an expected in-UI state.

## 8. Testing

- **`_shared/team.ts`** (Deno unit): role allowlist accepts `admin/editor/marshal/claiming` and rejects `user/super_admin`; last-admin computation blocks removing/demoting the final admin and allows it when another admin remains.
- **`apps/web/src/lib/team.ts`** (Vitest, mocking `supabase.functions.invoke`): `useOrgMembers` maps the list; `inviteMember`/`setMemberRole`/`removeMember` post the right body and surface errors.
- **`TeamPage`**: list renders members + role chips; invite form submits; role change calls `setMemberRole`; remove opens the confirm and calls `removeMember`.
- **Sidebar/App gating**: the Team entry/route requires `isAdmin`.
- **Migration**: `claiming` present in the enum.

## 9. Rollout

Single branch in the isolated worktree, merged via PR (this repo's convention).

**Deferred to merge time (touch hosted infra — done with explicit user confirmation, as with the My Races migration):**
- Apply the migration: `supabase db push` (adds `claiming` + the read policy to `ytwdrsmclwghwktpupqd`).
- Deploy the function: `supabase functions deploy org-members`.
- **Email:** confirm Supabase Auth email works for invites; configure real SMTP before organizers use it in production (built-in email is rate-limited).
