import { serviceClient } from "../_shared/supabase.ts";
import { buildExpoMessages, chunk, deadTokens, type PushNotification, type ExpoTicket } from "../_shared/push.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Drains pending notifications and delivers them as Expo push. Invoked every minute by
// pg_cron via pg_net with the service-role key in the Authorization header (verify_jwt=false).
Deno.serve(async (req) => {
  const auth = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (auth !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return json({ error: "unauthorized" }, 401);

  const db = serviceClient();
  const { data: notes, error: notesError } = await db.from("notifications")
    .select("id,user_id,type,title,body,data").is("push_sent_at", null)
    .order("created_at", { ascending: true }).limit(200);
  if (notesError) {
    console.error("send-push: pending-notifications select failed", notesError);
    return json({ error: "query failed" }, 500);
  }
  if (!notes || notes.length === 0) return json({ sent: 0 });

  const userIds = [...new Set(notes.map((n) => n.user_id))];
  const { data: tokenRows, error: tokensError } = await db.from("device_tokens").select("user_id,token").in("user_id", userIds);
  if (tokensError) console.error("send-push: device_tokens select failed", tokensError);
  const tokensByUser = new Map<string, string[]>();
  for (const r of tokenRows ?? []) tokensByUser.set(r.user_id, [...(tokensByUser.get(r.user_id) ?? []), r.token]);

  const messages = buildExpoMessages(notes as PushNotification[], tokensByUser);
  const allDead: string[] = [];
  for (const batch of chunk(messages, 100)) {
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch),
      });
      if (!res.ok) console.warn("send-push: expo returned", res.status);
      const body = await res.json().catch(() => ({ data: [] }));
      allDead.push(...deadTokens(batch, (body.data ?? []) as ExpoTicket[]));
    } catch { /* leave push_sent_at set; realtime already delivered in-app */ }
  }

  // Best-effort: mark every drained row sent so the queue never clogs (tokenless users included).
  const { error: updateError } = await db.from("notifications")
    .update({ push_sent_at: new Date().toISOString() }).in("id", notes.map((n) => n.id));
  if (updateError) console.error("send-push: push_sent_at update failed", updateError);
  if (allDead.length) {
    const { error: deleteError } = await db.from("device_tokens").delete().in("token", [...new Set(allDead)]);
    if (deleteError) console.error("send-push: device_tokens delete failed", deleteError);
  }
  return json({ sent: messages.length, pruned: allDead.length });
});
