import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** A confirmed ₱2,000 GCash entry: RP ₱60, PayMongo ₱30, organizer ₱1,910. */
async function paidEntry(tag: string, refundPolicy = "full", refundFee = 0) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  const org = (await s.from("organizations").insert({
    name: "Refund Org", slug: stamp,
    commission_type: "percent", commission_rate: 0.03,
    refund_policy: refundPolicy, refund_fee_cents: refundFee,
  }).select().single()).data!;
  // status doesn't matter — refund_registration_tx is exercised directly by RPC,
  // never through an anon/public read of the event. ('published' is not a member
  // of the event_status enum: draft|open|almost_full|closed|completed|cancelled.)
  const ev = (await s.from("events").insert({
    org_id: org.id, name: "Refund Race", status: "draft",
  }).select().single()).data!;
  const cat = (await s.from("categories").insert({
    org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
    base_price: 200000, slots_total: 100, slots_taken: 1,
  }).select().single()).data!;
  const user = (await s.auth.admin.createUser({
    email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
  })).data.user!;
  const reg = (await s.from("registrations").insert({
    org_id: org.id, event_id: ev.id, category_id: cat.id,
    user_id: user.id, total_amount: 200000, status: "paid",
  }).select().single()).data!;
  await s.from("payments").insert({
    org_id: org.id, registration_id: reg.id, amount: 200000, status: "paid", method: "gcash",
    platform_fee: 6000, processor_fee_cents: 3000, processor_fee_source: "actual",
    net_to_org: 191000,
  });
  return {
    s, org, reg, cat,
    cleanup: async () => {
      await s.from("organizations").delete().eq("id", org.id);
      await s.auth.admin.deleteUser(user.id);
    },
  };
}

describe("refund_registration_tx under the net_to_org rule", () => {
  it("FULL refund: returns exactly net_to_org and preserves the clawback figures", async () => {
    const f = await paidEntry("rfull");
    try {
      const { data } = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: "test",
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });
      expect(data).toBe("refunded");

      const pay = (await f.s.from("payments")
        .select("amount,platform_fee,processor_fee_cents,net_to_org,refunded_amount,status")
        .eq("registration_id", f.reg.id).single()).data!;

      // The runner got exactly what the organizer would have been paid.
      expect(pay.refunded_amount).toBe(191000);
      // Amount, commission and processor fee are IMMUTABLE — payout_open_statement
      // reads net_to_org off refunded rows to size a clawback.
      expect(pay).toMatchObject({
        amount: 200000, platform_fee: 6000, processor_fee_cents: 3000,
        net_to_org: 191000, status: "refunded",
      });

      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("refunded");
      const cat = (await f.s.from("categories").select("slots_taken").eq("id", f.cat.id).single()).data!;
      expect(cat.slots_taken).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("PARTIAL refund: the four-way split balances exactly and amount is NOT rewritten", async () => {
    const f = await paidEntry("rpart", "flat_fee", 30000);
    try {
      // Organizer retains ₱300 of their ₱1,910; runner gets ₱1,610.
      const { data } = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: "test",
        p_provider_refund: {}, p_refunded_amount: 161000, p_retained_net: 30000,
      });
      expect(data).toBe("partially_refunded");

      const pay = (await f.s.from("payments")
        .select("amount,platform_fee,processor_fee_cents,net_to_org,refunded_amount,status")
        .eq("registration_id", f.reg.id).single()).data!;

      expect(pay).toMatchObject({
        amount: 200000,          // NOT rewritten to the retained figure
        platform_fee: 6000,      // already earned — never re-struck
        processor_fee_cents: 3000,
        net_to_org: 30000,       // the organizer's retention
        refunded_amount: 161000,
        status: "partially_refunded",
      });

      // runner + organizer + Race Pace + PayMongo === what the runner paid
      expect(pay.refunded_amount + pay.net_to_org + pay.platform_fee + pay.processor_fee_cents)
        .toBe(pay.amount);

      // The entry survives: the runner keeps their place.
      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("paid");
      const cat = (await f.s.from("categories").select("slots_taken").eq("id", f.cat.id).single()).data!;
      expect(cat.slots_taken).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("is idempotent — a second full refund is a no-op", async () => {
    const f = await paidEntry("ridem");
    try {
      await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });
      const { data } = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });
      expect(data).toBe("already");
    } finally {
      await f.cleanup();
    }
  });

  it("refuses to refund more than the organizer received", async () => {
    // The old rule refunded `amount` — under the three-party ledger that would
    // hand back Race Pace's earned commission AND PayMongo's non-returnable fee.
    // A caller still computing from `amount` must fail loudly, not overdraw.
    const f = await paidEntry("rover");
    try {
      const r = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 200000, p_retained_net: 0,
      });
      expect(r.error).toBeTruthy();
      expect(r.error!.message).toContain("refund_exceeds_net_to_org");
      // Nothing moved.
      const pay = (await f.s.from("payments").select("status,refunded_amount")
        .eq("registration_id", f.reg.id).single()).data!;
      expect(pay.status).toBe("paid");
      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("paid");
    } finally {
      await f.cleanup();
    }
  });

  it("rejects the dropped p_retained_fee parameter outright", async () => {
    // p_retained_fee is GONE rather than defaulted: a caller still passing it has
    // not been taught that Race Pace keeps its commission on a refund, and would
    // otherwise silently re-strike commission on the organizer's retention.
    const f = await paidEntry("rfee");
    try {
      const r = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 191000,
        p_retained_fee: 0, p_retained_net: 0,
      });
      // The specific signal, not merely "an error": a permission failure or a
      // check-constraint violation would also be truthy, and neither would prove
      // the overload is gone. PGRST202 is PostgREST failing to resolve the name
      // + argument set at all.
      expect(r.error?.code).toBe("PGRST202");
      expect(r.error!.message).toContain("Could not find the function");
      expect(r.error!.message).toContain("p_retained_fee");
      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("paid");
    } finally {
      await f.cleanup();
    }
  });

  it("refuses a partial split that does not add up to net_to_org", async () => {
    // net_to_org is written straight from p_retained_net, so this identity is the
    // only thing standing between a stale caller and a silently corrupt ledger:
    //   refunded_amount + net_to_org + platform_fee + processor_fee_cents = amount
    // The figures below are exactly what a pre-2026-08-11 caller would compute on
    // this entry — refund struck off `amount` under a ₱300 flat fee (170000) and
    // a retention re-struck for commission (27000). Both individually plausible;
    // together they are ₱170 short of the ₱1,910 the organizer actually holds.
    const f = await paidEntry("rsplit", "flat_fee", 30000);
    try {
      const r = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 170000, p_retained_net: 27000,
      });
      expect(r.error).toBeTruthy();
      expect(r.error!.message).toContain("refund_split_mismatch");
      expect(r.error!.message).toContain("170000 + 27000 <> 191000");

      // Rolled back whole: the ledger is untouched and the entry still stands.
      const pay = (await f.s.from("payments")
        .select("amount,platform_fee,processor_fee_cents,net_to_org,refunded_amount,status")
        .eq("registration_id", f.reg.id).single()).data!;
      expect(pay).toMatchObject({
        amount: 200000, platform_fee: 6000, processor_fee_cents: 3000,
        net_to_org: 191000, refunded_amount: 0, status: "paid",
      });
      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("paid");
      const cat = (await f.s.from("categories").select("slots_taken").eq("id", f.cat.id).single()).data!;
      expect(cat.slots_taken).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("refuses a retention with no refunded amount, instead of discarding it", async () => {
    // A null amount means "refund everything", which cancels the entry and frees
    // the slot — so naming a retention alongside it is self-contradictory. The
    // realistic caller is payments-webhook settling a flat-fee refund parked
    // before this rule landed; taking the full branch there would quietly hand
    // back money the organizer had agreed to keep AND release their slot.
    const f = await paidEntry("rnullret", "flat_fee", 30000);
    try {
      const r = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.reg.id, p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: null, p_retained_net: 30000,
      });
      expect(r.error).toBeTruthy();
      expect(r.error!.message).toContain("refund_retention_without_amount");

      const reg = (await f.s.from("registrations").select("status").eq("id", f.reg.id).single()).data!;
      expect(reg.status).toBe("paid");
      const cat = (await f.s.from("categories").select("slots_taken").eq("id", f.cat.id).single()).data!;
      expect(cat.slots_taken).toBe(1);
    } finally {
      await f.cleanup();
    }
  });
});
