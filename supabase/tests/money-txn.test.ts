import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function makeUserId(email: string) {
  const c = await svc().auth.admin.createUser({ email, password: "password123", email_confirm: true });
  return c.data.user!.id;
}

// Fresh org/event/category/pending-registration+payment, isolated from seed data.
// Exception-safe: if an insert partway through fails, whatever this function already
// created is torn down here before rethrowing — the caller's try/finally only reaches
// cleanup() when fixture() itself returns successfully.
async function fixture(tag: string) {
  const s = svc();
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    const uid = await makeUserId(`txn_${tag}_${Date.now()}@test.dev`);
    cleanups.push(() => s.auth.admin.deleteUser(uid));
    const org = (await s.from("organizations").insert({ name: "Txn Org", slug: `txn-${tag}-${Date.now()}` }).select().single()).data!;
    cleanups.push(() => s.from("organizations").delete().eq("id", org.id));
    // status doesn't matter — these RPCs are called directly, never through an anon read.
    const ev = (await s.from("events").insert({ org_id: org.id, name: "Txn Race", status: "draft" }).select().single()).data!;
    const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
    const reg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid, total_amount: 100000, status: "pending" }).select().single()).data!;
    await s.from("payments").insert({ org_id: org.id, registration_id: reg.id, amount: 100000, status: "pending", provider: "fake" });
    return { s, uid, org, ev, cat, reg };
  } catch (err) {
    for (const fn of cleanups.reverse()) await fn();
    throw err;
  }
}
async function cleanup(s: ReturnType<typeof svc>, orgId: string, regId: string, uid: string) {
  await s.from("payments").delete().eq("registration_id", regId);
  await s.from("registrations").delete().eq("id", regId);
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

describe("confirm_payment_tx", () => {
  it("atomically sets paid + ticket + fee/net + slot, and is idempotent", async () => {
    const { s, uid, org, cat, reg } = await fixture("confirm");
    try {
      const r1 = await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: { source: "test" } });
      expect(r1.data).toBe("paid");

      const regRow = (await s.from("registrations").select("status,ticket_token").eq("id", reg.id).single()).data!;
      const payRow = (await s.from("payments").select("status,method,platform_fee,net_to_org").eq("registration_id", reg.id).single()).data!;
      const catRow = (await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!;
      expect(regRow.status).toBe("paid");
      expect(regRow.ticket_token).toBe("tok.sig");
      expect(payRow).toMatchObject({ status: "paid", method: "gcash", platform_fee: 10000, net_to_org: 90000 });
      expect(catRow.slots_taken).toBe(1);

      // idempotent: second call is a no-op, slot NOT incremented again
      const r2 = await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
      expect(r2.data).toBe("already");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });

  it("returns not_found for an unknown registration and writes nothing", async () => {
    const s = svc();
    const r = await s.rpc("confirm_payment_tx", { p_registration_id: "00000000-0000-0000-0000-0000000000ff", p_method: "x", p_fee: 0, p_net: 0, p_token: "t", p_raw: {} });
    expect(r.data).toBe("not_found");
  });

  it("refuses to re-confirm a refunded registration (replay-safe) and writes nothing", async () => {
    const { s, uid, org, cat, reg } = await fixture("replay");
    try {
      await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
      await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} });
      const slotAfterRefund = (await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken;
      // a replayed payment.paid must NOT re-confirm or re-increment
      const r = await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
      expect(r.data).toBe("not_pending");
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("refunded");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(slotAfterRefund);
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });
});

describe("refund_registration_tx", () => {
  it("atomically refunds a paid reg, releases the slot, records provider_refund, idempotent", async () => {
    const { s, uid, org, cat, reg } = await fixture("refund");
    try {
      await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);

      const r1 = await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: "test note", p_provider_refund: { id: "ref_x", status: "succeeded" } });
      expect(r1.data).toBe("refunded");
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("refunded");
      const payRow = (await s.from("payments").select("status,raw").eq("registration_id", reg.id).single()).data!;
      expect(payRow.status).toBe("refunded");
      expect((payRow.raw as any).refunded_by).toBe(uid);
      expect((payRow.raw as any).provider_refund.id).toBe("ref_x");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);

      // idempotent: second call -> already, slot NOT decremented below baseline
      const r2 = await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} });
      expect(r2.data).toBe("already");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });

  it("refuses a non-paid registration with not_paid and writes nothing", async () => {
    const { s, uid, org, cat, reg } = await fixture("guard");
    try {
      // reg is still pending (never confirmed)
      const r = await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} });
      expect(r.data).toBe("not_paid");
      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("pending");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });

  it("releases the slot exactly once under concurrent refunds", async () => {
    const { s, uid, org, cat, reg } = await fixture("race");
    try {
      await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
      const results = await Promise.all([
        s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} }),
        s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} }),
      ]);
      const outcomes = results.map((r) => r.data).sort();
      expect(outcomes).toEqual(["already", "refunded"]); // exactly one winner
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0); // released once
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });
});

describe("money RPCs write to registration_audit", () => {
  it("records a paid row on confirm and a refunded row on refund", async () => {
    const { s, uid, org, reg } = await fixture("audit");
    try {
      await s.rpc("confirm_payment_tx", {
        p_registration_id: reg.id, p_method: "gcash", p_fee: 10000,
        p_net: 90000, p_token: "tok.sig", p_raw: {},
      });

      const afterPaid = (await s.from("registration_audit").select("*").eq("registration_id", reg.id)).data!;
      expect(afterPaid.length).toBe(1);
      expect(afterPaid[0].action).toBe("paid");
      expect(afterPaid[0].actor_role).toBe("system");
      // org_id/event_id must come from the row the function itself locked, not just any FK
      // that happens to satisfy the constraint — an edit that sourced these from the wrong
      // place would still pass a bare not-null/FK check.
      expect(afterPaid[0].org_id).toBe(org.id);
      expect(afterPaid[0].event_id).toBe(reg.event_id);

      // Seven arguments — the four-arg form in older migrations was superseded by
      // 20260807090400_refund_policy_tx.sql. Confirm the live parameter names and order with
      // pg_get_function_identity_arguments before writing this call; a wrong arg list fails
      // as "function does not exist", which reads like a missing migration.
      await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: "duplicate entry",
        p_provider_refund: {}, p_refunded_amount: 100000, p_retained_fee: 0, p_retained_net: 0,
      });

      const afterRefund = (await s.from("registration_audit").select("*").eq("registration_id", reg.id).order("created_at", { ascending: true })).data!;
      expect(afterRefund.length).toBe(2);
      expect(afterRefund[1].action).toBe("refunded");
      expect(afterRefund[1].actor_id).toBe(uid);
      expect(afterRefund[1].actor_role).toBe("admin");
      expect(afterRefund[1].detail.note).toBe("duplicate entry");
      expect(afterRefund[1].org_id).toBe(org.id);
      expect(afterRefund[1].event_id).toBe(reg.event_id);
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });

  it("does not write an audit row when confirm is a replayed no-op", async () => {
    const { s, uid, org, reg } = await fixture("auditreplay");
    try {
      const args = { p_registration_id: reg.id, p_method: "gcash", p_fee: 0, p_net: 0, p_token: "t", p_raw: {} };
      await s.rpc("confirm_payment_tx", args);
      await s.rpc("confirm_payment_tx", args);
      const rows = (await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!;
      expect(rows.length).toBe(1);
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });

  it("records exactly one partially_refunded row on a partial refund", async () => {
    const { s, uid, org, reg } = await fixture("partialaudit");
    try {
      await s.rpc("confirm_payment_tx", {
        p_registration_id: reg.id, p_method: "gcash", p_fee: 10000,
        p_net: 90000, p_token: "tok.sig", p_raw: {},
      });

      // Partial: p_refunded_amount (40000) < the payment's amount (100000), so
      // refund_registration_tx takes the partially_refunded branch, not the full-refund one.
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: "goodwill partial",
        p_provider_refund: { id: "ref_partial", status: "succeeded" },
        p_refunded_amount: 40000, p_retained_fee: 5000, p_retained_net: 55000,
      });
      expect(r.data).toBe("partially_refunded");

      const rows = (await s.from("registration_audit").select("*").eq("registration_id", reg.id).order("created_at", { ascending: true })).data!;
      // paid + partially_refunded, no third row
      expect(rows.length).toBe(2);
      const partialRow = rows[1];
      expect(partialRow.action).toBe("partially_refunded");
      expect(partialRow.actor_id).toBe(uid);
      expect(partialRow.actor_role).toBe("admin");
      expect(partialRow.org_id).toBe(org.id);
      expect(partialRow.event_id).toBe(reg.event_id);
      expect(partialRow.detail.amount).toBe(40000);
      expect(partialRow.detail.note).toBe("goodwill partial");
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });
});

describe("refund_registration_tx tolerates a deleted actor", () => {
  // registration_audit.actor_id used to carry `references auth.users(id) on delete set null`
  // (registration_audit_actor_id_fkey, 20260808100100_registration_audit.sql). That clause only
  // protects a row that already exists — it cannot retroactively null out an INSERT that names
  // a user who was deleted before the insert runs, which is exactly what
  // supabase/functions/payments-webhook/index.ts does: p_refunded_by is a uuid parked in
  // payments.raw.refund.refunded_by at refund-REQUEST time (possibly days earlier), replayed
  // here when PayMongo's async refund.updated webhook settles. If that admin has since been
  // offboarded, the registration_audit insert added by 20260808140000_money_txn_audit.sql /
  // 20260808150000_partial_refund_audit.sql raised 23503 and aborted the whole
  // refund_registration_tx transaction — the webhook returned 500, PayMongo retried forever, and
  // the registration was left 'paid' (slot still taken) despite the provider having already
  // moved the money. 20260808160000_drop_registration_audit_actor_fk.sql drops the FK so an
  // audit-log insert can never abort the transaction it's recording.
  //
  // A random uuid is a closer match to the real bug than reusing then deleting a user: the
  // failure isn't "the user existed and was later removed from under a live reference" (which
  // the old `on delete set null` clause DID handle, for rows that predate the deletion) — it's
  // "the uuid never has a corresponding row at INSERT time", which is what an INSERT naming an
  // already-deleted user actually looks like from the database's point of view.
  it("still refunds and still writes its audit row when p_refunded_by names a uuid that does not exist in auth.users", async () => {
    const { s, uid, org, cat, reg } = await fixture("ghostactor");
    try {
      await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(1);

      const ghostActorId = crypto.randomUUID(); // stands in for "the admin who requested this refund, since offboarded"
      const r = await s.rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: ghostActorId, p_note: "actor offboarded before webhook settled",
        p_provider_refund: { id: "ref_ghost", status: "succeeded" },
      });
      // Against the pre-fix schema this is where the test fails: the RPC call returns a
      // PostgrestError (23503 foreign_key_violation) instead of the string 'refunded', because
      // the registration_audit insert inside the transaction aborts it.
      expect(r.error).toBeNull();
      expect(r.data).toBe("refunded");

      expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("refunded");
      expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
      const payRow = (await s.from("payments").select("status").eq("registration_id", reg.id).single()).data!;
      expect(payRow.status).toBe("refunded");

      const rows = (await s.from("registration_audit").select("*").eq("registration_id", reg.id).order("created_at", { ascending: true })).data!;
      expect(rows.length).toBe(2); // paid, then refunded
      const refundedRow = rows[1];
      expect(refundedRow.action).toBe("refunded");
      expect(refundedRow.actor_id).toBe(ghostActorId); // the FK is gone; the informational value is still recorded
      expect(refundedRow.actor_role).toBe("admin");
    } finally {
      await cleanup(s, org.id, reg.id, uid);
    }
  });
});
