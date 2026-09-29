import { serviceClient } from "../_shared/supabase.ts";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import { prescreeningRequestSchema } from "../_shared/prescreening.ts";

Deno.serve(async req => {
  const pre = preflight(req);
  if (pre) return pre;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...corsHeaders(req.headers.get("Origin")) },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if (!token) return json({ error: "unauthorized" }, 401);
  const db = serviceClient();
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || !auth.user?.email_confirmed_at || auth.user.is_anonymous) return json({ error: "verified_account_required" }, 401);
  const input = prescreeningRequestSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ error: "invalid_input", issues: input.error.flatten() }, 400);
  if (Deno.env.get("CATEGORY_ADMISSIONS_PAUSED") === "true") {
    const existing = await db.from("prescreening_batches").select("id")
      .eq("booked_by_user_id", auth.user.id).eq("idempotency_key", input.data.idempotency_key).maybeSingle();
    if (existing.error || !existing.data) return json({ error: "admissions_paused" }, 503);
  }
  const result = await db.rpc("prescreening_submit", { p_actor: auth.user.id, p_request: input.data });
  if (result.error) {
    const known = new Set(["category_capacity_exhausted", "event_capacity_exhausted", "participant_already_held",
      "participant_not_accessible", "verified_proof_required", "registration_closed", "reservations_not_open",
      "org_suspended", "category_not_found", "idempotency_conflict", "extend_payment_deadline_before_approval"]);
    if (known.has(result.error.message)) return json({ error: result.error.message }, result.error.code === "42501" ? 403 : 409);
    console.error("[prescreening-submit] request failed", { code: result.error.code });
    return json({ error: "request_unavailable" }, 503);
  }
  return json({ batch_id: result.data });
});
