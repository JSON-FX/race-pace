import { serviceClient } from "../_shared/supabase.ts";
import { getPaymentProviderByName } from "../_shared/payments.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { isRegistrationClosed } from "../_shared/eventStatus.ts";
import { computeFee, type FeeTerms } from "../_shared/fee.ts";
import { passOnBreakdown, type ProcessorRate } from "../_shared/processorFee.ts";

// The register flow creates an all-methods checkout at registration time (before the runner picks
// how to pay). When they choose a method on the pay screen and tap Pay, this recreates the PayMongo
// checkout scoped to just that method, so the hosted page opens straight to it. Maya is "paymaya"
// in PayMongo; unknown keys are rejected.
const METHOD_MAP: Record<string, string> = { card: "card", gcash: "gcash", maya: "paymaya" };

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const raw = await req.json();
    const registrationId = typeof raw?.registration_id === "string" ? raw.registration_id : "";
    const method = typeof raw?.method === "string" ? raw.method : "";
    const returnUrl = typeof raw?.return_url === "string" && raw.return_url ? raw.return_url : "racepace://pay-callback";
    // See registrations-checkout: this is the method-scoped session the pay screen actually
    // opens, so this is the return_url that drives the post-payment redirect.
    console.log(`[payment-session] method=${method} return_url=${returnUrl}${raw?.return_url ? "" : " (DEFAULTED — app sent none)"}`);
    const pmMethod = METHOD_MAP[method];
    if (!registrationId || !pmMethod) return json({ error: "invalid_input" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    // Own the registration + it must still be payable. Service role bypasses RLS, so check ownership.
    // The org's terms come along on this SAME read — mode AND all three commission
    // columns, not just fee_mode. Fetching only the mode would send a 'fixed' org
    // down computeFee's percent branch and its `?? 0.10` default, surcharging the
    // runner 10% instead of the org's flat fee, silently. Same reasoning as
    // _shared/confirm.ts's select.
    const { data: reg } = await db.from("registrations")
      // One string literal, not a concatenation: supabase-js parses the select
      // at the type level, and `a + b` is `string` to TypeScript — which erases
      // every column type on `reg`.
      .select("id,user_id,status,total_amount,category_id,event_id,expires_at,organizations(fee_mode,commission_type,commission_rate,commission_flat_cents)")
      .eq("id", registrationId).single();
    if (!reg || reg.user_id !== userId) return json({ error: "registration_not_found" }, 404);
    if (reg.status !== "pending") return json({ error: "not_pending" }, 409);

    // Same lazy-expiry predicate as registrations-checkout's isLapsedPending: a
    // PayMongo hosted checkout session itself expires at 24 hours (see this
    // migration set's header,  20260809100200_expire_stale_registrations.sql),
    // so minting a BRAND-NEW session for a hold whose window has already lapsed
    // would hand the runner a working checkout page for an entry that is dead
    // in every other sense -- exactly the gap that let a stale session capture
    // money after the runner re-entered from the event page, landing on
    // confirm_payment_tx's 'conflict' path and a manual refund. Correctness
    // must not depend on the 15-minute sweep having already run.
    //
    // Also WRITE the expiry here (status='expired', expires_at=null), not just
    // refuse -- the same reasoning registrations-checkout's isLapsedPending
    // comment gives: leaving the row 'pending' after telling the runner their
    // hold lapsed means every other reader (admin roster, My Races, a second
    // tab) still sees a live 'pending' entry until the sweep or another lazy
    // check happens to touch it. There is no insert here for a lingering row
    // to collide with, so writing isn't required for correctness the way it is
    // in checkout -- it's done anyway so state doesn't visibly disagree with
    // what this response just told the caller.
    const isLapsedPending = reg.status === "pending" && !!reg.expires_at && Date.parse(reg.expires_at) <= Date.now();
    if (isLapsedPending) {
      await db.from("registrations").update({ status: "expired", expires_at: null }).eq("id", reg.id);
      return json({ error: "hold_expired" }, 409);
    }

    // The event can be cancelled AFTER a runner registered, while their pending
    // registration and its PayMongo session are still live. Without this, a
    // bookmarked /pay/<rid> charges a card for a race that no longer exists.
    // The page-level guard is a UX nicety; this is the boundary.
    const { data: event } = await db.from("events").select("status").eq("id", reg.event_id).single();
    if (!event) return json({ error: "registration_not_found" }, 404);
    // Pass null for registrationClosesAt: this registration already exists in `pending`
    // state, created before the deadline. The deadline check exists to stop NEW
    // registrations from being created after the cutoff; it deliberately does not block
    // completing payment on a slot the runner already holds. Whether a grace period should
    // instead cut off payment for stale pending registrations is an open product question,
    // not one this fix decides — passing null here just preserves the pre-existing
    // behaviour (only cancelled/closed/completed events block payment).
    if (isRegistrationClosed(event.status, null)) return json({ error: "registration_closed" }, 409);

    const { data: payment } = await db.from("payments").select("provider").eq("registration_id", reg.id).single();
    const { data: category } = await db.from("categories").select("label,base_price").eq("id", reg.category_id).single();

    // Itemize the hosted checkout the same way registrations-checkout does: entry fee + grouped add-ons.
    const entry = category?.base_price ?? reg.total_amount;
    const addonTotal = reg.total_amount - entry;
    const lineItems = [{ name: category?.label ?? "Race registration", amount: entry }];
    if (addonTotal > 0) lineItems.push({ name: "Add-ons", amount: addonTotal });

    // Pass-on mode: the runner covers Race Pace's commission and the processing
    // cost, so the organizer receives the full sticker price.
    //
    // The surcharge is computed HERE — at the moment the method is known and the
    // scoped session is recreated — because PayMongo's cut depends on the method.
    // A ₱2,000 entry costs ₱30 on GCash and ₱85 on a card; one blended number
    // would over-collect on one and lose money on the other.
    const org = (reg.organizations as unknown as
      (FeeTerms & { fee_mode: string }) | null) ?? null;
    let chargeAmount = reg.total_amount;

    if (org?.fee_mode === "pass_on") {
      const { data: rateRows } = await db.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: pmMethod, p_scope: "local",
        p_at: new Date().toISOString(),
      });
      const rate = (rateRows as ProcessorRate[] | null)?.[0] ?? null;
      if (!rate) {
        // Pass-on mode CANNOT proceed without a rate: there is no honest amount
        // to charge. Absorb mode would be unaffected, which is why this refuses
        // here rather than globally.
        console.error(`[payment-session] no processor rate for method=${pmMethod} — pass-on org ${reg.event_id}`);
        return json({ error: "rate_card_missing" }, 503);
      }
      const platformFee = computeFee(reg.total_amount, org);
      const b = passOnBreakdown(reg.total_amount, platformFee, rate);
      chargeAmount = b.total;
      // Zero lines are skipped, same as the add-ons line above: a ₱0.00 item on
      // the hosted page is noise at best, and PayMongo has no reason to accept
      // one. Skipping only zeros keeps the lines summing to chargeAmount, which
      // is what PayMongo actually charges.
      if (b.platformFee > 0) lineItems.push({ name: "Race Pace service fee", amount: b.platformFee });
      if (b.processorFee > 0) lineItems.push({ name: "Payment processing", amount: b.processorFee });
    }

    // Prefill PayMongo's customer info with the runner's name + email (phone left to PayMongo).
    const { data: profile } = await db.from("profiles").select("full_name,bib_name").eq("id", userId).maybeSingle();
    const billing = { name: ((profile?.full_name ?? profile?.bib_name ?? "") as string).trim() || undefined, email: userRes.user.email || undefined };

    // Refund uses the same rails that took the payment; recreate on the payment's own provider.
    const provider = getPaymentProviderByName(payment?.provider ?? "paymongo");
    const checkout = await provider.createCheckout({
      registrationId: reg.id, amount: chargeAmount, description: category?.label ?? "Race registration",
      returnUrl, methods: [pmMethod], lineItems, billing,
    });
    // Point provider_ref/checkout_url at the new session — payment-verify + refunds resolve from here.
    //
    // `amount` moves with them. It was set to the BASE total when the row was
    // created (registrations-checkout), and in pass-on mode that is no longer
    // what the runner is charged. Leaving it stale would record a ₱2,000 sale
    // against a ₱2,091.38 charge, and confirm.ts pays the organizer out of this
    // column — so a stale value here is not bookkeeping, it is the organizer
    // being paid the wrong amount with nothing to flag it. In absorb mode this
    // rewrites the same number it already held.
    await db.from("payments").update({
      provider_ref: checkout.providerRef, checkout_url: checkout.checkoutUrl,
      amount: chargeAmount,
    }).eq("registration_id", reg.id);

    return json({ checkout_url: checkout.checkoutUrl });
  } catch (e) {
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
