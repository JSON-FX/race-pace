import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * A real signed-in session on the ANON key.
 *
 * Not interchangeable with `svc()`: service_role carries rolbypassrls, so RLS is
 * skipped at the ROLE level and no query made through it can say anything about
 * whether a view respects the caller's policies. Only a genuine `authenticated`
 * session exercises that.
 */
async function signedInAs(email: string, password = "password123"): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

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
    /**
     * `qrph`, NOT `gcash`. The method here is load-bearing, and it used to be
     * gcash — which made this test a cross-file hazard.
     *
     * `processor_rates` is shared, seeded, global state. For the length of this
     * test the seeded row for whichever method it names is closed and a 200 bps
     * successor is open in its place. Any test in ANY file that reads the
     * current rate for that method inside the window gets 200 and computes its
     * expectations from it — while `confirm.ts`, which resolves the rate AT THE
     * PAYMENT'S TIMESTAMP, correctly still gets 150. The failure is a money
     * assertion in a completely unrelated file:
     *
     *   backend.test.ts > checkout -> webhook -> paid …
     *   AssertionError: expected 3600 to be 4800
     *
     * (`4800` is 240000 x 200bps; the stored `3600` is the right answer.)
     * backend.test.ts reads GCASH_RATE once in beforeAll (line 52) and
     * currentRate() per test (line 741), so it is exposed for its whole run.
     *
     * That race was always latent; it fired roughly one run in three once the
     * drift tests below changed this file's schedule. Rather than move the
     * window around and hope, the fix is to stop touching data anybody else
     * reads: `qrph` is seeded at the same 150/0 and appears in no other test,
     * no edge function and no app — payment-session's METHOD_MAP cannot even
     * offer it. Nothing this test proves depends on which method it uses.
     *
     * If you need to add a rate-card mutation test, use an unreachable seeded
     * method (`qrph`, `dob`, `billease`) for the same reason.
     */
    const method = "qrph";
    const cut = "2026-09-01T00:00:00Z";
    await s.from("processor_rates").update({ effective_to: cut })
      .eq("provider", "paymongo").eq("method", method).eq("scope", "local").is("effective_to", null);
    // No `!` here: the whole point of the fix below is that this can legitimately be
    // null (an insert that violates processor_rates_one_current), so the type must say so.
    const inserted = (await s.from("processor_rates").insert({
      provider: "paymongo", method, scope: "local",
      percent_bps: 200, fixed_cents: 0, effective_from: cut, note: stamp,
    }).select().single()).data;
    try {
      const before = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: method, p_scope: "local",
        p_at: "2026-08-15T00:00:00Z",
      });
      expect(before.data![0]).toMatchObject({ percent_bps: 150 });

      const after = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: method, p_scope: "local",
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
        .eq("provider", "paymongo").eq("method", method).eq("scope", "local").eq("effective_to", cut);
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
  /** A throwaway org and a way to bill payments to it. */
  async function fixture(stamp: string) {
    const s = svc();
    const org = (await s.from("organizations").insert({
      name: `Drift Org ${stamp}`, slug: stamp, commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    /**
     * ONE runner for the whole fixture, not one per entry.
     *
     * `registrations_one_live_per_event` is unique on `(event_id, user_id)`
     * where status in ('pending','paid'), so staging N live registrations needs
     * N distinct EVENTS or N distinct users — and an event is a cheap row where
     * an auth user is a bcrypt round trip through GoTrue. The first draft of
     * these tests created ~56 users per run, and that cost did not stay local:
     * it lengthened this file enough to shift the whole suite's scheduling and
     * started aligning pre-existing cross-file races that had been dormant.
     * A test fixture's footprint on shared services is part of its correctness
     * when 38 files share one database.
     *
     * The events are `draft`, deliberately: fn_notify_on_event_change()
     * broadcasts a notification to EVERY profile when an event is inserted as
     * `open`, so a loop of open events would write a row per user per event
     * into a table another file is asserting against.
     */
    const runnerId = (await s.auth.admin.createUser({
      email: `drift-runner-${stamp}@test.dev`, password: "password123", email_confirm: true,
    })).data.user!.id;
    const users: string[] = [runnerId];

    /**
     * One event + category + paid registration + payment per entry, as FOUR
     * batch inserts rather than a loop of round trips. Not a tidiness
     * preference: the view orders by created_at, so a loop spreads this sample
     * across seconds during which another test file's payment on the same
     * method can interleave into the middle of it. One statement per table
     * gives every row the same transaction timestamp, which closes that window
     * to the width of a single insert.
     */
    async function bill(rows: { method: string; amount: number; actual: number; predicted: number }[]) {
      const n = rows.length;
      // Keyed by name/event_id rather than by RETURNING position: the order is
      // reliable in practice, but a silent mis-pairing here would attach the
      // wrong `amount` to a payment and quietly change what the view computes.
      const evs = (await s.from("events").insert(
        Array.from({ length: n }, (_, i) => ({
          org_id: org.id, name: `Drift Race ${stamp} ${i}`, status: "draft",
        })),
      ).select("id,name")).data!;
      const evByIdx = new Map(evs.map((e) => [Number(e.name.split(" ").pop()), e.id as string]));
      expect(evByIdx.size).toBe(n);

      const cats = (await s.from("categories").insert(
        Array.from({ length: n }, (_, i) => ({
          org_id: org.id, event_id: evByIdx.get(i), code: "40k", label: "40K",
          base_price: rows[i].amount, slots_total: 10, slots_taken: 0,
        })),
      ).select("id,event_id")).data!;
      const catByEvent = new Map(cats.map((c) => [c.event_id as string, c.id as string]));

      const regs = (await s.from("registrations").insert(
        rows.map((r, i) => ({
          org_id: org.id, event_id: evByIdx.get(i), category_id: catByEvent.get(evByIdx.get(i)!),
          user_id: runnerId, total_amount: r.amount, status: "paid",
        })),
      ).select("id,event_id")).data!;
      const regByEvent = new Map(regs.map((r) => [r.event_id as string, r.id as string]));

      const { error } = await s.from("payments").insert(
        rows.map((r, i) => ({
          org_id: org.id, registration_id: regByEvent.get(evByIdx.get(i)!), amount: r.amount,
          status: "paid", method: r.method,
          platform_fee: 6000, net_to_org: r.amount - 6000 - r.actual,
          processor_fee_cents: r.actual,
          processor_fee_predicted_cents: r.predicted,
          processor_fee_source: "actual",
        })),
      );
      expect(error).toBeNull();
    }

    /**
     * The view's row for one method, read as `as` (the service role by default).
     *
     * `.error` is asserted here rather than at the call sites, because a test
     * that only checks `data` cannot tell "correctly excluded" from "the query
     * blew up": `maybeSingle()` returns `{ data: null }` for both, so an
     * `expect(row).toBeNull()` would pass just as happily against a dropped view
     * or a revoked grant as against a working exclusion filter.
     */
    const row = async (method: string, as: SupabaseClient = s) => {
      const { data, error } = await as.from("processor_rate_drift_v").select("*")
        .eq("method", method).eq("scope", "local").maybeSingle();
      expect(error).toBeNull();
      return data;
    };

    return {
      s, org, bill, row,
      /** Adopt a user created elsewhere so this fixture's cleanup deletes it. */
      own: (uid: string) => users.push(uid),
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
      // Five payments that would each look like 200 bps of drift, one per reason
      // the view refuses to count a row. If any single reason failed, a sample
      // would appear on that method.
      const s = f.s;
      await f.bill([
        ...Array.from({ length: 4 }, () => ({
          method: "paymaya", amount: 200000, actual: 4000, predicted: 3000,
        })),
        // Reason 5 is not about the row at all: 'actual' with a real prediction,
        // on a method processor_rates has no CURRENT row for, so the inner join
        // drops it. There is no card to have drifted from. (grab_pay is
        // deliberately absent from the seed — 20260811091000's header explains
        // why: its quoted rate is a range across integration tiers.)
        { method: "grab_pay", amount: 200000, actual: 4000, predicted: 3000 },
      ]);
      const ids = (await s.from("payments").select("id")
        .eq("org_id", f.org.id).eq("method", "paymaya")).data!;
      expect(ids).toHaveLength(4);
      for (let i = 0; i < ids.length; i++) {
        const { error } = await s.from("payments").update(
          // The actual WAS COPIED FROM the prediction; counting it compares a
          // number to itself.
          i === 0 ? { processor_fee_source: "predicted" }
          // Recovered by the backfill, which writes no prediction at all.
          : i === 1 ? { processor_fee_source: "historical", processor_fee_predicted_cents: null }
          // Neither figure known.
          : i === 2 ? { processor_fee_source: "none", processor_fee_predicted_cents: null }
          // 'actual' but the confirmation had no rate card to predict from.
          : { processor_fee_predicted_cents: null },
        ).eq("id", ids[i].id);
        expect(error).toBeNull();
      }

      expect(await f.row("paymaya")).toBeNull();
      expect(await f.row("grab_pay")).toBeNull();
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

  /**
   * THE GUARD FOR `with (security_invoker = true)`.
   *
   * Every other test in this describe reads through `svc()`, and service_role
   * carries rolbypassrls — RLS is skipped at the ROLE level, so not one of them
   * can tell whether the view respects the caller's policies. This one signs in
   * on the anon key, which is the only way to find out.
   *
   * What it is really defending against is not a wrong query, it is a SILENT
   * one. `create or replace view` without repeating the `with` clause resets
   * reloptions to empty — no error, no warning — and the view then runs as its
   * owner (`postgres`, which also bypasses RLS) while still being granted to
   * `authenticated`. That is every organization's drift sample, readable by any
   * signed-in user, introduced by an edit as innocuous as adding a column.
   *
   * So the assertions below are deliberately written as exact equalities against
   * org A's figures, with the org A + org B figures spelled out as `.not.toBe`:
   * a bypass does not make this test error, it makes it return MORE, and only an
   * exact assertion notices that.
   */
  it("computes an org admin's sample from that org's payments alone (security_invoker)", async () => {
    const stamp = Date.now();
    // A: 6 paymaya entries at ₱35.00 actual vs ₱30.00 predicted -> 175 bps, delta 3000.
    const a = await fixture(`driftrlsa-${stamp}`);
    // B: 6 at ₱40.00 vs ₱30.00 -> 200 bps, delta 6000. Different on every column,
    // so "saw B too" cannot coincide with "saw only A".
    const b = await fixture(`driftrlsb-${stamp}`);
    try {
      await a.bill(Array.from({ length: 6 }, () => ({
        method: "paymaya", amount: 200000, actual: 3500, predicted: 3000,
      })));
      await b.bill(Array.from({ length: 6 }, () => ({
        method: "paymaya", amount: 200000, actual: 4000, predicted: 3000,
      })));

      // Both orgs' rows really are in the view — otherwise "the admin sees only
      // A" would be satisfied by B's rows being ineligible for some other reason.
      const all = await a.row("paymaya");
      expect(all!.sample_size).toBeGreaterThanOrEqual(12);

      const email = `driftadmin-${stamp}@test.dev`;
      const adminId = (await a.s.auth.admin.createUser({
        email, password: "password123", email_confirm: true,
      })).data.user!.id;
      a.own(adminId);
      const grant = await a.s.from("user_roles").insert({
        user_id: adminId, role: "admin", org_id: a.org.id,
      });
      expect(grant.error).toBeNull();
      const asAdmin = await signedInAs(email);

      const mine = await a.row("paymaya", asAdmin);
      expect(mine).not.toBeNull();
      // Org A's six, and nothing else. 12 / 9000 / 188 are what a bypassed RLS
      // returns here, which is why they are named.
      expect(mine!.sample_size).toBe(6);
      expect(mine!.sample_size).not.toBe(12);
      expect(mine!.delta_cents).toBe(3000);
      expect(mine!.delta_cents).not.toBe(9000);
      expect(mine!.median_implied_bps).toBe(175);
      expect(mine!.median_implied_bps).not.toBe(188);
      expect(mine!.card_bps).toBe(150);
      expect(mine!.disagreeing).toBe(6);
      expect(mine!.drifting).toBe(true);

      // And a signed-in user with no role and no payments of their own sees no
      // sample at all — the view has no rows of its own to leak.
      const outsiderEmail = `driftoutsider-${stamp}@test.dev`;
      const outsiderId = (await a.s.auth.admin.createUser({
        email: outsiderEmail, password: "password123", email_confirm: true,
      })).data.user!.id;
      a.own(outsiderId);
      const asOutsider = await signedInAs(outsiderEmail);
      expect(await a.row("paymaya", asOutsider)).toBeNull();
    } finally {
      await b.cleanup();
      await a.cleanup();
    }
  });
});
