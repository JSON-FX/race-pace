import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("processor_rates", () => {
  it("seeds VAT-INCLUSIVE rates for the methods the checkout offers", async () => {
    const s = svc();
    const { data, error } = await s.from("processor_rates")
      .select("method,scope,percent_bps,fixed_cents")
      .eq("provider", "paymongo").is("effective_to", null);
    expect(error).toBeNull();
    const byKey = new Map(data!.map((r) => [`${r.method}:${r.scope}`, r]));

    // Quoted ex-VAT x 1.12. 3.125% -> 3.50%, ₱13.39 -> ₱15.00.
    expect(byKey.get("card:local")).toMatchObject({ percent_bps: 350, fixed_cents: 1500 });
    expect(byKey.get("card:international")).toMatchObject({ percent_bps: 450, fixed_cents: 1500 });
    expect(byKey.get("gcash:local")).toMatchObject({ percent_bps: 150, fixed_cents: 0 });
    expect(byKey.get("paymaya:local")).toMatchObject({ percent_bps: 150, fixed_cents: 0 });
  });

  it("returns the rate in force at a given time, not today's", async () => {
    const s = svc();
    const stamp = `rate-${Date.now()}`;
    // Close the current gcash row and open a new one, so there are two eras.
    const cut = "2026-09-01T00:00:00Z";
    await s.from("processor_rates").update({ effective_to: cut })
      .eq("provider", "paymongo").eq("method", "gcash").eq("scope", "local").is("effective_to", null);
    // No `!` here: the whole point of the fix below is that this can legitimately be
    // null (an insert that violates processor_rates_one_current), so the type must say so.
    const inserted = (await s.from("processor_rates").insert({
      provider: "paymongo", method: "gcash", scope: "local",
      percent_bps: 200, fixed_cents: 0, effective_from: cut, note: stamp,
    }).select().single()).data;
    try {
      const before = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: "gcash", p_scope: "local",
        p_at: "2026-08-15T00:00:00Z",
      });
      expect(before.data![0]).toMatchObject({ percent_bps: 150 });

      const after = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: "gcash", p_scope: "local",
        p_at: "2026-09-15T00:00:00Z",
      });
      expect(after.data![0]).toMatchObject({ percent_bps: 200 });
    } finally {
      // Independent statements, not two steps of one cleanup. If the insert above ever
      // failed (data: null — e.g. the update on line 29/30 matched zero rows, so this insert
      // collides with processor_rates_one_current), a `finally` written as
      // `.eq("id", inserted.id)` unconditionally would throw on the null access — and
      // because that throw happens INSIDE `finally`, it skips whatever statement follows it.
      // The one that must never be skipped is the reopen below: it's what un-does this
      // test's own `effective_to: cut` update on the seeded row, and skipping it leaves that
      // row permanently closed for every other test/suite sharing this database. Guarding
      // the delete — and running the reopen unconditionally after it, not nested inside its
      // success — keeps the reopen reachable even when the insert never produced a row.
      if (inserted) {
        await s.from("processor_rates").delete().eq("id", inserted.id);
      }
      await s.from("processor_rates").update({ effective_to: null })
        .eq("provider", "paymongo").eq("method", "gcash").eq("scope", "local").eq("effective_to", cut);
    }
  });

  it("returns no row for a method with no rate card entry", async () => {
    const s = svc();
    const { data } = await s.rpc("processor_rate_at", {
      p_provider: "paymongo", p_method: "grab_pay", p_scope: "local",
      p_at: "2026-08-15T00:00:00Z",
    });
    expect(data ?? []).toHaveLength(0);
  });

  it("allows only one open-ended row per provider/method/scope", async () => {
    const s = svc();
    const res = await s.from("processor_rates").insert({
      provider: "paymongo", method: "gcash", scope: "local",
      percent_bps: 999, fixed_cents: 0,
    });
    expect(res.error).not.toBeNull();
  });
});

/**
 * Drift detection — the view that reads the rate card's accuracy back out of
 * real money. Design 2026-08-11 §5.
 *
 * METHOD CHOICE IS DELIBERATE in every test below.
 *
 * `processor_rate_drift_v` has no tenant key: it is a global window over the
 * last 20 eligible payments PER METHOD, so any other test that creates an
 * eligible payment on the same method lands in the same sample. The first test
 * has to use `card` (the rate card's only fixed-component method, and the one
 * the design's worked example is written against); the boundary tests below use
 * `paymaya`, which no other test in this repo transacts on, so their samples are
 * theirs alone. Each test cascade-deletes its org in `finally`, which is what
 * keeps them from polluting each other within this file.
 */
describe("processor_rate_drift_v", () => {
  /** A throwaway org + event + category, and a way to bill payments to it. */
  async function fixture(stamp: string) {
    const s = svc();
    const org = (await s.from("organizations").insert({
      name: `Drift Org ${stamp}`, slug: stamp, commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    const users: string[] = [];
    const ev = (await s.from("events").insert({
      org_id: org.id, name: "Drift Race", status: "draft",
    }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
      base_price: 200000, slots_total: 500, slots_taken: 0,
    }).select().single()).data!;

    /**
     * One paid registration + payment per entry, in TWO batch inserts rather
     * than a loop of round trips. Not a tidiness preference: the view orders by
     * created_at, so a loop spreads this sample across seconds during which
     * another test file's payment on the same method can interleave into the
     * middle of it. A single statement gives every row the same transaction
     * timestamp, which closes that window to the width of one insert.
     */
    async function bill(rows: { method: string; amount: number; actual: number; predicted: number }[]) {
      const made: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        // A separate runner per row: one live registration per (user, event).
        const u = (await s.auth.admin.createUser({
          email: `drift${i}_${stamp}@test.dev`, password: "password123", email_confirm: true,
        })).data.user!;
        users.push(u.id);
        made.push(u.id);
      }
      const regs = (await s.from("registrations").insert(
        rows.map((r, i) => ({
          org_id: org.id, event_id: ev.id, category_id: cat.id,
          user_id: made[i], total_amount: r.amount, status: "paid",
        })),
      ).select("id")).data!;
      const { error } = await s.from("payments").insert(
        rows.map((r, i) => ({
          org_id: org.id, registration_id: regs[i].id, amount: r.amount,
          status: "paid", method: r.method,
          platform_fee: 6000, net_to_org: r.amount - 6000 - r.actual,
          processor_fee_cents: r.actual,
          processor_fee_predicted_cents: r.predicted,
          processor_fee_source: "actual",
        })),
      );
      expect(error).toBeNull();
    }

    const row = async (method: string) =>
      (await s.from("processor_rate_drift_v").select("*")
        .eq("method", method).eq("scope", "local").maybeSingle()).data;

    return {
      s, org, bill, row,
      cleanup: async () => {
        await s.from("organizations").delete().eq("id", org.id);
        for (const id of users) await s.auth.admin.deleteUser(id);
      },
    };
  }

  it("flags a method whose actual fees consistently exceed the rate card", async () => {
    const f = await fixture(`drift-${Date.now()}`);
    try {
      // 14 card payments that each cost 3.80% + ₱15 while the card says 3.50%.
      await f.bill(Array.from({ length: 14 }, () => ({
        method: "card", amount: 200000,
        actual: 9100,    // 3.8% of ₱2,000 + ₱15
        predicted: 8500, // 3.5% + ₱15
      })));

      const data = await f.row("card");

      expect(data!.sample_size).toBeGreaterThanOrEqual(14);
      expect(data!.card_bps).toBe(350);
      expect(data!.median_implied_bps).toBe(380);
      expect(data!.drifting).toBe(true);
      // 14 x ₱6.00 under-collected.
      expect(data!.delta_cents).toBe(8400);
    } finally {
      await f.cleanup();
    }
  });

  it("flags at EXACTLY 80% disagreeing and at a disagreement just over ₱1", async () => {
    const f = await fixture(`drift80-${Date.now()}`);
    try {
      // paymaya: 150 bps, no fixed component. Five payments, four of them ₱1.01
      // dearer than predicted — 4/5 is exactly the threshold, and ₱1.01 is the
      // smallest disagreement that counts.
      await f.bill([
        ...Array.from({ length: 4 }, () => ({
          method: "paymaya", amount: 200000, actual: 3101, predicted: 3000,
        })),
        { method: "paymaya", amount: 200000, actual: 3000, predicted: 3000 },
      ]);

      const data = await f.row("paymaya");
      expect(data!.sample_size).toBe(5);
      expect(data!.disagreeing).toBe(4);
      expect(data!.drifting).toBe(true);
      expect(data!.delta_cents).toBe(404);
      // (3101 - 0) / 200000 = 155.05 bps on four rows, 150 on the fifth.
      expect(data!.median_implied_bps).toBe(155);
      expect(data!.card_bps).toBe(150);
    } finally {
      await f.cleanup();
    }
  });

  it("does NOT flag a disagreement of exactly ₱1, or a sample only 75% disagreeing", async () => {
    const f = await fixture(`driftedge-${Date.now()}`);
    try {
      // Three at exactly ₱1.00 — "more than ₱1" is strict, so none of them count —
      // and one at ₱1.01, which does. 1/4 is 25%.
      await f.bill([
        ...Array.from({ length: 3 }, () => ({
          method: "paymaya", amount: 200000, actual: 3100, predicted: 3000,
        })),
        { method: "paymaya", amount: 200000, actual: 3101, predicted: 3000 },
      ]);

      const data = await f.row("paymaya");
      expect(data!.sample_size).toBe(4);
      expect(data!.disagreeing).toBe(1);
      // Two independent reasons this is false: 25% < 80%, and 4 < the 5-row minimum.
      expect(data!.drifting).toBe(false);
      // The delta is still reported in full — an unflagged sample is not a silent one.
      expect(data!.delta_cents).toBe(401);
    } finally {
      await f.cleanup();
    }
  });

  it("does not flag a sample that disagrees in both directions", async () => {
    const f = await fixture(`driftmix-${Date.now()}`);
    try {
      // 6 over and 4 under, all by well over ₱1. Ten of ten "disagree", but a
      // rate change moves every payment the SAME way — this is noise, and the
      // near-zero delta says so.
      await f.bill([
        ...Array.from({ length: 6 }, () => ({
          method: "paymaya", amount: 200000, actual: 3500, predicted: 3000,
        })),
        ...Array.from({ length: 4 }, () => ({
          method: "paymaya", amount: 200000, actual: 2500, predicted: 3000,
        })),
      ]);

      const data = await f.row("paymaya");
      expect(data!.sample_size).toBe(10);
      // The dominant direction only: 6 of 10, not 10 of 10.
      expect(data!.disagreeing).toBe(6);
      expect(data!.drifting).toBe(false);
      expect(data!.delta_cents).toBe(1000); // 6 x 500 - 4 x 500
    } finally {
      await f.cleanup();
    }
  });

  it("ignores predicted, historical and none rows — a prediction is not evidence about itself", async () => {
    const f = await fixture(`driftsrc-${Date.now()}`);
    try {
      // Five paymaya payments that would each look like 200 bps of drift, tagged
      // with every source except 'actual'. If any of them counted, the view would
      // report a sample here.
      const s = f.s;
      await f.bill(Array.from({ length: 5 }, () => ({
        method: "paymaya", amount: 200000, actual: 4000, predicted: 3000,
      })));
      const ids = (await s.from("payments").select("id").eq("org_id", f.org.id)).data!;
      for (let i = 0; i < ids.length; i++) {
        await s.from("payments").update(
          i === 0 ? { processor_fee_source: "predicted" }
          : i === 1 ? { processor_fee_source: "historical", processor_fee_predicted_cents: null }
          : i === 2 ? { processor_fee_source: "none", processor_fee_predicted_cents: null }
          // 'actual' but the confirmation had no rate card to predict from.
          : i === 3 ? { processor_fee_predicted_cents: null }
          : { processor_fee_source: "predicted" },
        ).eq("id", ids[i].id);
      }

      expect(await f.row("paymaya")).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it("measures a pass-on payment against the amount actually charged, not the base", async () => {
    const f = await fixture(`driftpass-${Date.now()}`);
    try {
      // A grossed-up card entry: ₱2,150.26 charged on a ₱2,000 sticker price,
      // costing exactly the carded 3.50% + ₱15 of the CHARGE (₱90.26).
      //
      // Struck on the ₱2,000 base this would read (9026 - 1500) / 200000 = 376 bps
      // and every pass-on payment would look like a permanent 26 bps rate rise —
      // measuring the fee MODE instead of drift. Against the charge it is 350,
      // the card's own figure, and nothing is flagged.
      await f.bill(Array.from({ length: 6 }, () => ({
        method: "card", amount: 215026, actual: 9026, predicted: 9026,
      })));

      const data = await f.row("card");
      expect(data!.sample_size).toBeGreaterThanOrEqual(6);
      expect(data!.median_implied_bps).toBe(350);
      expect(data!.median_implied_bps).not.toBe(376);
      expect(data!.disagreeing).toBe(0);
      expect(data!.drifting).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
});
