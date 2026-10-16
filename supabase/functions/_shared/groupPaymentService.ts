import { confirmFreeCheckout } from "./discountCheckout.ts";
import { serviceClient } from "./supabase.ts";
import { buildGroupSessionRequest, createGroupSession, retrieveGroupSession, extractGroupCaptures, type GroupCapture } from "./groupPaymongo.ts";
import { mintTicketToken } from "./ticket.ts";

function credentials() {
  const secret = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
  if (!/^sk_(test|live)_/.test(secret)) throw new Error("payment_provider_not_configured");
  return { secret, livemode: secret.startsWith("sk_live_") };
}
export async function startGroupPayment(actor: string, attemptId: string) {
  const db = serviceClient();
  const attempt = await db.from("booking_payment_attempts").select("*").eq("id", attemptId).eq("booked_by_user_id", actor).single();
  if (attempt.error || !attempt.data) throw new Error("attempt_not_found");
  const a = attempt.data;
  if (a.gross_cents === 0) return confirmFreeCheckout(actor, { orderId: a.booking_order_id });
  const { secret, livemode } = credentials();
  const saved = await db.from("booking_payment_dispatches").select("request_body").eq("attempt_id", attemptId).maybeSingle();
  if (saved.error) throw new Error("payment_unavailable");
  const base = Deno.env.get("GROUP_PAYMENT_RETURN_URL");
  if (!base && !saved.data) throw new Error("payment_return_not_configured");
  const returnUrl = new URL(base ?? "https://unused.invalid");
  returnUrl.searchParams.set("order_id", a.booking_order_id);
  const body = saved.data?.request_body ?? buildGroupSessionRequest({ attemptId: a.id, orderId: a.booking_order_id, method: a.method,
    baseCents: a.base_cents, platformFeeCents: a.platform_fee_cents, processorSurchargeCents: a.processor_surcharge_cents,
    grossCents: a.gross_cents, feeMode: a.terms_snapshot.fee_mode,
    providerManagedFee: a.terms_snapshot.provider_managed_fee === true,
    returnUrl: returnUrl.toString() });
  const claim = await db.rpc("booking_payment_claim_dispatch", { p_actor: actor, p_attempt: attemptId, p_request: body, p_livemode: livemode });
  if (claim.error) throw new Error(claim.error.message);
  if (claim.data.action !== "dispatch") {
    if (claim.data.action === "ready") {
      const state = await verifyGroupPayment(attemptId);
      if (state.status !== "pending") return { action: state.status };
    }
    return claim.data;
  }
  try {
    const session = await createGroupSession(body, a.id, secret);
    const bound = await db.rpc("booking_payment_bind_session", { p_attempt: attemptId, p_session: session.sessionId, p_url: session.checkoutUrl });
    if (bound.error) throw new Error("session_write_failed");
    return { action: "ready", checkout_url: session.checkoutUrl };
  } catch {
    // Even a lost DB response can follow successful provider creation. Never
    // reopen this attempt or return an unpersisted URL after an uncertain call.
    await db.rpc("booking_payment_dispatch_unknown", { p_attempt: attemptId });
    throw new Error("payment_creation_unknown");
  }
}

type StoredCapture = { payment_id: string; capture: GroupCapture; state: string };

function failureCode(error: unknown): string {
  // SQLSTATE is useful for code failures such as the pre-screening 42703.
  // Never retain a provider response, database detail, or arbitrary exception text.
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return ["ticket_signing_not_configured", "order_entries_changed"].includes(message)
    ? message : "payment_confirmation_unavailable";
}

async function fulfillStoredCaptures(attemptId: string, captures: StoredCapture[]) {
  const db = serviceClient();
  const states = captures.filter(capture => capture.state !== "received").map(capture => capture.state);
  const pending = captures.filter(capture => capture.state === "received");
  if (pending.length) {
    const tokens: Record<string, string> = {};
    let preparationError: unknown;
    try {
      const signingSecret = Deno.env.get("TICKET_SIGNING_SECRET");
      if (!signingSecret) throw new Error("ticket_signing_not_configured");
      const attempt = await db.from("booking_payment_attempts").select("booking_order_id").eq("id", attemptId).single();
      if (attempt.error) throw attempt.error;
      const order = await db.from("booking_orders").select("event_id").eq("id", attempt.data.booking_order_id).single();
      const lines = await db.from("booking_payment_quote_lines").select("registration_id").eq("attempt_id", attemptId);
      if (order.error || lines.error || !lines.data?.length) throw new Error("order_entries_changed");
      for (const line of lines.data) tokens[line.registration_id] = await mintTicketToken({
        rid: line.registration_id, eid: order.data.event_id, iat: Math.floor(Date.now() / 1000),
      }, signingSecret);
    } catch (error) { preparationError = error; }
    for (const capture of pending) {
      try {
        if (preparationError) throw preparationError;
        const result = await db.rpc("booking_payment_confirm", {
          p_attempt: attemptId, p_capture: capture.capture, p_tokens: tokens,
        });
        if (result.error) throw result.error;
        if (!["fulfilled", "reconciliation_required"].includes(result.data)) throw new Error("payment_confirmation_unavailable");
        states.push(result.data);
      } catch (error) {
        const code = failureCode(error);
        const recorded = await db.rpc("booking_payment_capture_failure", {
          p_attempt: attemptId, p_payment_id: capture.payment_id, p_error_code: code,
        });
        console.error("[group-payment] fulfillment retry required", {
          attempt_id: attemptId, payment_id: capture.payment_id, error_code: code,
        });
        if (recorded.error) throw new Error("payment_confirmation_unavailable");
        states.push("received");
      }
    }
  }
  return { status: states.includes("received") ? "processing"
    : states.includes("reconciliation_required") ? "reconciliation_required" : "paid" };
}

/** Called only after booker/admin authorization or verified webhook signature. */
export async function verifyGroupPayment(attemptId: string, options: {
  refreshProvider?: boolean; expectedPaymentIds?: string[]; expectedSessionId?: string;
} = {}) {
  const db = serviceClient();
  const free = await db.from("booking_payment_attempts").select("status,gross_cents").eq("id", attemptId).single();
  if (free.error) throw new Error("attempt_not_found");
  if (free.data?.gross_cents === 0) return { status: free.data.status === "paid" ? "paid" : "pending" };
  const stored = await db.from("booking_payment_captures").select("payment_id,capture,state").eq("attempt_id", attemptId).order("created_at").order("id");
  if (stored.error) throw new Error("payment_confirmation_unavailable");
  // Recovery must work during a provider outage. A new webhook still refreshes
  // the session so an additional payment cannot be acknowledged unseen.
  if (!options.refreshProvider && stored.data.some(capture => capture.state === "received")) {
    return fulfillStoredCaptures(attemptId, stored.data as StoredCapture[]);
  }
  const { secret, livemode } = credentials();
  const dispatch = await db.from("booking_payment_dispatches").select("session_id,livemode").eq("attempt_id", attemptId).single();
  if (dispatch.error || !dispatch.data?.session_id) throw new Error("session_not_ready");
  if (options.expectedSessionId && options.expectedSessionId !== dispatch.data.session_id) throw new Error("session_identity_mismatch");
  if (dispatch.data.livemode !== livemode) throw new Error("payment_environment_mismatch");
  const raw = await retrieveGroupSession(dispatch.data.session_id, secret);
  const captures = extractGroupCaptures(raw);
  if (!captures.length) {
    // A paid notification is never satisfied by an unpaid/expired snapshot.
    // Previously persisted evidence still suffices for an exact replay.
    if (options.expectedPaymentIds?.length) {
      return options.expectedPaymentIds.every(id => stored.data.some(capture => capture.payment_id === id))
        ? fulfillStoredCaptures(attemptId, stored.data as StoredCapture[]) : { status: "pending" };
    }
    const sessionStatus = (raw as { data?: { attributes?: { status?: string } } })?.data?.attributes?.status;
    if (sessionStatus === "expired") {
      const retried = await db.rpc("booking_payment_retry_expired", { p_attempt: attemptId, p_session: dispatch.data.session_id,
        p_evidence: { source: "paymongo_get", status: "expired" } });
      if (retried.error) throw new Error("payment_confirmation_unavailable");
      if (retried.data === true) return { status: "expired" };
    }
    return { status: "pending" };
  }
  // The observation is its own committed transaction. Ticket configuration or
  // a later SQL failure must never erase evidence that PayMongo received money.
  for (const capture of captures) {
    const observed = await db.rpc("booking_payment_capture_observe", { p_attempt: attemptId, p_capture: capture });
    if (observed.error) throw new Error("payment_capture_write_failed");
  }
  const observed = await db.from("booking_payment_captures").select("payment_id,capture,state").eq("attempt_id", attemptId).order("created_at").order("id");
  if (observed.error || !observed.data?.length) throw new Error("payment_confirmation_unavailable");
  if (options.expectedPaymentIds?.some(id => !observed.data.some(capture => capture.payment_id === id))) return { status: "pending" };
  return fulfillStoredCaptures(attemptId, observed.data as StoredCapture[]);
}
