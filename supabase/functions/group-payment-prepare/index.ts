import { z } from "zod";
import { serviceClient } from "../_shared/supabase.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";

const inputSchema = z.object({
  order_id: z.string().uuid(), method: z.enum(["card", "gcash", "maya"]), idempotency_key: z.string().uuid(),
}).strict();
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...corsHeaders(req.headers.get("Origin")) },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // No provider dispatch in this endpoint. Enable only for internal quote QA.
  if (Deno.env.get("GROUP_PAYMENT_PREPARATION_ENABLED") !== "true") return json({ error: "group_checkout_not_available" }, 503);
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: "unauthorized" }, 401);
  try {
    const db = serviceClient();
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) return json({ error: "unauthorized" }, 401);
    if (!data.user.email_confirmed_at || data.user.is_anonymous) return json({ error: "booking_email_unverified" }, 403);
    const raw = await req.text();
    if (raw.length > 4096) return json({ error: "request_too_large" }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid_input" }, 400); }
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_input" }, 400);
    const input = parsed.data;
    const result = await db.rpc("booking_order_prepare_payment", { p_actor: data.user.id, p_order: input.order_id, p_method: input.method, p_key: input.idempotency_key });
    if (result.error) {
      const codes: Record<string, number> = { invalid_input: 400, booking_email_unverified: 403, order_not_found: 404,
        order_not_pending: 409, hold_expired: 409, registration_closed: 409, org_suspended: 409,
        order_entries_changed: 409, idempotency_conflict: 409, payment_attempt_in_progress: 409,
        invalid_terms: 503, rate_card_missing: 503, invalid_processor_rate: 503, order_amount_too_large: 422 };
      const status = codes[result.error.message];
      if (status) return json({ error: result.error.message }, status);
      console.error("[group-payment-prepare] database failure", result.error.code);
      return json({ error: "payment_preparation_unavailable" }, 503);
    }
    return json(result.data);
  } catch {
    return json({ error: "payment_preparation_unavailable" }, 503);
  }
});
