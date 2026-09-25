import { serviceClient } from "../_shared/supabase.ts";
import { verifyReservationPayment } from "../_shared/reservationPayment.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...cors },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(body?.reservation_id ?? "")) return json({ error: "invalid_reservation" }, 400);
  const db = serviceClient();
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth.user) return json({ error: "unauthorized" }, 401);
  const { data: reservation } = await db.from("event_reservations")
    .select("id,user_id,status").eq("id", body.reservation_id).maybeSingle();
  if (!reservation || reservation.user_id !== auth.user.id) return json({ error: "not_found" }, 404);
  const result = await verifyReservationPayment(reservation.id);
  if (result.status === "error") return json({ error: result.error }, 503);
  return json({ reservation_id: reservation.id, status: result.status });
});
