import { serviceClient } from "../_shared/supabase.ts";
import { getPaymentProviderByName } from "../_shared/payments.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { isRegistrationClosed } from "../_shared/eventStatus.ts";

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
    const { data: reg } = await db.from("registrations").select("id,user_id,status,total_amount,category_id,event_id").eq("id", registrationId).single();
    if (!reg || reg.user_id !== userId) return json({ error: "registration_not_found" }, 404);
    if (reg.status !== "pending") return json({ error: "not_pending" }, 409);

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

    // Prefill PayMongo's customer info with the runner's name + email (phone left to PayMongo).
    const { data: profile } = await db.from("profiles").select("full_name,bib_name").eq("id", userId).maybeSingle();
    const billing = { name: ((profile?.full_name ?? profile?.bib_name ?? "") as string).trim() || undefined, email: userRes.user.email || undefined };

    // Refund uses the same rails that took the payment; recreate on the payment's own provider.
    const provider = getPaymentProviderByName(payment?.provider ?? "paymongo");
    const checkout = await provider.createCheckout({
      registrationId: reg.id, amount: reg.total_amount, description: category?.label ?? "Race registration",
      returnUrl, methods: [pmMethod], lineItems, billing,
    });
    // Point provider_ref/checkout_url at the new session — payment-verify + refunds resolve from here.
    await db.from("payments").update({
      provider_ref: checkout.providerRef, checkout_url: checkout.checkoutUrl,
    }).eq("registration_id", reg.id);

    return json({ checkout_url: checkout.checkoutUrl });
  } catch (e) {
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
