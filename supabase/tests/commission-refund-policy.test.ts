import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

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

  it("counts a partially_refunded payment as revenue in admin_org_totals_v", async () => {
    const s = svc();
    const stamp = `partial-${Date.now()}`;
    // org first, atomically — nothing else exists yet, so nothing to clean up if this itself fails.
    const org = (await s.from("organizations").insert({ name: "Partial", slug: stamp }).select().single()).data!;
    let uid: string | undefined;
    try {
      // status doesn't matter — this only exercises admin_org_totals_v via a service-role read.
      const ev = (await s.from("events").insert({ org_id: org.id, name: "R", status: "draft" }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
        base_price: 200000, slots_total: 50, slots_taken: 0,
      }).select().single()).data!;
      const u = await s.auth.admin.createUser({ email: `p_${stamp}@test.dev`, password: "password123", email_confirm: true });
      uid = u.data.user!.id;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: uid, total_amount: 200000, status: "paid",
      }).select().single()).data!;
      // A ₱2,000 GCash entry, partially refunded with the organizer retaining ₱300.
      //
      // The shape here is the one 20260811094000_refund_net_to_org.sql writes, and
      // it is NOT the 2026-08-06 one: `amount` stays at what the runner actually
      // paid and `platform_fee` at the commission Race Pace earned at capture —
      // both immutable, because under the three-party ledger
      // `amount - processor_fee_cents` must keep matching the provider's
      // net_amount. Only `net_to_org` drops, to the organizer's retention.
      // The four-way split still balances: 161000 + 30000 + 6000 + 3000 = 200000.
      const payIns = await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 200000, platform_fee: 6000,
        processor_fee_cents: 3000, net_to_org: 30000, refunded_amount: 161000,
        status: "partially_refunded", provider: "fake",
      });
      if (payIns.error) throw new Error(`payment insert: ${payIns.error.message}`);

      const totals = await s.from("admin_org_totals_v")
        .select("gross_revenue,net_to_org,paid_count,pending_count")
        .eq("org_id", org.id).single();
      if (totals.error) throw new Error(`admin_org_totals_v: ${totals.error.message}`);
      const t = totals.data!;
      // gross_revenue is what the runner paid — `amount` is no longer rewritten
      // down to the retained figure, so a partial refund no longer shrinks it.
      expect(Number(t.gross_revenue)).toBe(200000);
      // net_to_org IS the retention, so what the organizer is owed still tracks.
      expect(Number(t.net_to_org)).toBe(30000);
      expect(t.paid_count).toBe(1);
      // Must NOT be counted as still awaiting payment.
      expect(t.pending_count).toBe(0);
    } finally {
      // org delete cascades event/category/registration/payment; the auth user is separate.
      await s.from("organizations").delete().eq("id", org.id);
      if (uid) await s.auth.admin.deleteUser(uid);
    }
  });
});
