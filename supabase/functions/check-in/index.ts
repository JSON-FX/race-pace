import { serviceClient } from "../_shared/supabase.ts";
import { requireTicketSigningSecret, verifyTicketToken } from "../_shared/ticket.ts";
import { canCheckIn, type RoleRow } from "../_shared/authz.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";

// Staff-only. Verifies the scanned QR ticket, authorizes the scanner for the event's org,
// records the check-in (one per registration). The DB trigger notifies the runner.
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const token = body?.ticket_token;
    const eventId = body?.event_id;
    if (typeof token !== "string" || !token) return json({ error: "ticket_token_required" }, 400);
    if (typeof eventId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
      return json({ error: "event_id_required" }, 400);
    }

    const configuredSecret = Deno.env.get("TICKET_SIGNING_SECRET");
    if (!configuredSecret?.trim()) return json({ error: "ticket_signing_not_configured" }, 503);
    const secret = requireTicketSigningSecret(configuredSecret);
    const payload = await verifyTicketToken(token, secret);
    if (!payload) return json({ error: "invalid_ticket" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);

    const { data: reg } = await db.from("registrations").select("id,org_id,event_id,status").eq("id", payload.rid).single();
    if (!reg) return json({ error: "not_found" }, 404);
    if (reg.status !== "paid") return json({ error: "not_paid" }, 409);

    const { data: roles } = await db.from("user_roles").select("role,org_id,event_scope").eq("user_id", userRes.user.id);
    if (!canCheckIn((roles ?? []) as RoleRow[], reg.org_id, reg.event_id)) return json({ error: "forbidden" }, 403);

    // Staff may operate several races. Authorization alone does not establish
    // that this ticket belongs at the station currently selected in the console.
    if (payload.eid !== reg.event_id) return json({ error: "invalid_ticket" }, 400);
    if (reg.event_id !== eventId) return json({ error: "wrong_event" }, 409);

    const { data, error } = await db.rpc("checkin_record_tx", {
      p_registration_id: reg.id, p_event_id: eventId, p_actor_id: userRes.user.id,
    });
    if (error || !data) {
      console.error("check-in: transaction failed", error);
      return json({ error: "server_error" }, 500);
    }
    if (data.error) return json(data, data.error === "forbidden" ? 403 : data.error === "not_found" ? 404 : 409);
    return json(data);
  } catch {
    return json({ error: "server_error" }, 500);
  }
});
