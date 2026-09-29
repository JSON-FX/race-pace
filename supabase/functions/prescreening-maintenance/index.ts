import { serviceClient } from "../_shared/supabase.ts";
import { isAuthorizedBearer } from "../_shared/authz.ts";
import { reconcileExpiredGroup } from "../_shared/groupExpiry.ts";
Deno.serve(async req => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAuthorizedBearer(req.headers.get("Authorization"), Deno.env.get("PAYMENT_EXPIRY_WORKER_SECRET"))) return json({ error: "unauthorized" }, 401);
  const db = serviceClient();
  const { data, error } = await db.from("prescreening_batches").select("id,booking_order_id").eq("status", "ready")
    .lte("payment_deadline_at", new Date().toISOString()).order("maintenance_checked_at", { nullsFirst: true }).limit(50);
  if (error) return json({ error: "candidate_read_failed" }, 503);
  const outcomes: Record<string, number> = {};
  for (const batch of data ?? []) {
    try {
      if (batch.booking_order_id) await reconcileExpiredGroup(batch.booking_order_id);
      const result = await db.rpc("prescreening_finish_expiry", { p_batch: batch.id });
      if (result.error) throw new Error("expiry_failed");
      outcomes[result.data] = (outcomes[result.data] ?? 0) + 1;
    } catch { outcomes.retry_required = (outcomes.retry_required ?? 0) + 1; }
  }
  const refreshed = await db.rpc("prescreening_maintenance", { p_limit: 200 });
  if (refreshed.error) return json({ error: "maintenance_failed", outcomes }, 503);
  const cleanup = await db.rpc("prescreening_collect_unused_proofs", { p_limit: 50 });
  if (cleanup.error) return json({ error: "proof_cleanup_failed", outcomes }, 503);
  for (const path of (cleanup.data ?? []) as string[]) {
    const removed = await db.storage.from("prescreening-proofs").remove([path]);
    if (removed.error) { outcomes.proof_cleanup_retry = (outcomes.proof_cleanup_retry ?? 0) + 1; continue; }
    const finished = await db.from("prescreening_proof_cleanup").delete().eq("object_path", path);
    const outcome = finished.error ? "proof_cleanup_retry" : "proof_removed";
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  return json({ processed: data?.length ?? 0, outcomes });
});
