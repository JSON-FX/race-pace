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
async function fixture(tag: string) {
  const s = svc();
  const uid = await makeUserId(`txn_${tag}_${Date.now()}@test.dev`);
  const org = (await s.from("organizations").insert({ name: "Txn Org", slug: `txn-${tag}-${Date.now()}` }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "Txn Race", status: "open" }).select().single()).data!;
  const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
  const reg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid, total_amount: 100000, status: "pending" }).select().single()).data!;
  await s.from("payments").insert({ org_id: org.id, registration_id: reg.id, amount: 100000, status: "pending", provider: "fake" });
  return { s, uid, org, ev, cat, reg };
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

    await cleanup(s, org.id, reg.id, uid);
  });

  it("returns not_found for an unknown registration and writes nothing", async () => {
    const s = svc();
    const r = await s.rpc("confirm_payment_tx", { p_registration_id: "00000000-0000-0000-0000-0000000000ff", p_method: "x", p_fee: 0, p_net: 0, p_token: "t", p_raw: {} });
    expect(r.data).toBe("not_found");
  });

  it("refuses to re-confirm a refunded registration (replay-safe) and writes nothing", async () => {
    const { s, uid, org, cat, reg } = await fixture("replay");
    await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
    await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} });
    const slotAfterRefund = (await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken;
    // a replayed payment.paid must NOT re-confirm or re-increment
    const r = await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
    expect(r.data).toBe("not_pending");
    expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("refunded");
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(slotAfterRefund);
    await cleanup(s, org.id, reg.id, uid);
  });
});

describe("refund_registration_tx", () => {
  it("atomically refunds a paid reg, releases the slot, records provider_refund, idempotent", async () => {
    const { s, uid, org, cat, reg } = await fixture("refund");
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

    await cleanup(s, org.id, reg.id, uid);
  });

  it("refuses a non-paid registration with not_paid and writes nothing", async () => {
    const { s, uid, org, cat, reg } = await fixture("guard");
    // reg is still pending (never confirmed)
    const r = await s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} });
    expect(r.data).toBe("not_paid");
    expect((await s.from("registrations").select("status").eq("id", reg.id).single()).data!.status).toBe("pending");
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0);
    await cleanup(s, org.id, reg.id, uid);
  });

  it("releases the slot exactly once under concurrent refunds", async () => {
    const { s, uid, org, cat, reg } = await fixture("race");
    await s.rpc("confirm_payment_tx", { p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000, p_token: "tok.sig", p_raw: {} });
    const results = await Promise.all([
      s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} }),
      s.rpc("refund_registration_tx", { p_registration_id: reg.id, p_refunded_by: uid, p_note: null, p_provider_refund: {} }),
    ]);
    const outcomes = results.map((r) => r.data).sort();
    expect(outcomes).toEqual(["already", "refunded"]); // exactly one winner
    expect((await s.from("categories").select("slots_taken").eq("id", cat.id).single()).data!.slots_taken).toBe(0); // released once
    await cleanup(s, org.id, reg.id, uid);
  });
});
