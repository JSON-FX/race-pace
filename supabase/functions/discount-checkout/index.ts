import { z } from "zod";
import { serviceClient } from "../_shared/supabase.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import {
  confirmFreeCheckout,
  restartDiscountCheckout,
} from "../_shared/discountCheckout.ts";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("restart"),
      registration_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("apply"),
      registration_id: z.string().uuid(),
      code: z.string().trim().max(40),
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm_free"),
      registration_id: z.string().uuid().optional(),
      order_id: z.string().uuid().optional(),
    })
    .strict(),
]);
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
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const token = req.headers
      .get("Authorization")
      ?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: "unauthorized" }, 401);
    const db = serviceClient(),
      auth = await db.auth.getUser(token);
    if (auth.error || !auth.data.user)
      return json({ error: "unauthorized" }, 401);
    if (auth.data.user.is_anonymous || !auth.data.user.email_confirmed_at)
      return json({ error: "booking_email_unverified" }, 403);
    const text = await req.text();
    if (text.length > 2048) return json({ error: "invalid_input" }, 400);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "invalid_input" }, 400);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return json({ error: "invalid_input" }, 400);
    const input = parsed.data,
      actor = auth.data.user.id;
    // Reuse the durable fixed-window limiter with a separate hashed namespace.
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`discount:${actor}`),
    );
    const key = Array.from(new Uint8Array(bytes), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    const limit = await db.rpc("consume_organizer_inquiry_limit", {
      p_key_hash: key,
      p_limit: 30,
      p_window_seconds: 60,
    });
    if (limit.error) return json({ error: "discount_unavailable" }, 503);
    if (!limit.data) return json({ error: "discount_rate_limited" }, 429);
    if (input.action === "restart")
      return json(await restartDiscountCheckout(actor, input.registration_id));
    if (input.action === "confirm_free") {
      if (!!input.registration_id === !!input.order_id)
        return json({ error: "invalid_input" }, 400);
      return json(
        await confirmFreeCheckout(actor, {
          registrationId: input.registration_id,
          orderId: input.order_id,
        }),
      );
    }
    const result = await db.rpc("discount_apply", {
      p_actor: actor,
      p_registration: input.registration_id,
      p_code: input.code,
    });
    if (result.error) throw new Error(result.error.message);
    return json(result.data);
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "discount_unavailable";
    const known =
      /^(discount_(invalid|inactive|ineligible|wrong_passport|already_used|exhausted|payment_locked|balance_too_small|fees_exceed_balance|mixed_fee_modes)|registration_not_found|hold_expired|org_suspended|registration_closed|order_not_found|order_entries_changed|waiver_required|sold_out|prescreening_payment_window_ended|reservation_deadline_passed)$/;
    return json(
      { error: known.test(code) ? code : "discount_unavailable" },
      known.test(code) ? 409 : 503,
    );
  }
});
