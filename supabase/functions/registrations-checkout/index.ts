import { serviceClient } from "../_shared/supabase.ts";
import { getPaymentProvider } from "../_shared/payments.ts";
import { customDataSchema, formFieldSchema, isProfileKey, registrationInputSchema, passportSchema } from "../_shared/validation.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import { isRegistrationClosed } from "../_shared/eventStatus.ts";
import { computeFee, type FeeTerms } from "../_shared/fee.ts";
import { isDefinitiveCheckoutRejection, PayMongoCheckoutError } from "../_shared/paymongo.ts";

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
    let registrationReturnUrl: URL;
    try {
      registrationReturnUrl = new URL(returnUrl);
    } catch {
      return json({ error: "invalid_return_url" }, 400);
    }
    // Logged because this value is computed on the device by Linking.createURL() from the
    // Metro dev-server host — a stale host here sends the post-payment redirect to an
    // unreachable IP, and it is otherwise never persisted anywhere.
    console.log(`[checkout] return_url=${returnUrl}${raw?.return_url ? "" : " (DEFAULTED — app sent none)"}`);
    const parsed = registrationInputSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_input", details: parsed.error.flatten() }, 400);
    const input = parsed.data;
    // Group rows use this internal namespace. A replay through legacy upsert
    // must never revive an expired group line or create its own provider charge.
    if (input.idempotency_key.startsWith("group:")) return json({ error: "group_checkout_not_available" }, 409);
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
    //
    // The org's is_active rides along for the same reason. RLS removes a
    // suspended org's events from the storefront, but this function holds the
    // service role and RLS does not apply to it — so a direct call with an
    // event id already in hand would still sell a slot for an organization the
    // platform has switched off.
    const { data: event } = await db
      .from("events")
      .select("status, waiver_version_id, registration_closes_at, organizations(is_active,fee_mode,commission_type,commission_rate,commission_flat_cents)")
      .eq("id", category.event_id)
      .single();
    if (!event) return json({ error: "category_not_found" }, 404);
    if (!["open", "almost_full"].includes(event.status) || isRegistrationClosed(event.status, event.registration_closes_at)) {
      return json({ error: "registration_closed" }, 409);
    }
    // Older open events can still lack an organizer waiver. Never sell another
    // slot for them, even when the request also omits a version (null === null).
    if (!event.waiver_version_id) return json({ error: "event_waiver_unavailable" }, 409);
    if ((event.waiver_version_id ?? null) !== (input.waiver_version_id ?? null)) {
      return json({ error: "waiver_version_changed" }, 409);
    }
    const org = event.organizations as unknown as (FeeTerms & { is_active: boolean; fee_mode: "absorb" | "pass_on" }) | null;
    if (!org?.is_active) return json({ error: "org_suspended" }, 409);

    if (category.slots_taken >= category.slots_total) return json({ error: "sold_out" }, 409);

    // Read the authenticated runner's saved identity. Client custom_data cannot
    // make an incomplete Passport complete or substitute another participant.
    const { data: passport, error: passportError } = await db.from("runner_passports")
      .select("id,claimed_user_id,first_name,last_name,team_name,date_of_birth,gender,contact_number,emergency_contact_name,emergency_contact_number,emergency_contact_relationship,shirt_size,blood_type,participant_email,shipping_barangay_code,shipping_zip_code,shipping_address_line")
      .eq(input.participant_passport_id ? "id" : "claimed_user_id", input.participant_passport_id ?? userId).maybeSingle();
    if (passportError) return json({ error: "passport_unavailable" }, 503);
    if (!passport) return json({ error: "participant_not_accessible" }, 403);
    const assisted = passport.claimed_user_id !== userId;
    if (assisted) {
      const { data: manager } = await db.from("passport_managers").select("passport_id").eq("passport_id", passport.id).eq("user_id", userId).maybeSingle();
      if (passport.claimed_user_id || !manager) return json({ error: "participant_not_accessible" }, 403);
      if (!userRes.user.email_confirmed_at) return json({ error: "booking_email_unverified" }, 403);
      if (!event.waiver_version_id || input.waiver_acceptance_method !== "participant_on_helper_device") return json({ error: "participant_acceptance_required" }, 422);
    }

    if (input.event_reservation_id) {
      const { data: held } = await db.from("event_reservations")
        .select("id,event_id,org_id,user_id,status,registration_deadline_at")
        .eq("id", input.event_reservation_id).maybeSingle();
      if (!held || held.event_id !== input.event_id || held.org_id !== category.org_id ||
          held.user_id !== userId || held.status !== "paid" ||
          Date.parse(held.registration_deadline_at) <= Date.now()) {
        return json({ error: "invalid_event_reservation" }, 409);
      }
      const { data: places, error: placesError } = await db.from("event_reservation_places")
        .select("participant_passport_id,status").eq("reservation_id", held.id);
      if (placesError) return json({ error: "reservation_unavailable" }, 503);
      if (places?.length
        ? !places.some((place) => place.participant_passport_id === passport.id && place.status === "held")
        : assisted) {
        return json({ error: "invalid_event_reservation" }, 409);
      }
    }

    // One live entry per event. The partial unique index
    // registrations_one_live_per_event is the real enforcement -- this read
    // races by nature (two concurrent calls both see zero rows) and the 23505
    // handler below is what actually holds the line. This exists so the common
    // case returns something the client can act on: the existing entry and its
    // checkout URL, so a runner who wandered off mid-payment lands back on the
    // pay screen instead of a dead end.
    const liveEntryQuery = () =>
      db
        .from("registrations")
        .select("id,user_id,booked_by_user_id,status,expires_at,payments(provider,checkout_url)")
        .eq("event_id", input.event_id)
        .eq("participant_passport_id", passport.id)
        .in("status", ["pending", "paid"])
        .maybeSingle();

    // `expires_at <= now()` is the lazy backstop: a pending row past its hold
    // window is already gone as far as the runner is concerned, whether or not
    // the 15-minute sweep has run yet. Correctness must not depend on cron --
    // which means this check has to WRITE, not just ignore. A row that is
    // merely skipped here is still 'pending' in the database, the unique
    // index still sees it, and the insert below would collide with it -- at
    // which point the 23505 handler would find that same stale row and
    // wrongly report already_registered. Expiring it for real removes the
    // collision instead of relocating it.
    const isLapsedPending = (row: { status: string; expires_at: string | null; payments: unknown }) => {
      const payment = Array.isArray(row.payments) ? row.payments[0] : row.payments;
      // A PayMongo reservation stays live until its provider session is closed.
      // The worker handles an unbound or uncertain session too.
      return row.status === "pending" && !!row.expires_at && Date.parse(row.expires_at) <= Date.now() &&
        (payment as { provider?: string } | null)?.provider !== "paymongo";
    };

    const expireLapsedRow = (id: string) =>
      db.from("registrations").update({ status: "expired", expires_at: null }).eq("id", id);

    const alreadyRegisteredResponse = (row: { id: string; user_id: string | null; booked_by_user_id: string | null; status: string; expires_at: string | null; payments: unknown }) => {
      if (row.user_id !== userId && row.booked_by_user_id !== userId) return json({ error: "participant_already_registered" }, 409);
      const pay = Array.isArray(row.payments) ? row.payments[0] : row.payments;
      if (row.status === "pending" && row.expires_at && Date.parse(row.expires_at) <= Date.now() &&
          (pay as { provider?: string } | null)?.provider === "paymongo") {
        return json({ error: "checkout_expiring", registration_id: row.id }, 409);
      }
      return json(
        {
          error: "already_registered",
          registration_id: row.id,
          status: row.status,
          checkout_url: (pay as { checkout_url: string | null } | null)?.checkout_url ?? null,
        },
        409,
      );
    };

    const { data: existing, error: existingErr } = await liveEntryQuery();
    if (existingErr) return json({ error: "registration_failed", details: existingErr.message }, 500);

    if (existing && !isLapsedPending(existing)) return alreadyRegisteredResponse(existing);

    const identity = passportSchema(new Date().toISOString().slice(0, 10)).safeParse(passport);
    if (!identity.success) return json({ error: "passport_incomplete", details: {
      invalid_fields: [...new Set(identity.error.issues.map((issue) => String(issue.path[0] ?? "passport")))],
    } }, 422);
    input.custom_data = {
      ...input.custom_data,
      first_name: identity.data.first_name, last_name: identity.data.last_name,
      full_name: `${identity.data.first_name} ${identity.data.last_name}`,
      team_name: identity.data.team_name ?? null,
      date_of_birth: identity.data.date_of_birth, gender: identity.data.gender,
      contact_number: identity.data.contact_number,
      emergency_contact_name: identity.data.emergency_contact_name,
      emergency_contact_number: identity.data.emergency_contact_number,
      emergency_contact_relationship: identity.data.emergency_contact_relationship,
      emergency_contact: `${identity.data.emergency_contact_name} — ${identity.data.emergency_contact_number}`,
    };

    if (existing) {
      if (isLapsedPending(existing)) {
        await expireLapsedRow(existing.id);
      } else {
        return alreadyRegisteredResponse(existing);
      }
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
      .filter((f) => isProfileKey(f.key) && f.required && f.key !== "bib_name")
      .map((f) => f.key)
      .filter((k) => { const v = cdObj[k]; return v === undefined || v === null || (typeof v === "string" && v.trim() === ""); });
    if (missingRequired.length) return json({ error: "invalid_custom_data", details: { missing_required: missingRequired } }, 400);

    const addonIds = input.addon_ids.length ? input.addon_ids : ["00000000-0000-0000-0000-000000000000"];
    const { data: addons } = await db.from("addons").select("*").in("id", addonIds);
    const addonTotal = (addons ?? []).reduce((s, a) => s + a.price, 0);
    const total = category.base_price + addonTotal;

    const insertRegistration = () =>
      db.from("registrations").insert({
        org_id: category.org_id, event_id: input.event_id, category_id: input.category_id,
        user_id: passport.claimed_user_id, booked_by_user_id: userId, participant_passport_id: passport.id,
        waiver_acceptance_method: assisted ? "participant_on_helper_device" : "signed_in_self", status: "pending", total_amount: total,
        waiver_version_id: input.waiver_version_id ?? null,
        custom_data: input.custom_data, waiver_accepted_at: new Date().toISOString(),
        idempotency_key: input.idempotency_key,
        event_reservation_id: input.event_reservation_id ?? null,
      }).select().single();

    const idempotentEntryQuery = () =>
      db.from("registrations")
        .select("id,user_id,booked_by_user_id,status,expires_at,payments(provider,checkout_url)")
        .eq("booked_by_user_id", userId)
        .eq("participant_passport_id", passport.id)
        .eq("idempotency_key", input.idempotency_key)
        .maybeSingle();

    const isLiveGateViolation = (err: { code?: string; message?: string | null } | null) =>
      err?.code === "23505" && (err.message ?? "").includes("registrations_one_live_per_event");

    let { data: reg, error: regErr } = await insertRegistration();

    if (regErr?.message?.includes("category_capacity_exhausted")) return json({ error: "sold_out" }, 409);
    if (regErr?.message?.includes("event_capacity_exhausted")) return json({ error: "sold_out" }, 409);
    if (regErr?.message?.includes("invalid_event_reservation")) return json({ error: "invalid_event_reservation" }, 409);
    if (regErr?.message?.includes("waiver_version_changed")) return json({ error: "waiver_version_changed" }, 409);

    if ((regErr || !reg) && regErr?.code === "23505" && !isLiveGateViolation(regErr)) {
      // Idempotency prevents a replay from creating a second registration. It
      // must also prevent a released attempt from being revived: the old
      // upsert overwrote an expired registration back to pending while its
      // payment correctly remained failed, stranding the runner on /pay.
      const { data: replay, error: replayErr } = await idempotentEntryQuery();
      if (replayErr) return json({ error: "registration_failed", details: replayErr.message }, 500);
      if (replay?.status === "pending" || replay?.status === "paid") {
        return alreadyRegisteredResponse(replay);
      }
      if (replay) return json({ error: "idempotency_conflict" }, 409);
    }

    if ((regErr || !reg) && isLiveGateViolation(regErr)) {
      // 23505 on registrations_one_live_per_event: a concurrent checkout won
      // the race between the pre-check above and this insert. Same outcome as
      // the pre-check, just discovered a moment later -- including the same
      // lazy-expiry duty: if the row that beat us is itself a lapsed pending
      // hold, expiring-and-ignoring it here would leave the caller wrongly
      // told already_registered against a dead row. Expire it for real and
      // retry the insert exactly once (bounded -- this must never loop).
      const { data: winner, error: winnerErr } = await liveEntryQuery();
      if (winnerErr) return json({ error: "registration_failed", details: winnerErr.message }, 500);

      if (winner && isLapsedPending(winner)) {
        await expireLapsedRow(winner.id);
        const retry = await insertRegistration();
        if (retry.error?.message?.includes("category_capacity_exhausted")) return json({ error: "sold_out" }, 409);
        if (retry.error?.message?.includes("event_capacity_exhausted")) return json({ error: "sold_out" }, 409);
        if (!retry.error && retry.data) {
          reg = retry.data;
          regErr = null;
        } else if (isLiveGateViolation(retry.error)) {
          // Someone else won in the time it took to expire and retry --
          // report that genuine winner rather than retrying again.
          const { data: winner2, error: winner2Err } = await liveEntryQuery();
          if (winner2Err) return json({ error: "registration_failed", details: winner2Err.message }, 500);
          if (winner2) return alreadyRegisteredResponse(winner2);
          return json({ error: "registration_failed", details: retry.error?.message }, 500);
        } else {
          return json({ error: "registration_failed", details: retry.error?.message }, 500);
        }
      } else if (winner) {
        return alreadyRegisteredResponse(winner);
      } else {
        // Constraint fired but no live row matches now -- surface the
        // original error rather than manufacturing a response with no id.
        return json({ error: "registration_failed", details: regErr?.message }, 500);
      }
    }
    if (regErr || !reg) return json({ error: "registration_failed", details: regErr?.message }, 500);

    if ((addons ?? []).length) {
      await db.from("registration_addons").upsert(
        (addons ?? []).map((a) => ({ registration_id: reg.id, addon_id: a.id, price: a.price })),
      );
    }

    const provider = getPaymentProvider();
    // PayMongo v2 adds its own method-specific fee after the runner selects a
    // method. This is the pre-processing subtotal, never an app-estimated fee.
    const providerManagedFee = provider.name === "paymongo" && org.fee_mode === "pass_on";
    const frozenPlatformFee = computeFee(total, org);
    const checkoutSubtotal = total + (providerManagedFee ? frozenPlatformFee : 0);
    // Build and freeze the provider request before the external POST for audit.
    // A sandbox probe on 2026-09-18 found that repeating checkout creation with
    // the same PayMongo idempotency key minted a different session. An uncertain
    // create must remain pending for provider reconciliation, not auto-retry.
    const lineItems = [{ name: category.label, amount: category.base_price }];
    if (addonTotal > 0) lineItems.push({ name: "Add-ons", amount: addonTotal });
    if (providerManagedFee && frozenPlatformFee > 0) lineItems.push({ name: "Taxes and fees", amount: frozenPlatformFee });
    const { data: profile } = await db.from("profiles").select("full_name,bib_name").eq("id", userId).maybeSingle();
    const billing = { name: ((profile?.full_name ?? profile?.bib_name ?? "") as string).trim() || undefined, email: userRes.user.email || undefined };
    registrationReturnUrl.searchParams.set("rid", reg.id);
    const checkoutInput = {
      registrationId: reg.id, amount: checkoutSubtotal, description: category.label,
      returnUrl: registrationReturnUrl.toString(), lineItems, billing,
      passOnFees: providerManagedFee,
      metadata: providerManagedFee ? { fee_mode: "pass_on", platform_fee_cents: String(frozenPlatformFee) } : undefined,
    };
    // One inserted payment row owns external checkout creation. A concurrent
    // replay must not create a second chargeable PayMongo session for this slot.
    // It also must not upsert a captured row back to pending.
    const { error: paymentInsertError } = await db.from("payments").insert({
      org_id: category.org_id, registration_id: reg.id,
      amount: checkoutSubtotal, status: "pending", provider: provider.name,
      checkout_fee_mode: org.fee_mode,
      checkout_platform_fee: frozenPlatformFee,
      checkout_provider_managed_fee: providerManagedFee,
      checkout_request: checkoutInput,
    });
    if (paymentInsertError?.code === "23505") {
      // The pay page can reuse a bound checkout, or report that an uncertain
      // create needs reconciliation. It must not mint another PayMongo session.
      return json({ error: "already_registered", registration_id: reg.id, status: "pending", checkout_url: null }, 409);
    }
    if (paymentInsertError) return json({ error: "payment_setup_failed" }, 500);

    let checkout;
    try {
      checkout = await provider.createCheckout(checkoutInput);
    } catch (error) {
      const providerError = error instanceof PayMongoCheckoutError ? error : null;
      console.error("[checkout] provider creation failed", {
        registrationId: reg.id,
        code: providerError?.code ?? "unknown_provider_error",
        outcome: providerError?.outcome ?? "uncertain",
        providerStatus: providerError?.providerStatus ?? null,
      });
      if (!isDefinitiveCheckoutRejection(error)) throw error;
      const release = await db.rpc("release_rejected_paymongo_checkout", {
        p_registration_id: reg.id,
        p_reason: `${providerError?.code ?? "provider_rejected"}:${providerError?.providerStatus ?? "none"}`,
      });
      if (release.error || release.data !== "released") {
        console.error("[checkout] rejected provider attempt could not be released", {
          registrationId: reg.id,
          result: release.data ?? null,
          error: release.error?.message ?? null,
        });
        return json({ error: "checkout_reconciliation_required", registration_id: reg.id }, 503);
      }
      return json({ error: "payment_method_unavailable" }, 503);
    }
    const { error: paymentUpdateError } = await db.from("payments").update({
      provider_ref: checkout.providerRef,
      checkout_url: checkout.checkoutUrl,
      checkout_fee_mode: org.fee_mode,
      checkout_platform_fee: frozenPlatformFee,
      checkout_provider_managed_fee: providerManagedFee,
    }).eq("registration_id", reg.id);
    if (paymentUpdateError) return json({ error: "payment_setup_failed" }, 500);

    return json({ registration_id: reg.id, checkout_url: checkout.checkoutUrl });
  } catch (e) {
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
