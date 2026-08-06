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
    expect(org.commission_type).toBe("fixed");
    expect(org.refund_policy).toBe("flat_fee");
    await s.from("organizations").delete().eq("id", org.id);
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
    const org = (await s.from("organizations").insert({ name: "Partial", slug: stamp }).select().single()).data!;
    const ev = (await s.from("events").insert({ org_id: org.id, name: "R", status: "open" }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
      base_price: 200000, slots_total: 50, slots_taken: 0,
    }).select().single()).data!;
    const u = await s.auth.admin.createUser({ email: `p_${stamp}@test.dev`, password: "password123", email_confirm: true });
    const uid = u.data.user!.id;
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id,
      user_id: uid, total_amount: 200000, status: "paid",
    }).select().single()).data!;
    // Retained ₱300 of a ₱2,000 entry: amount/fee/net describe the RETAINED sale,
    // refunded_amount records the ₱1,700 that went back.
    const payIns = await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 30000, platform_fee: 3000,
      net_to_org: 27000, refunded_amount: 170000, status: "partially_refunded", provider: "fake",
    });
    if (payIns.error) throw new Error(`payment insert: ${payIns.error.message}`);

    const totals = await s.from("admin_org_totals_v")
      .select("gross_revenue,net_to_org,paid_count,pending_count")
      .eq("org_id", org.id).single();
    if (totals.error) throw new Error(`admin_org_totals_v: ${totals.error.message}`);
    const t = totals.data!;
    expect(Number(t.gross_revenue)).toBe(30000);
    expect(Number(t.net_to_org)).toBe(27000);
    expect(t.paid_count).toBe(1);
    // Must NOT be counted as still awaiting payment.
    expect(t.pending_count).toBe(0);

    await s.from("payments").delete().eq("registration_id", reg.id);
    await s.from("registrations").delete().eq("id", reg.id);
    await s.from("organizations").delete().eq("id", org.id);
    await s.auth.admin.deleteUser(uid);
  });
});
