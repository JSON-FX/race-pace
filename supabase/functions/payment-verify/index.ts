import { serviceClient } from "../_shared/supabase.ts";
import { confirmPayment } from "../_shared/confirm.ts";
import { paymongoConfigured, pmGetCheckoutSession, pmMethodFromSession } from "../_shared/paymongo.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";

// Confirms a PayMongo checkout server-side by re-fetching the session from PayMongo —
// the browser redirect is NEVER trusted. Called by the app after it returns from the
// hosted checkout (and by the "Check again" button). Requires the runner's JWT and only
// acts on that runner's own registration.
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const registrationId = body?.registration_id as string | undefined;
    if (!registrationId) return json({ error: "registration_id_required" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    const { data: reg } = await db
      .from("registrations")
      .select("id,status,user_id")
      .eq("id", registrationId)
      .single();
    if (!reg || reg.user_id !== userId) return json({ error: "not_found" }, 404);
    if (reg.status === "paid") return json({ status: "paid", already: true });

    // Without PayMongo configured there's nothing to re-fetch; report current status.
    if (!paymongoConfigured()) return json({ status: reg.status });

    const { data: pay } = await db
      .from("payments")
      .select("provider_ref")
      .eq("registration_id", registrationId)
      .single();
    const ref = pay?.provider_ref;
    if (!ref || !ref.startsWith("cs_")) return json({ status: reg.status });

    const session = await pmGetCheckoutSession(ref);
    if (!session.paid) return json({ status: "pending" });

    // The instrument the runner used, not the provider. This previously passed
    // the literal "paymongo", so the admin Payments method column was useless for
    // every redirect-confirmed row — which is most of them. The webhook already
    // read this correctly, meaning the recorded method depended on which path
    // happened to confirm first. The session is already in hand; no extra fetch.
    const method = pmMethodFromSession(session);
    // Persist the WHOLE session, not just its id.
    //
    // The old payload was `{source, session_id}`, which threw away the only copy
    // of the payment details we will ever hold: PayMongo deletes a checkout
    // session after it completes (a later GET returns `not_found`), so once this
    // request ends the instrument is unrecoverable from anywhere. That is
    // precisely how a real GCash payment ended up permanently displayed as
    // "Unknown" — the method was mis-recorded AND nothing was kept to repair it
    // from. The webhook path already stores its full event; this matches it.
    const r = await confirmPayment(registrationId, method, {
      source: "payment-verify",
      session_id: ref,
      session: session.raw,
    });
    if (!r.ok) return json({ error: r.error }, r.status);
    return json({ status: "paid", registration_id: r.registration_id });
  } catch (e) {
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
