import { serviceClient } from "../_shared/supabase.ts";
import { verifyTicketToken } from "../_shared/ticket.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        ...corsHeaders(req.headers.get("Origin")),
      },
    });
  try {
    if (req.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    const db = serviceClient();
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth, error } = await db.auth.getUser(jwt);
    if (error || !auth.user) return json({ error: "unauthorized" }, 401);
    const b = await req.json().catch(() => null);
    if (!b || !uuid(b.event_id) || !uuid(b.registration_id))
      return json({ error: "invalid_request" }, 400);
    if (b.ticket_token !== undefined) {
      if (typeof b.ticket_token !== "string")
        return json({ error: "invalid_ticket" }, 400);
      const secret = Deno.env.get("TICKET_SIGNING_SECRET");
      if (!secret) return json({ error: "server_error" }, 500);
      const ticket = await verifyTicketToken(b.ticket_token, secret);
      if (
        !ticket ||
        ticket.rid !== b.registration_id ||
        ticket.eid !== b.event_id
      )
        return json({ error: "invalid_ticket" }, 400);
    }
    let result;
    if (b.action === "reverse") {
      if (!uuid(b.release_id) || typeof b.reason !== "string")
        return json({ error: "invalid_request" }, 400);
      result = await db.rpc("kit_release_reverse_tx", {
        p_registration_id: b.registration_id,
        p_event_id: b.event_id,
        p_actor_id: auth.user.id,
        p_release_id: b.release_id,
        p_reason: b.reason,
      });
    } else if (b.action === "release") {
      if (
        !uuid(b.request_id) ||
        b.runner_present !== true ||
        !b.expected_kit ||
        typeof b.expected_kit !== "object"
      )
        return json({ error: "invalid_request" }, 400);
      result = await db.rpc("kit_release_tx", {
        p_registration_id: b.registration_id,
        p_event_id: b.event_id,
        p_actor_id: auth.user.id,
        p_request_id: b.request_id,
        p_expected_kit: b.expected_kit,
      });
    } else return json({ error: "invalid_request" }, 400);
    if (result.error || !result.data)
      return json({ error: "server_error" }, 500);
    return json(
      result.data,
      result.data.error ? (result.data.error === "forbidden" ? 403 : 409) : 200,
    );
  } catch {
    return json({ error: "server_error" }, 500);
  }
});
