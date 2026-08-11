import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** A paid ₱2,000 entry (fee ₱200, net ₱1,800) under the given org terms.
 *  Exception-safe: if any insert after the org fails partway through, whatever this
 *  function already created is torn down here before rethrowing, so a broken fixture
 *  can never leak rows into the shared hosted project on its own. */
async function fixture(tag: string, orgPatch: Record<string, unknown>) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    const org = (await s.from("organizations").insert({
      name: "Refund Org", slug: stamp,
      commission_type: "percent", commission_rate: 0.10,
      ...orgPatch,
    }).select().single()).data!;
    cleanups.push(() => s.from("organizations").delete().eq("id", org.id));
    // status doesn't matter — refund_registration_tx is exercised directly by RPC,
    // never through an anon/public read of the event.
    const ev = (await s.from("events").insert({ org_id: org.id, name: "R", status: "draft" }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
      base_price: 200000, slots_total: 10, slots_taken: 1,
    }).select().single()).data!;
    const u = await s.auth.admin.createUser({ email: `rf_${stamp}@test.dev`, password: "password123", email_confirm: true });
    const uid = u.data.user!.id;
    cleanups.push(() => s.auth.admin.deleteUser(uid));
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id,
      user_id: uid, total_amount: 200000, status: "paid",
    }).select().single()).data!;
    await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 200000,
      platform_fee: 20000, net_to_org: 180000, status: "paid", provider: "fake",
    });
    return { s, org, cat, reg, uid };
  } catch (err) {
    for (const fn of cleanups.reverse()) await fn();
    throw err;
  }
}

async function cleanup(s: SupabaseClient, orgId: string, uid: string) {
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

const payment = async (s: SupabaseClient, regId: string) =>
  (await s.from("payments")
    .select("status,amount,platform_fee,net_to_org,refunded_amount")
    .eq("registration_id", regId).single()).data!;

describe("refund_registration_tx with policy", () => {
  it("a full refund cancels the entry and frees the slot", async () => {
    const { s, org, cat, reg, uid } = await fixture("full", { refund_policy: "full" });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 200000, p_retained_fee: 0, p_retained_net: 0,
      });
      expect(r.data).toBe("refunded");

      const pay = await payment(s, reg.id);
      expect(pay.status).toBe("refunded");
      expect(pay.refunded_amount).toBe(200000);
      // The original split SURVIVES a full refund — payout_open_statement reads
      // net_to_org off refunded rows to size a clawback.
      expect(pay.net_to_org).toBe(180000);
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("refunded");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("a flat-fee refund leaves a smaller sale, keeping fee + net === amount", async () => {
    const { s, org, cat, reg, uid } = await fixture("flat", {
      refund_policy: "flat_fee", refund_fee_cents: 30000,
    });
    try {
      // Retained ₱300 → fee ₱30, net ₱270. The runner gets ₱1,700 back.
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 170000, p_retained_fee: 3000, p_retained_net: 27000,
      });
      expect(r.data).toBe("partially_refunded");

      const pay = await payment(s, reg.id);
      expect(pay.status).toBe("partially_refunded");
      expect(pay.amount).toBe(30000);
      expect(pay.platform_fee).toBe(3000);
      expect(pay.net_to_org).toBe(27000);
      expect(pay.platform_fee + pay.net_to_org).toBe(pay.amount);
      expect(pay.refunded_amount).toBe(170000);

      // The entry survives, so the runner keeps their place and the slot stays taken.
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("paid");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("keeps the original amount recoverable from raw after a partial refund", async () => {
    const { s, org, reg, uid } = await fixture("orig", { refund_policy: "flat_fee", refund_fee_cents: 30000 });
    try {
      await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 170000, p_retained_fee: 3000, p_retained_net: 27000,
      });
      // `amount` is now the retained figure, so this is the only trace of the sale.
      const raw = (await s.from("payments").select("raw").eq("registration_id", reg.id).single()).data!.raw as Record<string, unknown>;
      expect(raw.original_amount).toBe(200000);
      expect(raw.partial).toBe(true);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("treats a null refunded_amount as a full refund (old 4-arg behaviour)", async () => {
    const { s, org, reg, uid } = await fixture("nullamt", { refund_policy: "full" });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: null, p_retained_fee: 0, p_retained_net: 0,
      });
      expect(r.data).toBe("refunded");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("is idempotent on a fully refunded entry", async () => {
    const { s, org, reg, uid } = await fixture("idem", { refund_policy: "full" });
    try {
      const args = {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 200000, p_retained_fee: 0, p_retained_net: 0,
      };
      expect((await s.rpc("refund_registration_tx", args)).data).toBe("refunded");
      expect((await s.rpc("refund_registration_tx", args)).data).toBe("already");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("rejects the dropped 4-argument overload", async () => {
    // Adding parameters creates an OVERLOAD rather than replacing, so the
    // migration drops the old 4-arg function explicitly. If it had survived,
    // every existing call site would still bind to it as an exact match and none
    // of the policy logic above would ever run.
    //
    // PostgREST resolves an RPC by the exact argument names it is given, so a
    // 4-key call reaching the 7-arg function proves the old one is gone: with
    // both present this would have bound to the 4-arg version and succeeded
    // as a full refund.
    const { s, org, reg, uid } = await fixture("overload", { refund_policy: "flat_fee", refund_fee_cents: 30000 });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
      });
      // Defaults fill the three new params: p_refunded_amount null → full refund.
      expect(r.error).toBeFalsy();
      expect(r.data).toBe("refunded");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });
});
