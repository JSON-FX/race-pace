import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** admin_payment_aggregates and admin_registration_aggregates are `security
 *  invoker` over `security_invoker` views, and service_role has no SELECT on
 *  admin_registrations_v — so they must be driven by a real signed-in org admin,
 *  which is also the only caller the console ever has. */
async function signedInAs(email: string, password = "password123"): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

describe("commission + refund policy columns", () => {
  it("defaults NEW orgs to a flat fee and a flat-fee refund", async () => {
    const s = svc();
    const org = (await s.from("organizations")
      .insert({ name: "Defaults", slug: `defaults-${Date.now()}` })
      .select("id,commission_type,refund_policy,commission_flat_cents,refund_fee_cents")
      .single()).data!;
    try {
      expect(org.commission_type).toBe("fixed");
      expect(org.refund_policy).toBe("flat_fee");
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });

  it("no organization is left charging nothing", async () => {
    // The silent-zero this whole design guards against: commission_type defaults
    // to 'fixed' and commission_flat_cents to 0, so any org inserted without
    // explicit terms charges the platform's commission of ₱0. The seed hit
    // exactly this before it was made explicit.
    //
    // Scoped to the SEEDED orgs by slug, not to every row. Vitest runs test
    // files in parallel, so an invariant over all organizations intermittently
    // trips on another file's half-built fixture — a real failure of the test,
    // not of the code. Provisioning is covered separately by org-provision's own
    // validation.
    const s = svc();
    const rows = (await s.from("organizations")
      .select("name,commission_type,commission_rate,commission_flat_cents,refund_policy,refund_fee_cents")
      .in("slug", ["muspo", "runwithpoint"])).data ?? [];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      if (r.commission_type === "fixed") {
        expect(r.commission_flat_cents, `${r.name} is on a flat fee of ₱0`).toBeGreaterThan(0);
      } else {
        expect(Number(r.commission_rate), `${r.name} is on a 0% rate`).toBeGreaterThan(0);
      }
      // A flat_fee refund retaining ₱0 is indistinguishable from a full refund —
      // a policy that silently does nothing.
      if (r.refund_policy === "flat_fee") {
        expect(r.refund_fee_cents, `${r.name} retains ₱0 on a "flat fee" refund`).toBeGreaterThan(0);
      }
    }
  });

  it("seeds one org on each fee path so both are exercised in development", async () => {
    const s = svc();
    const rows = (await s.from("organizations")
      .select("name,commission_type,refund_policy").in("name", ["Muspo", "RunWithPoint"])).data ?? [];
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.commission_type))).toEqual(new Set(["percent", "fixed"]));
    expect(new Set(rows.map((r) => r.refund_policy))).toEqual(new Set(["full", "flat_fee"]));
  });

  it("rejects a negative flat fee", async () => {
    const s = svc();
    const r = await s.from("organizations")
      .insert({ name: "Bad", slug: `bad-${Date.now()}`, commission_flat_cents: -1 });
    expect(r.error).toBeTruthy();
  });

  it("rejects an unknown refund policy", async () => {
    const s = svc();
    const r = await s.from("organizations")
      .insert({ name: "Bad2", slug: `bad2-${Date.now()}`, refund_policy: "sometimes" });
    expect(r.error).toBeTruthy();
  });

  /**
   * One org + event + N paid ₱2,000 GCash entries under 2026-08-11 terms: the
   * runner pays ₱2,000, Race Pace earns 3% = ₱60, PayMongo takes ₱30, the
   * organizer is owed ₱1,910.
   *
   * The PAID row is seeded directly (the same shape payout-statements-v2.test.ts
   * uses); every REFUND below is driven through the real refund_registration_tx,
   * so nothing here can drift from what that function actually writes. Hand-built
   * refunded rows are exactly how this file previously came to assert a
   * `partially_refunded` shape the RPC had stopped producing.
   */
  async function fixture(tag: string, count: number) {
    const s = svc();
    const stamp = `${tag}-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Partial", slug: stamp, commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    const users: string[] = [];
    try {
      // Event status doesn't matter — these are service-role reads of the aggregates.
      const ev = (await s.from("events").insert({ org_id: org.id, name: "R", status: "draft" }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
        base_price: 200000, slots_total: 50, slots_taken: count,
      }).select().single()).data!;
      const adminEmail = `padm_${stamp}@test.dev`;
      const adminId = (await s.auth.admin.createUser({
        email: adminEmail, password: "password123", email_confirm: true,
      })).data.user!.id;
      users.push(adminId);
      const roleIns = await s.from("user_roles").insert({ user_id: adminId, role: "admin", org_id: org.id });
      if (roleIns.error) throw new Error(`grant admin: ${roleIns.error.message}`);

      const regIds: string[] = [];
      /** One more paid entry, with the money columns overridable so a test can pose
       *  a 'historical' or otherwise odd-shaped row. */
      async function addEntry(overrides: Record<string, unknown> = {}): Promise<string> {
        const i = regIds.length;
        const u = await s.auth.admin.createUser({
          email: `p${i}_${stamp}@test.dev`, password: "password123", email_confirm: true,
        });
        const uid = u.data.user!.id;
        users.push(uid);
        const reg = (await s.from("registrations").insert({
          org_id: org.id, event_id: ev.id, category_id: cat.id,
          user_id: uid, total_amount: 200000, status: "paid",
        }).select().single()).data!;
        regIds.push(reg.id);
        const pay = await s.from("payments").insert({
          org_id: org.id, registration_id: reg.id, provider: "fake", method: "gcash",
          status: "paid", amount: 200000, platform_fee: 6000,
          processor_fee_cents: 3000, processor_fee_source: "actual", net_to_org: 191000,
          ...overrides,
        });
        if (pay.error) throw new Error(`seed payment: ${pay.error.message}`);
        return reg.id;
      }
      for (let i = 0; i < count; i++) await addEntry();
      return {
        s, org, ev, regIds, adminEmail, addEntry,
        cleanup: async () => {
          // org delete cascades event/category/registration/payment; auth users are separate.
          await s.from("organizations").delete().eq("id", org.id);
          for (const uid of users) await s.auth.admin.deleteUser(uid);
        },
      };
    } catch (err) {
      await s.from("organizations").delete().eq("id", org.id);
      for (const uid of users) await s.auth.admin.deleteUser(uid);
      throw err;
    }
  }

  it("reports a partial refund at its retained value, not the original charge", async () => {
    const f = await fixture("partial", 1);
    try {
      // ₱1,910 was the organizer's; they keep ₱300 and ₱1,610 goes back to the runner.
      // The four-way split balances: 161000 + 30000 + 6000 + 3000 = 200000.
      const refund = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 161000, p_retained_net: 30000,
      });
      expect(refund.error).toBeNull();
      expect(refund.data).toBe("partially_refunded");

      const totals = await f.s.from("admin_org_totals_v")
        .select("gross_revenue,charged_gross,net_to_org,platform_fee,paid_count,pending_count")
        .eq("org_id", f.org.id).single();
      if (totals.error) throw new Error(`admin_org_totals_v: ${totals.error.message}`);
      const t = totals.data!;

      // gross_revenue is revenue we still HOLD. `amount` is no longer rewritten
      // down to the retention (20260811094000), so summing it would report ₱2,000
      // of retained revenue on a row where ₱1,610 went back out the door.
      expect(Number(t.gross_revenue)).toBe(39000);   // 200000 - 161000
      // What the runner was CHARGED is a different question, and still answerable.
      expect(Number(t.charged_gross)).toBe(200000);
      // net_to_org IS the retention, so what the organizer is owed still tracks.
      expect(Number(t.net_to_org)).toBe(30000);
      // Race Pace's commission was earned at capture and is not returned.
      expect(Number(t.platform_fee)).toBe(6000);
      expect(t.paid_count).toBe(1);
      // Must NOT be counted as still awaiting payment.
      expect(t.pending_count).toBe(0);

      // The event rollup must tell the same story as the org rollup.
      const ev = await f.s.from("admin_event_totals_v")
        .select("gross_revenue").eq("event_id", f.ev.id).single();
      if (ev.error) throw new Error(`admin_event_totals_v: ${ev.error.message}`);
      expect(Number(ev.data!.gross_revenue)).toBe(39000);

      const admin = await signedInAs(f.adminEmail);
      const agg = await admin.rpc("admin_payment_aggregates", {
        p_org_id: f.org.id, p_event_id: f.ev.id,
      });
      if (agg.error) throw new Error(`admin_payment_aggregates: ${agg.error.message}`);
      const a = agg.data![0];
      expect(Number(a.gross_cents)).toBe(39000);
      expect(Number(a.fee_cents)).toBe(6000);
      expect(Number(a.net_cents)).toBe(30000);
      // What actually went back to the runner. `amount` would have said 200000.
      expect(Number(a.refunded_cents)).toBe(161000);
      // The breakdown explains itself: what is left after the two fee-takers is
      // exactly the organizer's retention.
      expect(Number(a.gross_cents) - Number(a.fee_cents) - Number(a.net_cents)).toBe(3000);
    } finally {
      await f.cleanup();
    }
  });

  it("reports a FULL refund at net_to_org — what was actually returned — not the charge", async () => {
    const f = await fixture("full", 1);
    try {
      // Null p_refunded_amount means "refund everything", which under the
      // 2026-08-11 rule is the whole of net_to_org: ₱1,910, not ₱2,000.
      const refund = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {},
      });
      expect(refund.error).toBeNull();
      expect(refund.data).toBe("refunded");

      const admin = await signedInAs(f.adminEmail);
      const agg = await admin.rpc("admin_payment_aggregates", {
        p_org_id: f.org.id, p_event_id: f.ev.id,
      });
      if (agg.error) throw new Error(`admin_payment_aggregates: ${agg.error.message}`);
      const a = agg.data![0];
      // A fully refunded row keeps its original amount/platform_fee/net_to_org, so
      // it is excluded from gross/fee/net entirely — unchanged, and still right.
      expect(Number(a.gross_cents)).toBe(0);
      expect(Number(a.fee_cents)).toBe(0);
      expect(Number(a.net_cents)).toBe(0);
      // Reading `amount` here over-stated every full refund by platform_fee +
      // processor_fee_cents — ₱90 on this entry — because a refund now returns
      // net_to_org, not the whole charge.
      expect(Number(a.refunded_cents)).toBe(191000);

      // Same figure, from the registrations-side aggregate the event page reads.
      const reg = await admin.rpc("admin_registration_aggregates", { p_event_id: f.ev.id });
      if (reg.error) throw new Error(`admin_registration_aggregates: ${reg.error.message}`);
      expect(Number(reg.data![0].refunded_cents)).toBe(191000);
      expect(Number(reg.data![0].refund_count)).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("reports a 'historical' row at its full charge — the additive form would exceed it", async () => {
    const f = await fixture("historical", 0);
    try {
      // Pre-2026-08-11 terms: PayMongo really took ₱30 but the PLATFORM absorbed it,
      // so net_to_org is amount - platform_fee with NO processor deduction. That
      // violation of the ledger identity is deliberate and is itself the record that
      // Race Pace paid for processing on this entry (20260811090000's column comment).
      await f.addEntry({
        processor_fee_source: "historical", processor_fee_cents: 3000, net_to_org: 194000,
      });

      const totals = await f.s.from("admin_org_totals_v")
        .select("gross_revenue,charged_gross,net_to_org,platform_fee")
        .eq("org_id", f.org.id).single();
      if (totals.error) throw new Error(`admin_org_totals_v: ${totals.error.message}`);
      const t = totals.data!;

      // THIS IS WHY GROSS IS `amount - refunded_amount` AND NOT
      // `net_to_org + platform_fee + processor_fee_cents`. The two are equal by the
      // four-way split on every 'actual'/'predicted' row, so an empirical test on
      // those alone cannot tell them apart — and a future "simplification" to the
      // additive form would pass. Here it computes 194000 + 6000 + 3000 = 203000
      // against a ₱2,000 charge: gross_revenue > charged_gross, which is not a
      // representable state. Task 9's backfill creates exactly these rows.
      expect(Number(t.net_to_org) + Number(t.platform_fee) + 3000).toBe(203000);
      expect(Number(t.gross_revenue)).toBe(200000);
      expect(Number(t.charged_gross)).toBe(200000);
      expect(Number(t.gross_revenue)).toBeLessThanOrEqual(Number(t.charged_gross));

      const admin = await signedInAs(f.adminEmail);
      const agg = await admin.rpc("admin_payment_aggregates", {
        p_org_id: f.org.id, p_event_id: f.ev.id,
      });
      if (agg.error) throw new Error(`admin_payment_aggregates: ${agg.error.message}`);
      const a = agg.data![0];
      expect(Number(a.gross_cents)).toBe(200000);
      // gross - fee - net is the processing the ORGANIZER bore: zero here, because
      // the platform paid it. Not a broken identity — the correct answer.
      expect(Number(a.gross_cents) - Number(a.fee_cents) - Number(a.net_cents)).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("leaves a plain paid row's aggregates exactly as they were", async () => {
    const f = await fixture("paid", 2);
    try {
      const totals = await f.s.from("admin_org_totals_v")
        .select("gross_revenue,charged_gross,net_to_org,platform_fee,paid_count")
        .eq("org_id", f.org.id).single();
      if (totals.error) throw new Error(`admin_org_totals_v: ${totals.error.message}`);
      const t = totals.data!;
      // Nothing was refunded, so `amount - refunded_amount` IS `amount`.
      expect(Number(t.gross_revenue)).toBe(400000);
      expect(Number(t.charged_gross)).toBe(400000);
      expect(Number(t.net_to_org)).toBe(382000);
      expect(Number(t.platform_fee)).toBe(12000);
      expect(t.paid_count).toBe(2);

      const admin = await signedInAs(f.adminEmail);
      const agg = await admin.rpc("admin_payment_aggregates", {
        p_org_id: f.org.id, p_event_id: f.ev.id,
      });
      if (agg.error) throw new Error(`admin_payment_aggregates: ${agg.error.message}`);
      const a = agg.data![0];
      expect(Number(a.gross_cents)).toBe(400000);
      expect(Number(a.fee_cents)).toBe(12000);
      expect(Number(a.net_cents)).toBe(382000);
      expect(Number(a.refunded_cents)).toBe(0);
    } finally {
      await f.cleanup();
    }
  });
});
