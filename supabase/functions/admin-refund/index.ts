import { serviceClient } from "../_shared/supabase.ts";
import { refundRegistration } from "../_shared/refund.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Admin-initiated refund. Verifies the caller is an editor/admin of the
// registration's org (super_admin allowed) — service-role bypasses RLS, so this
// check IS the authorization boundary — then refunds server-side.
Deno.serve(async (req) => {
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const registrationId = body.registration_id as string | undefined;
    if (!registrationId) return json({ error: "registration_id_required" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    const { data: reg } = await db.from("registrations").select("org_id").eq("id", registrationId).single();
    if (!reg) return json({ error: "not_found" }, 404);

    const { data: roles } = await db.from("user_roles").select("role,org_id").eq("user_id", userId);
    const canAdmin = (roles ?? []).some((r) =>
      r.role === "super_admin" || (r.org_id === reg.org_id && (r.role === "editor" || r.role === "admin")));
    if (!canAdmin) return json({ error: "forbidden" }, 403);

    const note = typeof body.note === "string" ? body.note : null;
    const r = await refundRegistration(registrationId, userId, note);
    if (!r.ok) return json({ error: r.error }, r.status);
    return json({ ok: true, registration_id: r.registration_id, already: r.already, pending: r.pending });
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
});
