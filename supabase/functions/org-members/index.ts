import { serviceClient } from "../_shared/supabase.ts";
import { isAssignableRole } from "../_shared/team.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { adminInviteRedirect, buildInviteLink } from "../_shared/orgAdmin.ts";

type Db = ReturnType<typeof serviceClient>;

// Find an existing auth user id by email by paginating the admin user list.
async function findUserIdByEmail(
  db: Db,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) break; // reached the last page
  }
  return null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...cors },
    });

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
    const { data: callerRoles } = await db
      .from("user_roles")
      .select("role,org_id,event_scope")
      .eq("user_id", callerId);
    const canManage = (callerRoles ?? []).some(
      (r) =>
        r.role === "super_admin" ||
        (r.org_id === orgId && r.role === "admin" && !r.event_scope),
    );
    if (!canManage) return json({ error: "forbidden" }, 403);

    if (action === "list") {
      const { data: rows, error: listErr } = await db
        .from("user_roles")
        .select("user_id,role,event_scope,created_at")
        .eq("org_id", orgId);
      if (listErr) return json({ error: "server_error" }, 500);
      const seen = new Set<string>();
      const members: unknown[] = [];
      for (const r of rows ?? []) {
        if (seen.has(r.user_id)) continue;
        seen.add(r.user_id);
        const { data: u } = await db.auth.admin.getUserById(r.user_id);
        const { data: p } = await db
          .from("profiles")
          .select("full_name,avatar_url")
          .eq("id", r.user_id)
          .maybeSingle();
        members.push({
          user_id: r.user_id,
          email: u?.user?.email ?? null,
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          role: r.role,
          event_scope: r.event_scope,
          created_at: r.created_at,
        });
      }
      return json({ ok: true, members });
    }

    const scopeProvided = Object.prototype.hasOwnProperty.call(
      body,
      "event_scope",
    );
    const scope = body.event_scope ?? null;
    if (
      scope !== null &&
      (typeof scope !== "string" ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(scope))
    )
      return json({ error: "invalid_event_scope" }, 400);
    async function writeRole(
      userId: string,
      role: string | null,
      replaceScope: boolean,
    ) {
      return db.rpc("team_member_write_tx", {
        p_org_id: orgId,
        p_actor_id: callerId,
        p_user_id: userId,
        p_role: role,
        p_event_scope: scope,
        p_replace_scope: replaceScope,
      });
    }
    function writeError(result: {
      error: unknown;
      data: { error?: string } | null;
    }) {
      if (result.error || !result.data)
        return json({ error: "server_error" }, 500);
      if (result.data.error)
        return json(
          { error: result.data.error },
          result.data.error === "forbidden"
            ? 403
            : result.data.error === "last_admin"
              ? 409
              : 400,
        );
      return null;
    }
    async function sendSignIn(email: string) {
      const adminUrl = Deno.env.get("ADMIN_APP_URL") ?? "";
      const redirectTo = adminInviteRedirect(adminUrl);
      if (!redirectTo) return { delivery: "failed", invite_link: null };
      // Unlike generateLink, signInWithOtp actually sends through configured SMTP.
      // shouldCreateUser:false prevents a typo from provisioning another identity.
      const { error } = await db.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
      });
      if (!error) return { delivery: "sent", invite_link: null };
      const { data: link } = await db.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      return {
        delivery: "failed",
        invite_link: buildInviteLink(
          adminUrl,
          link?.properties?.hashed_token ?? null,
        ),
      };
    }
    if (action === "invite") {
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const role = body.role;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return json({ error: "email_required" }, 400);
      if (!isAssignableRole(role)) return json({ error: "bad_role" }, 400);
      // Validate scope before creating an identity or sending any email.
      if (scope !== null) {
        if (!["marshal", "claiming"].includes(role))
          return json({ error: "invalid_event_scope" }, 400);
        const { data: event, error } = await db
          .from("events")
          .select("id")
          .eq("org_id", orgId)
          .eq("id", scope)
          .maybeSingle();
        if (error || !event) return json({ error: "invalid_event_scope" }, 400);
      }
      const { data: org } = await db
        .from("organizations")
        .select("id")
        .eq("id", orgId)
        .maybeSingle();
      if (!org) return json({ error: "not_found" }, 404);
      let userId = await findUserIdByEmail(db, email);
      if (!userId) {
        const { data: created, error } = await db.auth.admin.createUser({
          email,
          email_confirm: false,
        });
        if (error || !created.user)
          return json({ error: "invite_failed" }, 502);
        userId = created.user.id;
      }
      const result = await writeRole(userId, role, scopeProvided);
      const failure = writeError(result);
      if (failure) return failure;
      const delivery = await sendSignIn(email);
      return json({
        ok: true,
        member: {
          user_id: userId,
          email,
          role,
          event_scope: result.data.event_scope,
        },
        ...delivery,
      });
    }
    if (action === "resend") {
      const userId = body.user_id;
      if (typeof userId !== "string")
        return json({ error: "user_id_required" }, 400);
      const { data: members } = await db
        .from("user_roles")
        .select("id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .limit(1);
      if (!members?.length) return json({ error: "not_found" }, 404);
      const { data: user } = await db.auth.admin.getUserById(userId);
      if (!user.user?.email) return json({ error: "not_found" }, 404);
      return json({ ok: true, ...(await sendSignIn(user.user.email)) });
    }
    if (action === "setRole" || action === "remove") {
      const userId = body.user_id,
        role = action === "remove" ? null : body.role;
      if (typeof userId !== "string")
        return json({ error: "user_id_required" }, 400);
      if (role !== null && !isAssignableRole(role))
        return json({ error: "bad_role" }, 400);
      const result = await writeRole(userId, role, scopeProvided);
      const failure = writeError(result);
      if (failure) return failure;
      return json({
        ok: true,
        member: { user_id: userId, role, event_scope: result.data.event_scope },
      });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (_e) {
    return json({ error: "server_error" }, 500);
  }
});
