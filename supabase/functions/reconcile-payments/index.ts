import { isAuthorizedBearer } from "../_shared/authz.ts";
import { confirmPayment } from "../_shared/confirm.ts";
import { verifyGroupPayment } from "../_shared/groupPaymentService.ts";
import { pmGetCheckoutSession, pmMethodFromSession, pmPaymentWebhookIssue } from "../_shared/paymongo.ts";
import { verifyReservationPayment } from "../_shared/reservationPayment.ts";
import { serviceClient } from "../_shared/supabase.ts";

type Candidate = { kind: "reservation" | "single" | "group"; subject_id: string; session_id: string; lease: string };

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAuthorizedBearer(req.headers.get("Authorization"), Deno.env.get("PAYMENT_EXPIRY_WORKER_SECRET"))) {
    return json({ error: "unauthorized" }, 401);
  }
  const db = serviceClient();
  const claimed = await db.rpc("payment_reconciliation_claim", { p_limit: 20 });
  if (claimed.error) return json({ error: "candidate_read_failed" }, 503);
  const candidates = (claimed.data ?? []) as Candidate[];
  const outcomes: Record<string, number> = {};
  let failedWrites = false;
  const inspect = async (candidate: Candidate) => {
    let outcome = "retry_required";
    try {
      if (candidate.kind === "reservation") {
        const result = await verifyReservationPayment(candidate.subject_id, undefined, candidate.session_id);
        outcome = result.status === "error" ? "retry_required" : result.status;
      } else if (candidate.kind === "group") {
        const result = await verifyGroupPayment(candidate.subject_id);
        outcome = result.status;
      } else {
        const session = await pmGetCheckoutSession(candidate.session_id);
        if (session.id !== candidate.session_id) throw new Error("session_identity_mismatch");
        if (!session.paid) outcome = "pending";
        else {
          const result = await confirmPayment(candidate.subject_id, pmMethodFromSession(session), {
            source: "reconciliation-worker", session: session.raw,
          });
          outcome = result.ok ? "paid" : result.error === "capture_review_required" ? "review_required" : "retry_required";
        }
      }
    } catch {
      // An uncertain GET keeps the existing ledger intact and retries later.
      outcome = "retry_required";
    }
    const finished = await db.rpc("payment_reconciliation_finish", {
      p_kind: candidate.kind, p_subject: candidate.subject_id, p_lease: candidate.lease, p_outcome: outcome,
    });
    if (finished.error || finished.data !== true) failedWrites = true;
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  };
  // Bound provider concurrency and total request time. Claims survive crashes;
  // existing settlement RPCs make retrying the same capture safe.
  for (let i = 0; i < candidates.length; i += 4) await Promise.all(candidates.slice(i, i + 4).map(inspect));
  let providerIssue: string | null;
  try { providerIssue = await pmPaymentWebhookIssue(); }
  catch { providerIssue = "payment_webhook_health_unavailable"; }
  const heartbeat = await db.rpc("payment_reconciliation_heartbeat", { p_provider_issue: providerIssue });
  if (failedWrites || heartbeat.error) return json({ error: "reconciliation_record_failed", outcomes }, 503);
  return json({ processed: candidates.length, outcomes, provider_issue: providerIssue });
});
