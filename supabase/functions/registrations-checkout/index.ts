import { serviceClient } from "../_shared/supabase.ts";
import { getPaymentProvider } from "../_shared/payments.ts";
import { customDataSchema, formFieldSchema, isProfileKey, registrationInputSchema } from "../_shared/validation.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { isRegistrationClosed } from "../_shared/eventStatus.ts";

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
    // The app passes its deep-link so PayMongo's hosted checkout can redirect back.
    const returnUrl = typeof raw?.return_url === "string" && raw.return_url ? raw.return_url : "racepace://pay-callback";
    // Logged because this value is computed on the device by Linking.createURL() from the
    // Metro dev-server host — a stale host here sends the post-payment redirect to an
    // unreachable IP, and it is otherwise never persisted anywhere.
    console.log(`[checkout] return_url=${returnUrl}${raw?.return_url ? "" : " (DEFAULTED — app sent none)"}`);
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

    // Authoritative: the page-level `isRegistrationClosed` check is a UX
    // nicety only, not a boundary — a cancelled/closed/completed event must
    // never accept a new registration or checkout, even via a direct call
    // with a stale category id already in hand.
    const { data: event } = await db.from("events").select("status").eq("id", category.event_id).single();
    if (!event) return json({ error: "category_not_found" }, 404);
    if (isRegistrationClosed(event.status)) return json({ error: "registration_closed" }, 409);

    if (category.slots_taken >= category.slots_total) return json({ error: "sold_out" }, 409);

    // One live entry per event. The partial unique index
    // registrations_one_live_per_event is the real enforcement -- this read
    // races by nature (two concurrent calls both see zero rows) and the 23505
    // handler below is what actually holds the line. This exists so the common
    // case returns something the client can act on: the existing entry and its
    // checkout URL, so a runner who wandered off mid-payment lands back on the
    // pay screen instead of a dead end.
    //
    // `expires_at <= now()` is the lazy backstop: a pending row past its hold
    // window is already gone as far as the runner is concerned, whether or not
    // the 15-minute sweep has run yet. Correctness must not depend on cron.
    const { data: existing } = await db
      .from("registrations")
      .select("id,status,expires_at,payments(checkout_url)")
      .eq("event_id", input.event_id)
      .eq("user_id", userId)
      .in("status", ["pending", "paid"])
      .maybeSingle();

    const liveEntry =
      existing && !(existing.status === "pending" && existing.expires_at && Date.parse(existing.expires_at) <= Date.now())
        ? existing
        : null;

    if (liveEntry) {
      const pay = Array.isArray(liveEntry.payments) ? liveEntry.payments[0] : liveEntry.payments;
      return json(
        {
          error: "already_registered",
          registration_id: liveEntry.id,
          status: liveEntry.status,
          checkout_url: pay?.checkout_url ?? null,
        },
        409,
      );
    }

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
    if (regErr || !reg) {
      // 23505 on registrations_one_live_per_event: a concurrent checkout won
      // the race between the pre-check above and this insert. Same outcome as
      // the pre-check, just discovered a moment later.
      if (regErr?.code === "23505" && (regErr.message ?? "").includes("registrations_one_live_per_event")) {
        const { data: winner } = await db
          .from("registrations")
          .select("id,status,payments(checkout_url)")
          .eq("event_id", input.event_id)
          .eq("user_id", userId)
          .in("status", ["pending", "paid"])
          .maybeSingle();
        const pay = winner && (Array.isArray(winner.payments) ? winner.payments[0] : winner.payments);
        return json(
          {
            error: "already_registered",
            registration_id: winner?.id ?? null,
            status: winner?.status ?? "pending",
            checkout_url: pay?.checkout_url ?? null,
          },
          409,
        );
      }
      return json({ error: "registration_failed", details: regErr?.message }, 500);
    }

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

    // Itemize the hosted checkout: entry fee + a grouped add-ons line, so PayMongo's summary
    // shows why the total is what it is (mirrors the app's pay-screen breakdown).
    const lineItems = [{ name: category.label, amount: category.base_price }];
    if (addonTotal > 0) lineItems.push({ name: "Add-ons", amount: addonTotal });
    // Prefill PayMongo's "Customer Information" with the runner's name + email (phone left to PayMongo).
    const { data: profile } = await db.from("profiles").select("full_name,bib_name").eq("id", userId).maybeSingle();
    const billing = { name: ((profile?.full_name ?? profile?.bib_name ?? "") as string).trim() || undefined, email: userRes.user.email || undefined };
    const checkout = await provider.createCheckout({
      registrationId: reg.id, amount: total, description: category.label, returnUrl, lineItems, billing,
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
