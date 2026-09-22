import { z } from "zod";
import { serviceClient } from "../_shared/supabase.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";

const schema = z.object({ order_id: z.string().uuid() }).strict();

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req.headers.get("Origin")) },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("GROUP_RESERVATIONS_ENABLED") !== "true") {
    return json({ error: "group_checkout_not_available" }, 503);
  }

  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: "unauthorized" }, 401);

  try {
    const db = serviceClient();
    const auth = await db.auth.getUser(token);
    if (auth.error || !auth.data.user) return json({ error: "unauthorized" }, 401);
    if (!auth.data.user.email_confirmed_at || auth.data.user.is_anonymous) {
      return json({ error: "booking_email_unverified" }, 403);
    }

    const raw = await req.text();
    if (raw.length > 4096) return json({ error: "request_too_large" }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "invalid_input" }, 400); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_input" }, 400);

    const result = await db.rpc("booking_order_cancel", {
      p_actor: auth.data.user.id,
      p_order: parsed.data.order_id,
    });
    if (result.error) {
      const codes: Record<string, number> = {
        invalid_input: 400,
        booking_email_unverified: 403,
        order_not_found: 404,
        order_not_cancellable: 409,
        payment_already_started: 409,
        order_entries_changed: 409,
      };
      const status = codes[result.error.message];
      if (status) return json({ error: result.error.message }, status);
      console.error("[group-order-cancel] database failure", result.error.code);
      return json({ error: "booking_cancellation_unavailable" }, 503);
    }
    return json(result.data);
  } catch {
    return json({ error: "booking_cancellation_unavailable" }, 503);
  }
});
