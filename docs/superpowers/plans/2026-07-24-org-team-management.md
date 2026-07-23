# Org Team Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org admin invite/list/change-role/remove staff from the admin web, scoped to their org, via a service-role `org-members` edge function; add the `claiming` role.

**Architecture:** Pure guard logic (role allowlist, last-admin protection) lives in a runtime-agnostic `supabase/functions/_shared/team.ts` (vitest-tested). The `org-members` Deno edge function delegates every decision to those helpers and is the authorization boundary (service-role bypasses RLS). The admin web adds a `lib/team.ts` data layer (calls the function), an `InviteMemberForm`, and a `Team` route + Sidebar entry. One migration adds the enum value.

**Tech Stack:** Supabase Edge Functions (Deno) + `serviceClient`, Postgres/RLS, React + React Router + TanStack Query (admin web), Vitest (root: node; apps/web: jsdom + Testing Library).

## Global Constraints

- **Package manager:** `pnpm@9.7.0`, Node `>=20`. Worktree: `.claude/worktrees/org-team-management`. All paths below are relative to the worktree root unless stated.
- **Two test runners:**
  - Edge `_shared` + shared-package tests → **root Vitest** (`vitest.config.ts` includes `supabase/**/*.test.ts`, env `node`). Run from the **worktree root**: `pnpm exec vitest run <path>`.
  - Admin-web tests → **apps/web Vitest** (env `jsdom`, `globals: true`, setup `./vitest.setup.ts` which loads `@testing-library/jest-dom`). Run from **`apps/web`**: `pnpm exec vitest run <pattern>`. Because `globals: true`, `vi`/`it`/`expect`/`describe`/`beforeEach` are global — do NOT import them (match the existing test files).
- **The `org-members/index.ts` handler is Deno and is NOT run by Vitest** (it uses `Deno.serve` + `serviceClient`). Its correctness rests on the vitest-tested `_shared/team.ts` helpers plus review — the same testing posture as the existing `admin-refund` function (untested handler, tested `_shared` logic).
- **Roles:** assignable via team management = `admin`, `editor`, `marshal`, `claiming`; never `user` or `super_admin`. Management is **admin-only** (caller must be `admin` of the org, or `super_admin`). **Last-admin protection**: never leave an org with zero admins. **One role per (user, org)** — invite/setRole replace any existing org role.
- **Edge-fn call shape** (mirror `apps/web/src/lib/registrations.ts` `refundRegistration`): `supabase.functions.invoke("org-members", { body: { action, ... } })`; map errors via `error.context.status`.
- **No hardcoded secrets.** Deferred to merge (hosted infra, with user confirmation): `supabase db push` (migration) and `supabase functions deploy org-members`.
- **TDD, DRY, YAGNI, frequent commits.** Every testable task ends with a passing test + a commit.

---

## Prerequisites (once, before Task 1)

- [ ] **P1: Install dependencies in the worktree**

The worktree has no `node_modules`. From the worktree root:

Run: `pnpm install`
Expected: completes, linking all workspace projects.

- [ ] **P2: Confirm both suites are green at baseline**

Run (worktree root): `pnpm exec vitest run supabase/functions/_shared`
Expected: existing `_shared` tests pass (e.g., `ticket.test.ts`).

Run (from `apps/web`): `pnpm exec vitest run`
Expected: the existing admin-web suite passes.

---

## Task 1: Migration — add the `claiming` role

**Files:**
- Create: `supabase/migrations/20260724120000_org_members.sql`

**Interfaces:**
- Produces: the `claiming` value on the `app_role` enum (used as a plain string constant elsewhere; no code depends on the DB apply for tests).

> No automated test (SQL). The DB apply is deferred to merge.

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/20260724120000_org_members.sql`:

```sql
-- Org team management: add the race-kit "claiming" role. Role assignment happens
-- exclusively through the service-role `org-members` edge function (there are no
-- client write policies on user_roles), so this migration only introduces the enum
-- value. Added on its own — nothing here uses it in the same transaction, avoiding
-- Postgres's "unsafe use of new enum value" error.
alter type app_role add value if not exists 'claiming';
```

- [ ] **Step 2: Verify the file**

Run: `cat supabase/migrations/20260724120000_org_members.sql`
Expected: exactly the SQL above; the filename sorts after `20260723120000_registrations_cancel_own_pending.sql`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260724120000_org_members.sql
git commit -m "feat(db): add the claiming (race kit) app_role"
```

---

## Task 2: Pure guards — `_shared/team.ts`

**Files:**
- Create: `supabase/functions/_shared/team.ts`
- Test: `supabase/functions/_shared/team.test.ts`

**Interfaces:**
- Produces:
  - `ASSIGNABLE_ROLES: readonly ["admin","editor","marshal","claiming"]`
  - `isAssignableRole(role: string): boolean`
  - `type OrgRoleRow = { user_id: string; role: string }`
  - `wouldLeaveNoAdmin(roles: OrgRoleRow[], userId: string, newRole: string | null): boolean`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/_shared/team.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isAssignableRole, wouldLeaveNoAdmin, ASSIGNABLE_ROLES } from "./team";

describe("isAssignableRole", () => {
  it("accepts the four assignable roles", () => {
    for (const r of ASSIGNABLE_ROLES) expect(isAssignableRole(r)).toBe(true);
  });
  it("rejects user, super_admin, and unknown roles", () => {
    expect(isAssignableRole("user")).toBe(false);
    expect(isAssignableRole("super_admin")).toBe(false);
    expect(isAssignableRole("wizard")).toBe(false);
  });
});

describe("wouldLeaveNoAdmin", () => {
  const roles = [
    { user_id: "a", role: "admin" },
    { user_id: "b", role: "editor" },
    { user_id: "c", role: "admin" },
  ];
  it("blocks removing the last admin", () => {
    expect(wouldLeaveNoAdmin([{ user_id: "a", role: "admin" }], "a", null)).toBe(true);
  });
  it("allows removing an admin when another admin remains", () => {
    expect(wouldLeaveNoAdmin(roles, "a", null)).toBe(false);
  });
  it("blocks demoting the only admin to a non-admin role", () => {
    expect(wouldLeaveNoAdmin([{ user_id: "a", role: "admin" }, { user_id: "b", role: "editor" }], "a", "editor")).toBe(true);
  });
  it("allows promoting a non-admin to admin", () => {
    expect(wouldLeaveNoAdmin([{ user_id: "b", role: "editor" }], "b", "admin")).toBe(false);
  });
  it("allows removing a non-admin", () => {
    expect(wouldLeaveNoAdmin(roles, "b", null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (worktree root): `pnpm exec vitest run supabase/functions/_shared/team.test.ts`
Expected: FAIL — `./team` cannot be found.

- [ ] **Step 3: Write the module**

Create `supabase/functions/_shared/team.ts`:

```ts
// Pure, runtime-agnostic guards for the org-members edge function. No Deno or
// Supabase imports, so these run under the root vitest suite.

export const ASSIGNABLE_ROLES = ["admin", "editor", "marshal", "claiming"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Roles an org admin may assign. Excludes 'user' (runner self-signup) and
 *  'super_admin' (platform-only). */
export function isAssignableRole(role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

export type OrgRoleRow = { user_id: string; role: string };

/** Would changing `userId`'s org role to `newRole` (null = removing them)
 *  leave the org with zero admins? The org must always keep >= 1 admin. */
export function wouldLeaveNoAdmin(roles: OrgRoleRow[], userId: string, newRole: string | null): boolean {
  const otherAdmins = roles.filter((r) => r.user_id !== userId && r.role === "admin").length;
  const selfAdminAfter = newRole === "admin" ? 1 : 0;
  return otherAdmins + selfAdminAfter === 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run (worktree root): `pnpm exec vitest run supabase/functions/_shared/team.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/team.ts supabase/functions/_shared/team.test.ts
git commit -m "feat(functions): add pure role/last-admin guards for team management"
```

---

## Task 3: Edge function — `org-members`

**Files:**
- Create: `supabase/functions/org-members/index.ts`

**Interfaces:**
- Consumes: `serviceClient` (`_shared/supabase.ts`), `isAssignableRole` + `wouldLeaveNoAdmin` (`_shared/team.ts`).
- Produces the HTTP contract the web `lib/team.ts` calls: body `{ action: "list"|"invite"|"setRole"|"remove", org_id, ... }`; responses `{ ok, members }` / `{ ok, member }` / `{ ok }` or `{ error }` with statuses 400/401/403/404/409/500.

> No vitest test (Deno handler). Verification = the Task 2 helpers are green + a spec-checklist read-through (Step 3). If `deno` is on PATH, `deno check` is a bonus type gate.

- [ ] **Step 1: Write the handler**

Create `supabase/functions/org-members/index.ts`:

```ts
import { serviceClient } from "../_shared/supabase.ts";
import { isAssignableRole, wouldLeaveNoAdmin } from "../_shared/team.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Db = ReturnType<typeof serviceClient>;

// Find an existing auth user id by email by paginating the admin user list.
async function findUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) break; // reached the last page
  }
  return null;
}

// Enforce one role per (user, org): clear existing rows, then insert the new one.
async function setOrgRole(db: Db, orgId: string, userId: string, role: string): Promise<void> {
  await db.from("user_roles").delete().eq("org_id", orgId).eq("user_id", userId);
  const { error } = await db.from("user_roles").insert({ org_id: orgId, user_id: userId, role });
  if (error) throw error;
}

Deno.serve(async (req) => {
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string | undefined;
    const orgId = body.org_id as string | undefined;
    if (!action || !orgId) return json({ error: "bad_request" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
    const callerId = userRes.user.id;

    // Authorization boundary (service-role bypasses RLS, so this IS the gate):
    // caller must be super_admin, or admin of this org.
    const { data: callerRoles } = await db.from("user_roles").select("role,org_id").eq("user_id", callerId);
    const canManage = (callerRoles ?? []).some((r) =>
      r.role === "super_admin" || (r.org_id === orgId && r.role === "admin"));
    if (!canManage) return json({ error: "forbidden" }, 403);

    if (action === "list") {
      const { data: rows } = await db.from("user_roles").select("user_id,role,created_at").eq("org_id", orgId);
      const seen = new Set<string>();
      const members: unknown[] = [];
      for (const r of rows ?? []) {
        if (seen.has(r.user_id)) continue;
        seen.add(r.user_id);
        const { data: u } = await db.auth.admin.getUserById(r.user_id);
        const { data: p } = await db.from("profiles").select("full_name").eq("id", r.user_id).maybeSingle();
        members.push({ user_id: r.user_id, email: u?.user?.email ?? null, full_name: p?.full_name ?? null, role: r.role, created_at: r.created_at });
      }
      return json({ ok: true, members });
    }

    if (action === "invite") {
      const email = (body.email as string | undefined)?.trim().toLowerCase();
      const role = body.role as string | undefined;
      if (!email) return json({ error: "email_required" }, 400);
      if (!role || !isAssignableRole(role)) return json({ error: "bad_role" }, 400);

      let userId = await findUserIdByEmail(db, email);
      if (!userId) {
        const { data: inv, error: invErr } = await db.auth.admin.inviteUserByEmail(email);
        if (invErr || !inv?.user) return json({ error: "invite_failed" }, 400);
        userId = inv.user.id;
      }
      await setOrgRole(db, orgId, userId, role);
      return json({ ok: true, member: { user_id: userId, email, role } });
    }

    if (action === "setRole") {
      const userId = body.user_id as string | undefined;
      const role = body.role as string | undefined;
      if (!userId) return json({ error: "user_id_required" }, 400);
      if (!role || !isAssignableRole(role)) return json({ error: "bad_role" }, 400);

      const { data: orgRoles } = await db.from("user_roles").select("user_id,role").eq("org_id", orgId);
      if (wouldLeaveNoAdmin(orgRoles ?? [], userId, role)) return json({ error: "last_admin" }, 409);
      await setOrgRole(db, orgId, userId, role);
      return json({ ok: true, member: { user_id: userId, role } });
    }

    if (action === "remove") {
      const userId = body.user_id as string | undefined;
      if (!userId) return json({ error: "user_id_required" }, 400);

      const { data: orgRoles } = await db.from("user_roles").select("user_id,role").eq("org_id", orgId);
      if (wouldLeaveNoAdmin(orgRoles ?? [], userId, null)) return json({ error: "last_admin" }, 409);
      await db.from("user_roles").delete().eq("org_id", orgId).eq("user_id", userId);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (_e) {
    return json({ error: "server_error" }, 500);
  }
});
```

- [ ] **Step 2: Optional type-check**

Run: `deno check supabase/functions/org-members/index.ts` (only if `deno` is on PATH; otherwise skip — the handler isn't in the vitest suite).
Expected: no type errors, or skipped.

- [ ] **Step 3: Self-review against the spec checklist**

Re-read the handler and confirm each: JWT required (401); `action`+`org_id` required (400); caller is `admin`/`super_admin` of `org_id` else 403; `invite` validates role, attaches-or-invites, one-role-per-org; `setRole`/`remove` enforce `wouldLeaveNoAdmin` → 409; `remove` deletes the org role only (keeps the account). No secrets logged.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/org-members/index.ts
git commit -m "feat(functions): add org-members team-management edge function"
```

---

## Task 4: Web data layer — `lib/team.ts`

**Files:**
- Create: `apps/web/src/lib/team.ts`
- Test: `apps/web/src/__tests__/team-hooks.test.tsx`

**Interfaces:**
- Produces: `OrgMember`, `ASSIGNABLE_ROLES`, `ROLE_LABELS`, `useOrgMembers(orgId?)`, `inviteMember(orgId,email,role)`, `setMemberRole(orgId,userId,role)`, `removeMember(orgId,userId)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/team-hooks.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/supabase", () => {
  const invoke = vi.fn(() => Promise.resolve({ data: { ok: true, members: [{ user_id: "u1", email: "a@x.com", full_name: "Ana", role: "editor" }] }, error: null }));
  return { supabase: { functions: { invoke } } };
});

import { supabase } from "../lib/supabase";
import { useOrgMembers, inviteMember, setMemberRole, removeMember } from "../lib/team";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

it("useOrgMembers returns the members list from the function", async () => {
  const { result } = renderHook(() => useOrgMembers("a1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  expect(result.current.data![0]).toMatchObject({ user_id: "u1", email: "a@x.com", role: "editor" });
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "list", org_id: "a1" } });
});

it("inviteMember posts the invite action", async () => {
  const res = await inviteMember("a1", "New@X.com", "marshal");
  expect(res.ok).toBe(true);
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "invite", org_id: "a1", email: "New@X.com", role: "marshal" } });
});

it("setMemberRole posts the setRole action", async () => {
  await setMemberRole("a1", "u1", "admin");
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "setRole", org_id: "a1", user_id: "u1", role: "admin" } });
});

it("removeMember posts the remove action", async () => {
  await removeMember("a1", "u1");
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "remove", org_id: "a1", user_id: "u1" } });
});

it("maps a 409 error to the last-admin message", async () => {
  (supabase.functions.invoke as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ data: null, error: { context: { status: 409 } } });
  const res = await removeMember("a1", "u1");
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/at least one admin/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/web`): `pnpm exec vitest run team-hooks`
Expected: FAIL — `../lib/team` cannot be found.

- [ ] **Step 3: Write the module**

Create `apps/web/src/lib/team.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type OrgMember = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at?: string;
};

export const ASSIGNABLE_ROLES = ["admin", "editor", "marshal", "claiming"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];
export const ROLE_LABELS: Record<AssignableRole, string> = {
  admin: "Admin", editor: "Editor", marshal: "Marshal", claiming: "Race Kit",
};

function errorMessage(error: unknown): string {
  const status = (error as { context?: { status?: number } }).context?.status;
  return status === 403 ? "You don't have permission to manage this team."
    : status === 409 ? "An organization must keep at least one admin."
    : status === 400 ? "That role can't be assigned."
    : "Something went wrong. Please try again.";
}

export function useOrgMembers(orgId?: string) {
  return useQuery<OrgMember[]>({
    queryKey: ["org-members", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("org-members", { body: { action: "list", org_id: orgId } });
      if (error) throw new Error(errorMessage(error));
      return (data as { members?: OrgMember[] })?.members ?? [];
    },
  });
}

export async function inviteMember(orgId: string, email: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("org-members", { body: { action: "invite", org_id: orgId, email, role } });
  return error ? { ok: false, error: errorMessage(error) } : { ok: true };
}

export async function setMemberRole(orgId: string, userId: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("org-members", { body: { action: "setRole", org_id: orgId, user_id: userId, role } });
  return error ? { ok: false, error: errorMessage(error) } : { ok: true };
}

export async function removeMember(orgId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("org-members", { body: { action: "remove", org_id: orgId, user_id: userId } });
  return error ? { ok: false, error: errorMessage(error) } : { ok: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/web`): `pnpm exec vitest run team-hooks`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/team.ts apps/web/src/__tests__/team-hooks.test.tsx
git commit -m "feat(web): add org team data layer calling org-members"
```

---

## Task 5: `InviteMemberForm` component

**Files:**
- Create: `apps/web/src/components/InviteMemberForm.tsx`
- Test: `apps/web/src/__tests__/invite-member-form.test.tsx`

**Interfaces:**
- Consumes: `ASSIGNABLE_ROLES`, `ROLE_LABELS`, `inviteMember` (Task 4).
- Produces: `InviteMemberForm({ orgId: string; onInvited: () => void })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/invite-member-form.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const inviteMember = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock("../lib/team", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/team")>();
  return { ...actual, inviteMember: (...a: unknown[]) => inviteMember(...a) };
});

import { InviteMemberForm } from "../components/InviteMemberForm";

it("submits an invite with the entered email and selected role", async () => {
  const onInvited = vi.fn();
  render(<InviteMemberForm orgId="a1" onInvited={onInvited} />);
  fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "crew@x.com" } });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "marshal" } });
  fireEvent.click(screen.getByRole("button", { name: /invite/i }));
  await waitFor(() => expect(inviteMember).toHaveBeenCalledWith("a1", "crew@x.com", "marshal"));
  await waitFor(() => expect(onInvited).toHaveBeenCalled());
});

it("shows an error when the invite fails", async () => {
  inviteMember.mockResolvedValueOnce({ ok: false, error: "That role can't be assigned." });
  render(<InviteMemberForm orgId="a1" onInvited={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "x@x.com" } });
  fireEvent.click(screen.getByRole("button", { name: /invite/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("can't be assigned");
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/web`): `pnpm exec vitest run invite-member-form`
Expected: FAIL — `../components/InviteMemberForm` cannot be found.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/InviteMemberForm.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { ASSIGNABLE_ROLES, ROLE_LABELS, inviteMember } from "../lib/team";

export function InviteMemberForm({ orgId, onInvited }: { orgId: string; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const res = await inviteMember(orgId, email.trim(), role);
    setBusy(false);
    if (res.ok) { setEmail(""); onInvited(); }
    else setError(res.error ?? "Couldn't send the invite.");
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="name@email.com" aria-label="Invite email"
        style={{ flex: 1, minWidth: 200, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--hairline)" }}
      />
      <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role"
        style={{ padding: "9px 11px", borderRadius: 8, border: "1px solid var(--hairline)" }}>
        {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
      <button type="submit" disabled={busy}
        style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
        {busy ? "Inviting…" : "Invite"}
      </button>
      {error ? <div role="alert" style={{ flexBasis: "100%", color: "var(--danger)", fontSize: 13 }}>{error}</div> : null}
    </form>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `apps/web`): `pnpm exec vitest run invite-member-form`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/InviteMemberForm.tsx apps/web/src/__tests__/invite-member-form.test.tsx
git commit -m "feat(web): add InviteMemberForm"
```

---

## Task 6: Team page + Sidebar/route wiring

**Files:**
- Create: `apps/web/src/routes/Team.tsx`
- Modify: `apps/web/src/components/Sidebar.tsx` (add the Team nav item)
- Modify: `apps/web/src/App.tsx` (add the `team` route)
- Test: `apps/web/src/__tests__/team-page.test.tsx`

**Interfaces:**
- Consumes: `useMyRoles`, `useOrgMembers`/`setMemberRole`/`removeMember`/`ASSIGNABLE_ROLES`/`ROLE_LABELS`/`OrgMember` (Task 4), `InviteMemberForm` (Task 5).
- Produces: the `Team` route component; `/team` reachable and in the Sidebar.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/team-page.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1", isAdmin: true } }) }));

const members = [
  { user_id: "u1", email: "ana@x.com", full_name: "Ana", role: "admin" },
  { user_id: "u2", email: "ben@x.com", full_name: "Ben", role: "marshal" },
];
const setMemberRole = vi.fn(() => Promise.resolve({ ok: true }));
const removeMember = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock("../lib/team", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/team")>();
  return {
    ...actual,
    useOrgMembers: () => ({ data: members, isLoading: false }),
    setMemberRole: (...a: unknown[]) => setMemberRole(...a),
    removeMember: (...a: unknown[]) => removeMember(...a),
    inviteMember: () => Promise.resolve({ ok: true }),
  };
});

import { Team } from "../routes/Team";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

it("lists members with their details", () => {
  wrap(<Team />);
  expect(screen.getByText("Ana")).toBeInTheDocument();
  expect(screen.getByText("ben@x.com")).toBeInTheDocument();
});

it("changes a member's role", async () => {
  wrap(<Team />);
  fireEvent.change(screen.getByLabelText("Role for ben@x.com"), { target: { value: "editor" } });
  await waitFor(() => expect(setMemberRole).toHaveBeenCalledWith("a1", "u2", "editor"));
});

it("removes a member after confirming in the dialog", async () => {
  wrap(<Team />);
  fireEvent.click(screen.getByLabelText("Remove ben@x.com"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith("a1", "u2"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/web`): `pnpm exec vitest run team-page`
Expected: FAIL — `../routes/Team` cannot be found.

- [ ] **Step 3: Write the Team route**

Create `apps/web/src/routes/Team.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMyRoles } from "../lib/roles";
import { useOrgMembers, setMemberRole, removeMember, ASSIGNABLE_ROLES, ROLE_LABELS, type OrgMember } from "../lib/team";
import { InviteMemberForm } from "../components/InviteMemberForm";

export function Team() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const qc = useQueryClient();
  const members = useOrgMembers(orgId);
  const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  function refresh() { qc.invalidateQueries({ queryKey: ["org-members", orgId] }); }

  async function changeRole(m: OrgMember, role: string) {
    if (role === m.role || !orgId) return;
    setRowError(null);
    const res = await setMemberRole(orgId, m.user_id, role);
    if (res.ok) refresh(); else setRowError(res.error ?? "Couldn't change the role.");
  }

  async function confirmRemove() {
    if (!pendingRemove || !orgId) return;
    setRowError(null);
    const res = await removeMember(orgId, pendingRemove.user_id);
    if (res.ok) { setPendingRemove(null); refresh(); }
    else setRowError(res.error ?? "Couldn't remove the member.");
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Team</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, marginBottom: 20 }}>Invite staff and assign their role. Roles decide what they can do across the console and the mobile app.</p>

      {orgId ? <InviteMemberForm orgId={orgId} onInvited={refresh} /> : null}

      <div style={{ marginTop: 24 }}>
        {members.isLoading ? <div style={{ color: "var(--ink-muted)" }}>Loading…</div> : null}
        {members.data?.map((m) => (
          <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--divider)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{m.full_name || m.email || m.user_id}</div>
              <div style={{ fontSize: 12, color: "var(--ink-muted)" }}>{m.email}</div>
            </div>
            <select value={m.role} aria-label={`Role for ${m.email ?? m.user_id}`} onChange={(e) => changeRole(m, e.target.value)}
              style={{ padding: "7px 9px", borderRadius: 8, border: "1px solid var(--hairline)" }}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <button onClick={() => { setRowError(null); setPendingRemove(m); }} aria-label={`Remove ${m.email ?? m.user_id}`}
              style={{ color: "var(--danger)", background: "none", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Remove</button>
          </div>
        ))}
        {members.data && members.data.length === 0 ? <div style={{ color: "var(--ink-muted)" }}>No team members yet.</div> : null}
      </div>

      {rowError && !pendingRemove ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>{rowError}</div> : null}

      {pendingRemove ? (
        <div role="dialog" aria-label="Confirm remove" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--canvas)", borderRadius: 14, padding: 22, width: 340 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Remove this member?</div>
            <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 16 }}>{pendingRemove.email} loses access to this organization. Their account isn't deleted.</div>
            {rowError ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>{rowError}</div> : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setPendingRemove(null)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--hairline)", background: "none", cursor: "pointer" }}>Cancel</button>
              <button onClick={confirmRemove} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "var(--danger)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Remove member</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire the nav + route**

In `apps/web/src/components/Sidebar.tsx`, add a Team item to `ORG_ITEMS` (before `Settings`):

```ts
const ORG_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/events", label: "Events" },
  { to: "/registrations", label: "Registrations" },
  { to: "/payments", label: "Payments" },
  { to: "/check-in", label: "Check-in" },
  { to: "/team", label: "Team" },
  { to: "/settings", label: "Settings" },
];
```

In `apps/web/src/App.tsx`, add the import and the route (next to the other AppShell routes, e.g. after `registrations`):

```tsx
import { Team } from "./routes/Team";
```
```tsx
            <Route path="team" element={<Team />} />
```

- [ ] **Step 5: Run to verify it passes (page + no regressions in Sidebar/App)**

Run (from `apps/web`): `pnpm exec vitest run team-page sidebar`
Expected: PASS — `team-page` (3 tests) green, and the existing `sidebar` test still green with the added item.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/Team.tsx apps/web/src/components/Sidebar.tsx apps/web/src/App.tsx apps/web/src/__tests__/team-page.test.tsx
git commit -m "feat(web): add Team management page and nav"
```

---

## Task 7: Full-suite + type verification

**Files:** none (verification only).

- [ ] **Step 1: Edge/shared suite**

Run (worktree root): `pnpm exec vitest run supabase/functions/_shared`
Expected: PASS (includes `team.test.ts`).

- [ ] **Step 2: Full admin-web suite**

Run (from `apps/web`): `pnpm exec vitest run`
Expected: PASS — all suites, including the four added/changed (`team-hooks`, `invite-member-form`, `team-page`, `sidebar`).

- [ ] **Step 3: Admin-web typecheck**

Run (from `apps/web`): `pnpm exec tsc --noEmit`
Expected: no errors. (This is the same `tsc` the `build` script runs.)

> No commit — verification only. Fix any failure under the owning task before proceeding.

---

## Self-Review (completed while writing)

**Spec coverage:**
- §3 roles + `claiming` → Tasks 1 (enum), 2/4 (allowlist constants).
- §4 edge function (list/invite/setRole/remove, authz, attach-or-invite, one-role-per-org, last-admin) → Task 3, delegating to Task 2's tested guards.
- §5 migration (enum only; writes function-only) → Task 1 (no client write policy is created anywhere).
- §6 admin-web UI (Team page, InviteMemberForm, data layer, Sidebar/route) → Tasks 4–6.
- §7 error handling (status→message mapping; inline alerts) → Tasks 4 (`errorMessage`), 5/6 (alerts).
- §8 testing → Tasks 2, 4, 5, 6, 7 (pinned to the real vitest harnesses).

**Placeholder scan:** none — every step has full code or an exact command. Task 3's handler is intentionally not vitest-tested (documented, matches `admin-refund`); its logic is covered by Task 2.

**Type consistency:** `OrgMember`/`ASSIGNABLE_ROLES`/`ROLE_LABELS` (Task 4) are consumed unchanged in Tasks 5–6; the edge function's response shape (`{ ok, members }` / `{ ok, member }`) matches `lib/team.ts`'s reads; `wouldLeaveNoAdmin`/`isAssignableRole` signatures (Task 2) match their calls in Task 3; the `org-members` action bodies asserted in the web tests (Task 4) match the handler's parsing (Task 3).
```
