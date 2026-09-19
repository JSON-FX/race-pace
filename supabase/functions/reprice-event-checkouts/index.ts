import { confirmPayment } from "../_shared/confirm.ts";
import { computeFee, type FeeTerms } from "../_shared/fee.ts";
import { pmExpireCheckoutSession, pmGetCheckoutSession, pmMethodFromSession } from "../_shared/paymongo.ts";
import { getPaymentProviderByName } from "../_shared/payments.ts";
import { serviceClient } from "../_shared/supabase.ts";

type Payment = {
  provider: string; provider_ref: string | null; amount: number;
  checkout_fee_mode: string | null; checkout_provider_managed_fee: boolean;
  checkout_request: Record<string, unknown> | null;
};

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return json({ error: "unauthorized" }, 401);
  const db = serviceClient();
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) return json({ error: "unauthorized" }, 401);
  const raw = await req.json().catch(() => null);
  const eventId = typeof raw?.event_id === "string" ? raw.event_id : "";
  if (!eventId) return json({ error: "invalid_input" }, 400);

  const { data: event } = await db.from("events").select("id,org_id").eq("id", eventId).maybeSingle();
  if (!event) return json({ error: "event_not_found" }, 404);
  const { data: roles } = await db.from("user_roles").select("role,org_id").eq("user_id", auth.data.user.id);
  const allowed = (roles ?? []).some((role) => role.role === "super_admin" ||
    (role.org_id === event.org_id && (role.role === "admin" || role.role === "editor")));
  if (!allowed) return json({ error: "forbidden" }, 403);

  const { data: registrations, error } = await db.from("registrations")
    .select("id,total_amount,category_id,categories(label,base_price),organizations(fee_mode,commission_type,commission_rate,commission_flat_cents),registration_addons(addon_id,price,addons(price)),payments(provider,provider_ref,amount,checkout_fee_mode,checkout_provider_managed_fee,checkout_request)")
    .eq("event_id", eventId).eq("status", "pending").is("booking_order_id", null);
  if (error) return json({ error: "checkout_read_failed" }, 503);

  const outcomes: Record<string, number> = {};
  const count = (key: string) => { outcomes[key] = (outcomes[key] ?? 0) + 1; };
  for (const reg of registrations ?? []) {
    const payment = (Array.isArray(reg.payments) ? reg.payments[0] : reg.payments) as Payment | null;
    const category = Array.isArray(reg.categories) ? reg.categories[0] : reg.categories;
    const org = (Array.isArray(reg.organizations) ? reg.organizations[0] : reg.organizations) as FeeTerms & { fee_mode?: string };
    const addonRows = Array.isArray(reg.registration_addons) ? reg.registration_addons : [];
    const addonTotal = addonRows.reduce((sum, row) => {
      const addon = Array.isArray(row.addons) ? row.addons[0] : row.addons;
      return sum + (addon?.price ?? 0);
    }, 0);
    const addonPricesChanged = addonRows.some((row) => {
      const addon = Array.isArray(row.addons) ? row.addons[0] : row.addons;
      return row.price !== (addon?.price ?? 0);
    });
    const previousAddonTotal = addonRows.reduce((sum, row) => sum + row.price, 0);
    const categoryPriceChanged = reg.total_amount - previousAddonTotal !== (category?.base_price ?? 0);
    const total = (category?.base_price ?? 0) + addonTotal;
    const platformFee = computeFee(total, org);
    const providerManaged = payment?.checkout_provider_managed_fee === true;
    const paymentAmount = total + (providerManaged ? platformFee : 0);
    if (!payment || payment.provider !== "paymongo" ||
      (!addonPricesChanged && !categoryPriceChanged && payment.amount === paymentAmount && reg.total_amount === total)) {
      count("unchanged");
      continue;
    }
    const oldId = payment.provider_ref;
    if (!oldId?.startsWith("cs_") || !payment.checkout_request) {
      count("review_required");
      continue;
    }
    try {
      await pmExpireCheckoutSession(oldId);
      const oldSession = await pmGetCheckoutSession(oldId);
      if (oldSession.paid) {
        const confirmed = await confirmPayment(reg.id, pmMethodFromSession(oldSession), {
          source: "price-refresh", session_id: oldId, session: oldSession.raw,
        });
        count(confirmed.ok ? "captured" : "review_required");
        continue;
      }
      if (oldSession.status !== "expired") {
        count("payment_ongoing");
        continue;
      }
      const claim = await db.rpc("begin_pending_checkout_reprice", {
        p_registration_id: reg.id, p_old_session_id: oldId, p_target_total: total,
      });
      if (claim.error || claim.data !== "claimed") {
        count(String(claim.data ?? "claim_failed"));
        continue;
      }
      const previous = payment.checkout_request;
      const returnUrl = typeof previous.returnUrl === "string" ? previous.returnUrl : "racepace://pay-callback";
      const billing = typeof previous.billing === "object" ? previous.billing as Record<string, string> : undefined;
      const lineItems = [{ name: category?.label ?? "Race registration", amount: category?.base_price ?? 0 }];
      if (addonTotal > 0) lineItems.push({ name: "Add-ons", amount: addonTotal });
      if (providerManaged && platformFee > 0) lineItems.push({ name: "Taxes and fees", amount: platformFee });
      const checkoutInput = {
        registrationId: reg.id, amount: paymentAmount,
        description: category?.label ?? "Race registration", returnUrl, lineItems, billing,
        passOnFees: providerManaged,
        metadata: providerManaged ? { fee_mode: "pass_on", platform_fee_cents: String(platformFee) } : undefined,
      };
      let checkout;
      try {
        checkout = await getPaymentProviderByName("paymongo").createCheckout(checkoutInput);
      } catch (createError) {
        await db.rpc("record_pending_checkout_reprice", {
          p_registration_id: reg.id, p_old_session_id: oldId,
          // A failed checkout POST can have reached PayMongo even when its
          // response did not reach us. Keep this attempt blocked for review;
          // retrying it could create a second chargeable replacement.
          p_outcome: "unknown",
          p_new_session_id: null, p_detail: { error: String(createError).slice(0, 200) },
        });
        throw createError;
      }
      const bound = await db.rpc("replace_pending_checkout_pricing", {
        p_registration_id: reg.id, p_old_session_id: oldId,
        p_new_session_id: checkout.providerRef, p_checkout_url: checkout.checkoutUrl,
        p_total: total, p_payment_amount: paymentAmount, p_platform_fee: platformFee,
        p_checkout_request: checkoutInput,
      });
      if (bound.error || bound.data !== "replaced") {
        let replacementClosed = false;
        try {
          await pmExpireCheckoutSession(checkout.providerRef);
          replacementClosed = (await pmGetCheckoutSession(checkout.providerRef)).status === "expired";
        } catch { /* an uncertain replacement stays blocked for review */ }
        await db.rpc("record_pending_checkout_reprice", {
          p_registration_id: reg.id, p_old_session_id: oldId,
          p_outcome: replacementClosed ? "replacement_expired" : "unknown",
          p_new_session_id: checkout.providerRef,
          p_detail: { bind_result: bound.data ?? null, bind_error: bound.error?.message ?? null },
        });
        count(String(bound.data ?? "bind_failed"));
        continue;
      }
      await db.rpc("record_pending_checkout_reprice", {
        p_registration_id: reg.id, p_old_session_id: oldId,
        p_outcome: "replaced", p_new_session_id: checkout.providerRef, p_detail: {},
      });
      count("repriced");
    } catch (cause) {
      console.error("[reprice] checkout refresh failed", { registrationId: reg.id, error: String(cause) });
      count("retry_required");
    }
  }
  const failed = Object.entries(outcomes).some(([key, value]) => value > 0 && !["unchanged", "repriced", "captured"].includes(key));
  return json({ processed: registrations?.length ?? 0, outcomes }, failed ? 503 : 200);
});
