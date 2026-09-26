import { serviceClient } from "../_shared/supabase.ts";
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
  const raw = await req.json().catch(() => ({}));
  if (typeof raw?.event_id !== "string" || !UUID.test(raw.event_id)) {
    return json({ error: "invalid_event" }, 400);
  }
  const db = serviceClient();
  const { data: auth, error: authError } = await db.auth.getUser(jwt);
  const user = auth.user;
  if (authError || !user?.email || !user.email_confirmed_at || user.is_anonymous) {
    return json({ error: "verified_account_required" }, 401);
  }
  const { data, error } = await db.rpc("subscribe_coming_soon", {
    p_event_id: raw.event_id, p_user_id: user.id, p_email: user.email,
  });
  if (error) {
    if (error.message.includes("notifications_not_open")) return json({ error: "notifications_not_open" }, 409);
    console.error("[coming-soon-subscribe] save failed", { eventId: raw.event_id, code: error.code });
    return json({ error: "save_failed" }, 503);
  }
  return json({ ok: true, already: data === "already" });
});
