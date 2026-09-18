import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
import { seededIds } from "../../test/seeded";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) => createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });
async function makeUser(email: string) {
  const svc = service();
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}
// Resolved from the seed rather than restated — see test/seeded.ts. This suite
// deliberately takes the SECOND seeded event so its aggregate assertions are not
// polluted by rows other suites write against the first one; CATEGORY_A2 must
// pair with EVENT_A2 or the registration insert breaks the event/category link.
let RWP: string, EVT: string, C4: string, WAIVER: string;
beforeAll(async () => {
  ({ ORG_A: RWP, EVENT_A2: EVT, CATEGORY_A2: C4, WAIVER_A2: WAIVER } = await seededIds());
});
// NOTE: existing tests in this directory (admin-registrations.test.ts,
// admin-list-views.test.ts) reference event e1 / category c4, but the
// current supabase/seed.sql only seeds events e2 and e3 — those two files
// already fail against a freshly-reset local DB (confirmed: FK violation
// inserting a registration with event_id=e1, pre-existing, unrelated to
// this change). Using the event/category IDs that actually exist in
// seed.sql here rather than perpetuating that mismatch.

// Mirrors apps/web/lib/queries/events.ts#toIlikePattern exactly. Duplicated here
// (rather than imported) because that module also exports functions that pull in
// `@/lib/supabase/server` -> `next/headers`, which only resolves inside a Next.js
// runtime, not this plain-node DB test. If the algorithm in events.ts ever changes,
// this copy — and the assertions below that depend on it — must change with it.
function toIlikePattern(rawTerm: string): string {
  const escaped = rawTerm
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\*/g, "%");
  return `%${escaped}%`;
}

describe("admin_registration_aggregates — '*' in the search box (IMPORTANT 1)", () => {
  it("a raw '*' desyncs the RPC from the list query unless normalized first; toIlikePattern fixes both", async () => {
    const svc = service();
    const admin = await makeUser(`kpi_star_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const runner = await makeUser(`kpi_star_run_${Date.now()}@test.dev`);
    await svc.from("profiles").insert({ id: runner.id, full_name: "Dahilayan Sky Runner" });
    const reg = await svc.from("registrations")
      .insert({ org_id: RWP, event_id: EVT, category_id: C4, user_id: runner.id, status: "paid", total_amount: 100000, waiver_version_id: WAIVER })
      .select().single();
    expect(reg.error).toBeNull();

    const client = authed(admin.token);
    const rawTerm = "Dahi*Sky"; // '*' meant as a wildcard, same shape as the reviewer's repro

    // 1. The RPC treats a raw, un-normalized '*' LITERALLY (plain SQL ilike, no
    //    PostgREST rewrite) — it does not match "Dahilayan Sky Runner".
    const rpcRaw = await client.rpc("admin_registration_aggregates", {
      p_event_id: EVT,
      p_q: `%${rawTerm}%`, // what the RPC received before this fix: naive '%'+term+'%'
    });
    expect(rpcRaw.error).toBeNull();
    expect(rpcRaw.data![0].total).toBe(0);

    // 2. PostgREST's own `.ilike()` REWRITES that same raw '*' to '%' — it DOES
    //    match. This is the asymmetry: same term, same row, two different
    //    verdicts depending on transport — exactly how a KPI card can read 0
    //    while the table below it lists a match.
    const listRaw = await client.from("admin_registrations_v").select("id").eq("event_id", EVT).ilike("full_name", `%${rawTerm}%`);
    expect(listRaw.error).toBeNull();
    expect((listRaw.data ?? []).map((r) => r.id)).toContain(reg.data!.id);

    // 3. Normalize ONCE with toIlikePattern before either path (the actual fix):
    //    both now agree, and both find the row.
    const pattern = toIlikePattern(rawTerm);
    expect(pattern).toBe("%Dahi%Sky%"); // '*' -> '%', no other char touched

    const rpcFixed = await client.rpc("admin_registration_aggregates", { p_event_id: EVT, p_q: pattern });
    expect(rpcFixed.error).toBeNull();
    expect(rpcFixed.data![0].total).toBeGreaterThanOrEqual(1);

    const listFixed = await client.from("admin_registrations_v").select("id").eq("event_id", EVT).ilike("full_name", pattern);
    expect(listFixed.error).toBeNull();
    expect((listFixed.data ?? []).map((r) => r.id)).toContain(reg.data!.id);
  });

  it("escapes a literal '%' or '_' typed by the user instead of letting it act as a wildcard", () => {
    // A user searching for a literal percent sign (rare, but possible in a bib
    // label or free-text field) must not have it silently match everything.
    expect(toIlikePattern("50%")).toBe("%50\\%%");
    expect(toIlikePattern("D_1042")).toBe("%D\\_1042%");
  });
});

describe("admin_payment_aggregates — paid-only gross/fee/net (IMPORTANT 2)", () => {
  it("excludes pending and refunded rows from gross/fee/net, but the refunded row still counts toward Refunded", async () => {
    const svc = service();
    const admin = await makeUser(`kpi_paid_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    // Unique per run, and stamped into the runners' names so the aggregate below
    // can be scoped to exactly the three rows this test created. See the RPC call.
    const stamp = `kpirun${Date.now()}`;

    async function makeRegAndPayment(userSuffix: string, status: "paid" | "pending" | "refunded", amount: number, fee: number, net: number) {
      const runner = await makeUser(`kpi_paid_${userSuffix}_${Date.now()}@test.dev`);
      await svc.from("profiles").insert({ id: runner.id, full_name: `Payer ${userSuffix} ${stamp}` });
      const reg = await svc.from("registrations")
        .insert({ org_id: RWP, event_id: EVT, category_id: C4, user_id: runner.id, status: "paid", total_amount: amount, waiver_version_id: WAIVER })
        .select().single();
      const pay = await svc.from("payments")
        .insert({
          org_id: RWP, registration_id: reg.data!.id, amount, platform_fee: fee, net_to_org: net,
          method: "gcash", status,
          // A refunded row's refunded_amount IS its net_to_org: under
          // 20260811094000_refund_net_to_org.sql a refund returns what the
          // organizer would have been paid, not the whole charge, and that is what
          // refund_registration_tx writes here. Seeded rather than driven through
          // the RPC only because that call also decrements the SEEDED category's
          // slots_taken, which this suite has no business mutating.
          ...(status === "refunded" ? { refunded_amount: net } : {}),
        })
        .select().single();
      return { reg: reg.data!, pay: pay.data! };
    }

    const paidRow = await makeRegAndPayment("paid", "paid", 285000, 14250, 270750);
    // Pending: an abandoned/unfinished checkout — must not count as gross revenue.
    await makeRegAndPayment("pending", "pending", 195000, 9750, 185250);
    // Refunded: refund_registration_tx flips status but leaves amount/fee/net
    // untouched (20260811094000_refund_net_to_org.sql keeps that guarantee, and
    // payout_open_statement depends on it to size a clawback) — a naive
    // sum-every-status would count this money as still "net to org".
    const refundedRow = await makeRegAndPayment("refunded", "refunded", 120000, 6000, 114000);

    const client = authed(admin.token);
    // SCOPED TO THIS TEST'S OWN ROWS, by event AND by a per-run name stamp.
    //
    // The org id alone was not enough, and the header's claim that EVENT_A2
    // isolates this suite is false against the current seed: test/seeded.ts
    // resolves EVENT_A2 as "the first open event with categories and no
    // registrations", and on a fresh reset NONE of ORG_A's six open events has
    // any — so EVENT_A2 and EVENT_A are the same event, the one
    // admin-list-views.test.ts and admin-registrations.test.ts each insert a
    // ₱1,000 paid payment into. Vitest runs files in parallel and both delete
    // their rows afterwards, so whether they were counted here came down to
    // timing: observed as "expected 435000 to be 285000" and
    // "expected 385000 to be 285000" on two runs that passed on the next, with no
    // code change between them.
    //
    // p_q is the RPC's own search filter and arrives pre-wildcarded, exactly as
    // lib/queries/events.ts#toIlikePattern sends it. Filtering on a stamp unique
    // to this run makes the totals below depend on nothing but the three rows
    // above — including rows this same file left behind on an earlier run.
    const agg = await client.rpc("admin_payment_aggregates", {
      p_org_id: RWP, p_event_id: EVT, p_q: `%${stamp}%`,
    });
    expect(agg.error).toBeNull();
    const row = agg.data![0];

    // Only the paid row's own figures — not paid+pending+refunded summed, and
    // NOT recomputed as amount - fee (net is a real, independently-set column).
    expect(row.gross_cents).toBe(paidRow.pay.amount);
    expect(row.fee_cents).toBe(paidRow.pay.platform_fee);
    expect(row.net_cents).toBe(paidRow.pay.net_to_org);

    // The refunded row is excluded from gross but IS counted here — Refunded is
    // the one card that's supposed to report it. At its refunded_amount, NOT its
    // amount: a refund returns net_to_org, so reading `amount` over-stated every
    // full refund by platform_fee + processor_fee_cents (₱60 on this row).
    expect(row.refunded_cents).toBe(refundedRow.pay.refunded_amount);
    expect(row.refunded_cents).toBe(114000);
    expect(refundedRow.pay.amount).toBe(120000); // the charge, deliberately NOT the answer
  });
});

describe("registration partial refunds", () => {
  it.each([100000, 106599])("includes the charged amount %i rather than base price in retained revenue", async (amount) => {
    const svc = service();
    const stamp = `partialkpi${Date.now()}`;
    const admin = await makeUser(`${stamp}_admin@test.dev`);
    const runner = await makeUser(`${stamp}_runner@test.dev`);
    let registrationId: string | undefined;
    try {
      expect((await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP })).error).toBeNull();
      expect((await svc.from("profiles").upsert({ id: runner.id, full_name: stamp })).error).toBeNull();
      const reg = await svc.from("registrations").insert({
        org_id: RWP, event_id: EVT, category_id: C4, user_id: runner.id,
        status: "paid", total_amount: 100000, waiver_version_id: WAIVER,
      }).select("id").single();
      expect(reg.error).toBeNull();
      registrationId = reg.data!.id;
      expect((await svc.from("payments").insert({
        org_id: RWP, registration_id: registrationId, amount,
        platform_fee: 3000, processor_fee_cents: 1500, net_to_org: amount - 44500,
        refunded_amount: 40000, status: "partially_refunded", method: "gcash",
      })).error).toBeNull();
      const client = authed(admin.token);
      for (const status of ["all", "partially_refunded"]) {
        const result = await client.rpc("admin_registration_aggregates", {
          p_event_id: EVT, p_status: status, p_category_id: C4, p_q: `%${stamp}%`,
        });
        expect(result.error).toBeNull();
        expect(result.data[0]).toMatchObject({
          total: 1, paid: 1, gross_cents: amount - 40000, refund_count: 1, refunded_cents: 40000,
        });
      }
      const excluded = await client.rpc("admin_registration_aggregates", {
        p_event_id: EVT, p_status: "paid", p_q: `%${stamp}%`,
      });
      expect(excluded.error).toBeNull();
      expect(excluded.data[0]).toMatchObject({ total: 0, paid: 0, gross_cents: 0, refunded_cents: 0 });
      const payment = await client.rpc("admin_payment_aggregates", {
        p_org_id: RWP, p_event_id: EVT, p_q: `%${stamp}%`,
      });
      expect(payment.error).toBeNull();
      expect(payment.data[0]).toMatchObject({ gross_cents: amount - 40000, refunded_cents: 40000 });
    } finally {
      if (registrationId) {
        await svc.from("payments").delete().eq("registration_id", registrationId);
        await svc.from("registrations").delete().eq("id", registrationId);
      }
      await svc.auth.admin.deleteUser(runner.id);
      await svc.auth.admin.deleteUser(admin.id);
    }
  });
});
