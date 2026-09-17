import { z } from "zod";
import { serviceClient } from "../_shared/supabase.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { refundGroup } from "../_shared/groupRefund.ts";
const schema = z.object({
  order_id: z.string().uuid(), registration_ids: z.array(z.string().uuid()).min(1).max(10).optional(),
  idempotency_key: z.string().uuid(), preview: z.boolean().default(false),
  expected_amount: z.number().int().min(0).max(2147483647).optional(),
}).strict().refine(v => v.preview || v.expected_amount !== undefined);
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...corsHeaders(req.headers.get("Origin")) } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("GROUP_REFUNDS_ENABLED") !== "true") return json({ error: "group_refunds_not_available" }, 503);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: "unauthorized" }, 401);
    const auth = await serviceClient().auth.getUser(token);
    if (auth.error || !auth.data.user) return json({ error: "unauthorized" }, 401);
    if (!auth.data.user.email_confirmed_at || auth.data.user.is_anonymous) return json({ error: "email_unverified" }, 403);
    const text = await req.text(); if (text.length > 4096) return json({ error: "invalid_input" }, 400);
    let raw: unknown; try { raw = JSON.parse(text); } catch { return json({ error: "invalid_input" }, 400); }
    const input = schema.safeParse(raw); if (!input.success) return json({ error: "invalid_input" }, 400);
    return json(await refundGroup(auth.data.user.id, input.data));
  } catch (e) {
    const code = e instanceof Error ? e.message : "refund_unavailable";
    const known: Record<string, number> = { forbidden: 403, order_not_found: 404, invalid_selection: 400,
      idempotency_conflict: 409, refund_amount_changed: 409, provider_scope_changed: 409,
      fulfilled_capture_required: 409, refund_in_progress: 409, no_refundable_tickets: 409,
      tickets_not_refundable: 409, actual_fees_required: 409, policy_forbids: 409,
      refund_below_provider_minimum: 409, refund_budget_exceeded: 409,
      provider_not_configured: 503, refund_provider_unknown: 503, refund_result_unavailable: 503 };
    return json({ error: known[code] ? code : "refund_unavailable" }, known[code] ?? 503);
  }
});
