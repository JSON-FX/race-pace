import { z } from "zod";
import { serviceClient } from "../_shared/supabase.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { startGroupPayment, verifyGroupPayment } from "../_shared/groupPaymentService.ts";
const schema = z.object({ attempt_id: z.string().uuid(), action: z.enum(["session", "verify"]) }).strict();
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...corsHeaders(req.headers.get("Origin")) } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("GROUP_PAYMENTS_ENABLED") !== "true") return json({ error: "group_checkout_not_available" }, 503);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: "unauthorized" }, 401);
    const db = serviceClient(), auth = await db.auth.getUser(token);
    if (auth.error || !auth.data.user) return json({ error: "unauthorized" }, 401);
    if (!auth.data.user.email_confirmed_at || auth.data.user.is_anonymous) return json({ error: "booking_email_unverified" }, 403);
    const text = await req.text(); if (text.length > 4096) return json({ error: "invalid_input" }, 400);
    let raw: unknown; try { raw = JSON.parse(text); } catch { return json({ error: "invalid_input" }, 400); }
    const parsed = schema.safeParse(raw); if (!parsed.success) return json({ error: "invalid_input" }, 400);
    const { attempt_id, action } = parsed.data;
    const own = await db.from("booking_payment_attempts").select("id").eq("id", attempt_id).eq("booked_by_user_id", auth.data.user.id).maybeSingle();
    if (own.error) return json({ error: "payment_unavailable" }, 503);
    if (!own.data) return json({ error: "attempt_not_found" }, 404);
    return json(action === "session" ? await startGroupPayment(auth.data.user.id, attempt_id) : await verifyGroupPayment(attempt_id));
  } catch (error) {
    const code = error instanceof Error ? error.message : "payment_unavailable";
    const known: Record<string, number> = { attempt_not_found: 404, booking_email_unverified: 403, order_not_payable: 409,
      order_entries_changed: 409, registration_closed: 409, org_suspended: 409, attempt_not_prepared: 409,
      dispatch_request_changed: 409, free_order_requires_confirmation: 409, session_not_ready: 409,
      payment_creation_unknown: 503, payment_confirmation_unavailable: 503 };
    return json({ error: known[code] ? code : "payment_unavailable" }, known[code] ?? 503);
  }
});
