import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

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
const RWP = "00000000-0000-0000-0000-0000000000a1";
// NOTE: existing tests in this directory (admin-registrations.test.ts,
// admin-list-views.test.ts) reference event e1 / category c4, but the
// current supabase/seed.sql only seeds events e2 and e3 — those two files
// already fail against a freshly-reset local DB (confirmed: FK violation
// inserting a registration with event_id=e1, pre-existing, unrelated to
// this change). Using the event/category IDs that actually exist in
// seed.sql here rather than perpetuating that mismatch.
const EVT = "00000000-0000-0000-0000-0000000000e3";
const C4 = "00000000-0000-0000-0000-0000000000c4";

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
      .insert({ org_id: RWP, event_id: EVT, category_id: C4, user_id: runner.id, status: "paid", total_amount: 100000 })
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

    async function makeRegAndPayment(userSuffix: string, status: "paid" | "pending" | "refunded", amount: number, fee: number, net: number) {
      const runner = await makeUser(`kpi_paid_${userSuffix}_${Date.now()}@test.dev`);
      await svc.from("profiles").insert({ id: runner.id, full_name: `Payer ${userSuffix}` });
      const reg = await svc.from("registrations")
        .insert({ org_id: RWP, event_id: EVT, category_id: C4, user_id: runner.id, status: "paid", total_amount: amount })
        .select().single();
      const pay = await svc.from("payments")
        .insert({ org_id: RWP, registration_id: reg.data!.id, amount, platform_fee: fee, net_to_org: net, method: "gcash", status })
        .select().single();
      return { reg: reg.data!, pay: pay.data! };
    }

    const paidRow = await makeRegAndPayment("paid", "paid", 285000, 14250, 270750);
    // Pending: an abandoned/unfinished checkout — must not count as gross revenue.
    await makeRegAndPayment("pending", "pending", 195000, 9750, 185250);
    // Refunded: refund_registration_tx flips status but leaves amount/fee/net
    // untouched (see supabase/migrations/20260723100000_money_txn_rpcs.sql) — a
    // naive sum-every-status would count this money as still "net to org".
    const refundedRow = await makeRegAndPayment("refunded", "refunded", 120000, 6000, 114000);

    const client = authed(admin.token);
    const agg = await client.rpc("admin_payment_aggregates", { p_org_id: RWP });
    expect(agg.error).toBeNull();
    const row = agg.data![0];

    // Only the paid row's own figures — not paid+pending+refunded summed, and
    // NOT recomputed as amount - fee (net is a real, independently-set column).
    expect(row.gross_cents).toBe(paidRow.pay.amount);
    expect(row.fee_cents).toBe(paidRow.pay.platform_fee);
    expect(row.net_cents).toBe(paidRow.pay.net_to_org);

    // The refunded row's amount is excluded from gross but IS counted here —
    // Refunded is the one card that's supposed to report it.
    expect(row.refunded_cents).toBe(refundedRow.pay.amount);
  });
});
