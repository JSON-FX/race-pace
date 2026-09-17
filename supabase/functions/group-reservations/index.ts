import { serviceClient } from "../_shared/supabase.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { groupReservationInputSchema } from "../_shared/groupRegistration.ts";
import { prepareGroupLine, ReservationInputError } from "../_shared/groupReservationValidation.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...corsHeaders(req.headers.get("Origin")) },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // Reservation-only QA entry point. Do not enable for customers before the
  // order payment, refund and report paths can consume these registrations.
  if (Deno.env.get("GROUP_RESERVATIONS_ENABLED") !== "true") return json({ error: "group_checkout_not_available" }, 503);
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: "unauthorized" }, 401);
  try {
    const db = serviceClient();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "unauthorized" }, 401);
    if (!auth.user.email_confirmed_at || auth.user.is_anonymous) return json({ error: "booking_email_unverified" }, 403);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 65536) return json({ error: "request_too_large" }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid_input" }, 400); }
    const parsed = groupReservationInputSchema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_input" }, 400);
    const input = parsed.data;
    const args = { p_actor: auth.user.id, p_request: input };
    const rpcError = (error: { code?: string; message: string }) => {
      const errors: Record<string, number> = {
        idempotency_conflict: 409, category_not_found: 404, registration_closed: 409,
        org_suspended: 409, waiver_version_changed: 409, reservation_input_changed: 409,
        participant_not_accessible: 403, participant_acceptance_required: 422,
        participant_already_registered: 409, booking_email_unverified: 403,
        invalid_addons: 422, invalid_input: 400, order_amount_too_large: 422,
      };
      if (error.message.includes("category_capacity_exhausted")) return json({ error: "sold_out" }, 409);
      if (error.message.includes("registrations_one_live_per_event")) return json({ error: "participant_already_registered" }, 409);
      const status = errors[error.message];
      if (status) return json({ error: error.message }, status);
      // Deadlocks/serialization failures are safe to retry using the SAME key.
      console.error("[group-reservations] database failure", error.code);
      return json({ error: "reservation_unavailable" }, 503);
    };
    const replay = await db.rpc("booking_order_reserve", args);
    if (replay.error) return rpcError(replay.error);
    if (replay.data) return json(replay.data);

    const ids = input.participants.map((line) => line.participant_passport_id);
    const passports = await db.from("runner_passports").select("*").in("id", ids);
    const managers = await db.from("passport_managers").select("passport_id").eq("user_id", auth.user.id).in("passport_id", ids);
    const fields = await db.from("form_fields").select("*").eq("event_id", input.event_id).eq("is_active", true).order("id");
    if (passports.error || managers.error || fields.error) return json({ error: "reservation_unavailable" }, 503);
    const managed = new Set((managers.data ?? []).map((row) => row.passport_id));
    const lines = input.participants.map((line) => {
      const passport = passports.data?.find((row) => row.id === line.participant_passport_id);
      if (!passport || (passport.claimed_user_id !== auth.user.id && (passport.claimed_user_id || !managed.has(passport.id)))) {
        throw new ReservationInputError("participant_not_accessible", 403);
      }
      return prepareGroupLine(line, passport, fields.data ?? [], auth.user.id, new Date().toISOString().slice(0, 10));
    });
    const result = await db.rpc("booking_order_reserve", { ...args, p_lines: lines, p_fields: fields.data ?? [] });
    if (result.error) return rpcError(result.error);
    return json(result.data);
  } catch (error) {
    if (error instanceof ReservationInputError) return json({ error: error.code, participant_passport_id: error.passportId }, error.status);
    console.error("[group-reservations] unexpected failure");
    return json({ error: "reservation_unavailable" }, 503);
  }
});
