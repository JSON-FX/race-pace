import { serviceClient } from "../_shared/supabase.ts";
import { getPaymentProvider } from "../_shared/payments.ts";
import { customDataSchema, formFieldSchema, isProfileKey, registrationInputSchema } from "../_shared/validation.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const raw = await req.json();
    // The app passes its deep-link so PayMongo's hosted checkout can redirect back.
    const returnUrl = typeof raw?.return_url === "string" && raw.return_url ? raw.return_url : "racepace://pay-callback";
    const parsed = registrationInputSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
    const input = parsed.data;
    if (!input.waiver_accepted) return json({ error: "waiver_required" }, 400);

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    const { data: category } = await db.from("categories").select("*").eq("id", input.category_id).single();
    if (!category || category.event_id !== input.event_id) return json({ error: "category_not_found" }, 404);
    if (category.slots_taken >= category.slots_total) return json({ error: "sold_out" }, 409);

    const { data: fieldRows } = await db.from("form_fields").select("*").eq("event_id", input.event_id).eq("is_active", true);
    // Model B: profile-key fields (bib_name, date_of_birth, gender, shirt_size, blood_type,
    // emergency_contact) are prefilled from the runner's profile and validated client-side
    // against canonical shared lists + passport rules — NOT the org's per-event `options`
    // enum. Only event (non-profile) fields are validated here, matching the client's
    // `eventQuestions` in app/register/[categoryId].tsx. The raw input.custom_data (incl.
    // passport values) is still stored whole below — the snapshot must persist intact.
    const fields = (fieldRows ?? [])
      .filter((f) => !isProfileKey(f.key))
      .map((f) => formFieldSchema.parse({
        key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined,
      }));
    const cd = customDataSchema(fields).safeParse(input.custom_data);
    if (!cd.success) return json({ error: "invalid_custom_data", details: cd.error.flatten() }, 400);

    // Model B: profile-key fields aren't enum-validated above, but a REQUIRED one must still be
    // present + non-empty — a presence check (NOT the org enum, so canonical values pass). The
    // client enforces this too; this guards direct/replayed API calls (e.g. race-day blood_type).
    const cdObj = (input.custom_data ?? {}) as Record<string, unknown>;
    const missingRequired = (fieldRows ?? [])
      .filter((f) => isProfileKey(f.key) && f.required)
      .map((f) => f.key)
      .filter((k) => { const v = cdObj[k]; return v === undefined || v === null || (typeof v === "string" && v.trim() === ""); });
    if (missingRequired.length) return json({ error: "invalid_custom_data", details: { missing_required: missingRequired } }, 400);

    const addonIds = input.addon_ids.length ? input.addon_ids : ["00000000-0000-0000-0000-000000000000"];
    const { data: addons } = await db.from("addons").select("*").in("id", addonIds);
    const addonTotal = (addons ?? []).reduce((s, a) => s + a.price, 0);
    const total = category.base_price + addonTotal;

    const { data: reg, error: regErr } = await db.from("registrations").upsert({
      org_id: category.org_id, event_id: input.event_id, category_id: input.category_id,
      user_id: userId, status: "pending", total_amount: total,
      custom_data: input.custom_data, waiver_accepted_at: new Date().toISOString(),
      idempotency_key: input.idempotency_key,
    }, { onConflict: "user_id,idempotency_key" }).select().single();
    if (regErr || !reg) return json({ error: "registration_failed", details: regErr?.message }, 500);

    if ((addons ?? []).length) {
      await db.from("registration_addons").upsert(
        (addons ?? []).map((a) => ({ registration_id: reg.id, addon_id: a.id, price: a.price })),
      );
    }

    const provider = getPaymentProvider();
    await db.from("payments").upsert(
      { org_id: category.org_id, registration_id: reg.id, amount: total, status: "pending", provider: provider.name },
      { onConflict: "registration_id" },
    );

    const checkout = await provider.createCheckout({
      registrationId: reg.id, amount: total, description: category.label, returnUrl,
    });
    await db.from("payments").update({
      provider_ref: checkout.providerRef,
      checkout_url: checkout.checkoutUrl,
    }).eq("registration_id", reg.id);

    return json({ registration_id: reg.id, checkout_url: checkout.checkoutUrl });
  } catch (e) {
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
