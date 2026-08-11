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

// The refund rule, 2026-08-11 §6: the runner is refunded exactly what the
// organizer would have been paid — `net_to_org`, never `amount`. Race Pace's
// commission is an EARNED service fee and is retained on a refund; PayMongo
// never returns its fee. This fixture's ₱2,000 entry therefore refunds ₱1,800.
//
// This supersedes 2026-08-06 §5, under which a refund returned the commission
// too and a flat-fee retention was re-struck as a smaller sale. Do not restore
// those expectations because an older comment still describes them.
describe("refund_registration_tx with policy", () => {
  it("a full refund returns net_to_org, cancels the entry and frees the slot", async () => {
    const { s, org, cat, reg, uid } = await fixture("full", { refund_policy: "full" });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 180000, p_retained_net: 0,
      });
      expect(r.data).toBe("refunded");

      const pay = await payment(s, reg.id);
      expect(pay.status).toBe("refunded");
      // Exactly what the organizer would have been paid — NOT the ₱2,000 charged.
      expect(pay.refunded_amount).toBe(180000);
      // The original split SURVIVES a full refund — payout_open_statement reads
      // net_to_org off refunded rows to size a clawback.
      expect(pay.amount).toBe(200000);
      expect(pay.platform_fee).toBe(20000);
      expect(pay.net_to_org).toBe(180000);
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("refunded");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("a flat-fee refund moves only net_to_org, and the split still balances", async () => {
    const { s, org, cat, reg, uid } = await fixture("flat", {
      refund_policy: "flat_fee", refund_fee_cents: 30000,
    });
    try {
      // The organizer retains ₱300 of their ₱1,800; the runner gets ₱1,500 back.
      // The ₱200 commission is NOT re-struck on the retention — it was earned in
      // full at capture, and charging it again would charge twice for one sale.
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 150000, p_retained_net: 30000,
      });
      expect(r.data).toBe("partially_refunded");

      const pay = await payment(s, reg.id);
      expect(pay.status).toBe("partially_refunded");
      // `amount` is NOT rewritten to the retained figure: under the three-party
      // ledger that would permanently break amount - processor_fee = the
      // provider's net_amount.
      expect(pay.amount).toBe(200000);
      expect(pay.platform_fee).toBe(20000);
      expect(pay.net_to_org).toBe(30000);
      expect(pay.refunded_amount).toBe(150000);
      // runner + organizer + Race Pace === what the runner paid (this fixture
      // predates processor fees, so PayMongo's share is 0).
      expect(pay.refunded_amount + pay.net_to_org + pay.platform_fee).toBe(pay.amount);

      // The entry survives, so the runner keeps their place and the slot stays taken.
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("paid");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("leaves the original amount in place, with no raw.original_amount shim", async () => {
    const { s, org, reg, uid } = await fixture("orig", { refund_policy: "flat_fee", refund_fee_cents: 30000 });
    try {
      await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 150000, p_retained_net: 30000,
      });
      // `original_amount` existed only because `amount` used to be overwritten.
      // It no longer is, so the column itself is the record of the sale and the
      // raw shim must be gone — two sources of truth for one number is how they
      // drift apart.
      const row = (await s.from("payments").select("amount,raw").eq("registration_id", reg.id).single()).data!;
      const raw = row.raw as Record<string, unknown>;
      expect(row.amount).toBe(200000);
      expect(raw.original_amount).toBeUndefined();
      expect(raw.partial).toBe(true);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("treats a null refunded_amount as a full refund of net_to_org (old 4-arg behaviour)", async () => {
    const { s, org, reg, uid } = await fixture("nullamt", { refund_policy: "full" });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: null, p_retained_net: 0,
      });
      expect(r.data).toBe("refunded");
      // "Everything" now means the whole of net_to_org, not the whole charge.
      expect((await payment(s, reg.id)).refunded_amount).toBe(180000);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("refuses to refund more than the organizer received", async () => {
    // A caller still computing the refund from `amount` overdraws here rather
    // than silently paying the runner out of Race Pace's commission.
    const { s, org, cat, reg, uid } = await fixture("overdraw", { refund_policy: "full" });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 200000, p_retained_net: 0,
      });
      expect(r.error).toBeTruthy();
      expect(r.error!.message).toContain("refund_exceeds_net_to_org");
      // The whole transaction rolled back: nothing refunded, slot still taken.
      expect((await payment(s, reg.id)).status).toBe("paid");
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("paid");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("is idempotent on a fully refunded entry", async () => {
    const { s, org, reg, uid } = await fixture("idem", { refund_policy: "full" });
    try {
      const args = {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 180000, p_retained_net: 0,
      };
      expect((await s.rpc("refund_registration_tx", args)).data).toBe("refunded");
      expect((await s.rpc("refund_registration_tx", args)).data).toBe("already");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("rejects the dropped p_retained_fee overload", async () => {
    // Adding or removing parameters creates an OVERLOAD rather than replacing,
    // so 20260811094000_refund_net_to_org.sql drops the 7-arg form explicitly.
    // If it had survived, every un-updated call site would still bind to it as an
    // exact match and would go on re-striking commission on the retention —
    // charging twice for one sale.
    //
    // PostgREST resolves an RPC by the exact argument names it is given, so this
    // 7-key call must find no function at all.
    const { s, org, reg, uid } = await fixture("overload7", { refund_policy: "flat_fee", refund_fee_cents: 30000 });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
        p_refunded_amount: 150000, p_retained_fee: 3000, p_retained_net: 27000,
      });
      expect(r.error).toBeTruthy();
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("paid");
      expect((await payment(s, reg.id)).status).toBe("paid");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("rejects the dropped 4-argument overload", async () => {
    // The original 4-arg function was dropped by 20260807090400_refund_policy_tx.sql.
    // PostgREST resolves an RPC by the exact argument names it is given, so a
    // 4-key call reaching the current function proves the old one is gone: with
    // both present this would have bound to the 4-arg version instead.
    const { s, org, reg, uid } = await fixture("overload", { refund_policy: "flat_fee", refund_fee_cents: 30000 });
    try {
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {},
      });
      // Defaults fill the remaining params: p_refunded_amount null → full refund
      // of net_to_org.
      expect(r.error).toBeFalsy();
      expect(r.data).toBe("refunded");
      expect((await payment(s, reg.id)).refunded_amount).toBe(180000);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });
});
