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
