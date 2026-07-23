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
// One role per (user, org): delete existing rows, then insert. Non-atomic (no txn),
// so the migration adding a new role MUST be applied before this function is deployed
// (else the insert fails after the delete, leaving the member role-less). Matches the
// project's accepted non-atomic write pattern; bounded by the merge deploy order.
async function setOrgRole(db: Db, orgId: string, userId: string, role: string): Promise<void> {
  const { error: delErr } = await db.from("user_roles").delete().eq("org_id", orgId).eq("user_id", userId);
  if (delErr) throw delErr;
  const { error } = await db.from("user_roles").insert({ org_id: orgId, user_id: userId, role });
  if (error) throw error;
}

// Note: the last-admin guard reads a roles snapshot then writes in a separate round-trip
// (no txn), so it is best-effort under concurrent team edits — consistent with this
// project's accepted non-atomic write pattern. It closes the single-request bypass.
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
      const { data: rows, error: listErr } = await db.from("user_roles").select("user_id,role,created_at").eq("org_id", orgId);
      if (listErr) return json({ error: "server_error" }, 500);
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
        if (invErr || !inv?.user) return json({ error: "invite_failed" }, 502);
        userId = inv.user.id;
      }

      // Re-inviting an existing member (e.g. the sole admin) to a lower role must not
      // strand the org — same last-admin guard as setRole. Harmless for a brand-new
      // invitee (no prior role, so it only fires when it genuinely would leave 0 admins).
      const { data: orgRoles } = await db.from("user_roles").select("user_id,role").eq("org_id", orgId);
      if (wouldLeaveNoAdmin(orgRoles ?? [], userId, role)) return json({ error: "last_admin" }, 409);
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
      const { error } = await db.from("user_roles").delete().eq("org_id", orgId).eq("user_id", userId);
      if (error) return json({ error: "server_error" }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (_e) {
    return json({ error: "server_error" }, 500);
  }
});
