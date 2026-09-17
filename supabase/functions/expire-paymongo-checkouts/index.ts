import { isAuthorizedBearer } from "../_shared/authz.ts";
import { confirmPayment } from "../_shared/confirm.ts";
import { pmExpireCheckoutSession, pmGetCheckoutSession, pmMethodFromSession } from "../_shared/paymongo.ts";
import { serviceClient } from "../_shared/supabase.ts";

type Candidate = { registration_id: string; session_id: string | null };

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAuthorizedBearer(req.headers.get("Authorization"), Deno.env.get("PAYMENT_EXPIRY_WORKER_SECRET"))) {
    return json({ error: "unauthorized" }, 401);
  }

  const db = serviceClient();
  const { data, error } = await db.rpc("paymongo_expiry_candidates", { p_limit: 20 });
  if (error) return json({ error: "candidate_read_failed" }, 503);
  const results: Record<string, number> = {};
  const count = (outcome: string) => { results[outcome] = (results[outcome] ?? 0) + 1; };

  for (const candidate of (data ?? []) as Candidate[]) {
    const rid = candidate.registration_id;
    const sessionId = candidate.session_id;
    const record = async (outcome: string, detail: Record<string, unknown> = {}) => {
      const stored = await db.rpc("record_paymongo_expiry_attempt", {
        p_registration_id: rid, p_session_id: sessionId,
        p_outcome: outcome, p_detail: detail,
      });
      if (stored.error) throw new Error("expiry_attempt_write_failed");
      count(outcome);
    };
    try {
      if (!sessionId?.startsWith("cs_")) {
        // An uncertain checkout creation may have reached PayMongo without a
        // locally bound session. Never release its reservation on a guess.
        await record("missing_session_ref");
        continue;
      }

      const expiry = await pmExpireCheckoutSession(sessionId);
      // Even a successful expiry call can race with a capture or its webhook.
      // Read the session before changing local money and reservation state.
      const session = await pmGetCheckoutSession(sessionId);
      if (session.id !== sessionId) {
        await record("session_identity_mismatch");
      } else if (session.paid) {
        const confirmed = await confirmPayment(rid, pmMethodFromSession(session), {
          source: "expiry-worker", session_id: sessionId, session: session.raw,
        });
        await record(confirmed.ok ? "captured" : "capture_review_required", {
          error: confirmed.ok ? null : confirmed.error,
        });
      } else if (session.status === "expired") {
        const finished = await db.rpc("finish_paymongo_checkout_expiry", {
          p_registration_id: rid, p_session_id: sessionId,
          p_provider_evidence: { source: "paymongo_get", status: "expired", expire_response: expiry },
        });
        if (finished.error) throw new Error("local_expiry_write_failed");
        if (finished.data === "expired") count("expired");
        else await record(String(finished.data ?? "local_expiry_unknown"));
      } else {
        await record("provider_payment_ongoing", { provider_status: session.status });
      }
    } catch (e) {
      // An uncertain provider or database result keeps the registration live.
      // A later worker run can retry without creating another checkout.
      console.error("[expiry-worker] checkout remains unresolved", { registrationId: rid, error: String(e) });
      try { await record("retry_required", { error: String(e).slice(0, 200) }); }
      catch (recordError) { console.error("[expiry-worker] attempt log failed", { registrationId: rid, error: String(recordError) }); }
    }
  }
  return json({ processed: (data ?? []).length, outcomes: results });
});
