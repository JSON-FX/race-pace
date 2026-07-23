import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
import { createHmac } from "node:crypto";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

const WEBHOOK_SECRET = "whsec_test_localdev"; // must match supabase/functions/.env
function signHeader(rawBody: string): string {
  const t = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},te=${sig}`;
}
function postWebhook(payload: unknown, header?: string) {
  const raw = JSON.stringify(payload);
  return fetch(`${FN}/payments-webhook`, { method: "POST", headers: { "content-type": "application/json", "Paymongo-Signature": header ?? signHeader(raw) }, body: raw });
}
const paidEvent = (registrationId: string) => ({ data: { attributes: { type: "checkout_session.payment.paid", data: { attributes: { metadata: { registration_id: registrationId }, payments: [{ attributes: { source: { type: "gcash" } } }] } } } } });
const refundEvent = (refundId: string, status: string) => ({ data: { attributes: { type: "refund.updated", data: { id: refundId, attributes: { status } } } } });

describe("organizations RLS", () => {
  it("anon can read an active org but not an inactive one", async () => {
    const svc = service();
    const active = await svc.from("organizations").insert({ name: "Active Org", slug: "active-org" }).select().single();
    const inactive = await svc.from("organizations").insert({ name: "Hidden Org", slug: "hidden-org", is_active: false }).select().single();
    expect(active.error).toBeNull();

    const { data } = await anon().from("organizations").select("slug");
    const slugs = (data ?? []).map((o) => o.slug);
    expect(slugs).toContain("active-org");
    expect(slugs).not.toContain("hidden-org");

    await svc.from("organizations").delete().in("id", [active.data!.id, inactive.data!.id]);
  });
});

describe("events catalog RLS", () => {
  it("hides draft events from anon, shows open ones", async () => {
    const svc = service();
    const org = await svc.from("organizations").insert({ name: "Cat Org", slug: "cat-org" }).select().single();
    const draft = await svc.from("events").insert({ org_id: org.data!.id, name: "Draft Race", status: "draft" }).select().single();
    const open = await svc.from("events").insert({ org_id: org.data!.id, name: "Open Race", status: "open" }).select().single();

    const { data } = await anon().from("events").select("name");
    const names = (data ?? []).map((e) => e.name);
    expect(names).toContain("Open Race");
    expect(names).not.toContain("Draft Race");

    await svc.from("events").delete().in("id", [draft.data!.id, open.data!.id]);
    await svc.from("organizations").delete().eq("id", org.data!.id);
  });
});

async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}

describe("registrations RLS", () => {
  it("a user reads only their own registration", async () => {
    const svc = service();
    const org = await svc.from("organizations").insert({ name: "Reg Org", slug: "reg-org" }).select().single();
    const ev = await svc.from("events").insert({ org_id: org.data!.id, name: "Reg Race", status: "open" }).select().single();
    const cat = await svc.from("categories").insert({ org_id: org.data!.id, event_id: ev.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 }).select().single();

    const alice = await makeUser(`alice_${Date.now()}@test.dev`);
    const bob = await makeUser(`bob_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({ org_id: org.data!.id, event_id: ev.data!.id, category_id: cat.data!.id, user_id: alice.id, total_amount: 100000 }).select().single();

    const asAlice = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${alice.token}` } }, auth: { persistSession: false } });
    const asBob = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${bob.token}` } }, auth: { persistSession: false } });

    const aliceView = await asAlice.from("registrations").select("id").eq("id", reg.data!.id);
    const bobView = await asBob.from("registrations").select("id").eq("id", reg.data!.id);
    expect(aliceView.data).toHaveLength(1);
    expect(bobView.data).toHaveLength(0); // RLS hides Alice's row from Bob

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(alice.id);
    await svc.auth.admin.deleteUser(bob.id);
    await svc.from("organizations").delete().eq("id", org.data!.id);
  });
});

describe("seed", () => {
  it("exposes the seeded org, event, and 4 categories to anon", async () => {
    const a = anon();
    const org = await a.from("organizations").select("slug").eq("slug", "race-pace").single();
    expect(org.data?.slug).toBe("race-pace");
    const cats = await a.from("categories").select("code").eq("event_id", "00000000-0000-0000-0000-0000000000e1");
    expect((cats.data ?? []).map((c) => c.code).sort()).toEqual(["100k", "10k", "21k", "50k"]);
  });
});

const FN = `${url}/functions/v1`;

describe("registrations-checkout", () => {
  it("validates fields, creates a pending registration, returns a checkout url", async () => {
    const user = await makeUser(`reg_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: "00000000-0000-0000-0000-0000000000e1",
        category_id: "00000000-0000-0000-0000-0000000000c3",
        addon_ids: ["00000000-0000-0000-0000-0000000000d1"],
        custom_data: { blood_type: "O", shirt_size: "M" },
        waiver_accepted: true,
        idempotency_key: `idem-${Date.now()}`,
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.registration_id).toBeTruthy();
    expect(body.checkout_url).toContain(`/fake-checkout?rid=${body.registration_id}`);

    const svc = service();
    const reg = await svc.from("registrations").select("status,total_amount").eq("id", body.registration_id).single();
    expect(reg.data?.status).toBe("pending");
    expect(reg.data?.total_amount).toBe(150000 + 60000); // 21K + singlet

    await svc.from("registrations").delete().eq("id", body.registration_id);
    await svc.auth.admin.deleteUser(user.id);
  });

  it("rejects invalid custom_data", async () => {
    const user = await makeUser(`bad_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: "00000000-0000-0000-0000-0000000000e1",
        category_id: "00000000-0000-0000-0000-0000000000c3",
        custom_data: { running_club: 12345 }, // event field `running_club` (f2) is a text field — number fails z.string()
        waiver_accepted: true,
        idempotency_key: `idem-bad-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(400);
    await service().auth.admin.deleteUser(user.id);
  });

  // Model B (spec §8): profile-key fields (blood_type, shirt_size, ...) are prefilled from the
  // runner's profile and validated client-side against canonical shared lists + passport rules,
  // not the org's per-event `options` enum. A canonical value that would fail the seeded org
  // enum (f1 blood_type options ['A','B','AB','O']; f3 shirt_size options ['S','M','L','XL'])
  // must still succeed server-side and persist as sent.
  it("accepts canonical passport values that fail the org's enum, and persists them", async () => {
    const user = await makeUser(`passport_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: "00000000-0000-0000-0000-0000000000e1",
        category_id: "00000000-0000-0000-0000-0000000000c3",
        custom_data: { blood_type: "O+", shirt_size: "XS", running_club: "Trailblazers" },
        waiver_accepted: true,
        idempotency_key: `idem-passport-${Date.now()}`,
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.registration_id).toBeTruthy();

    const svc = service();
    const reg = await svc.from("registrations").select("custom_data").eq("id", body.registration_id).single();
    expect(reg.data?.custom_data?.blood_type).toBe("O+");
    expect(reg.data?.custom_data?.shirt_size).toBe("XS");

    await svc.from("registrations").delete().eq("id", body.registration_id);
    await svc.auth.admin.deleteUser(user.id);
  });

  // Model B hardening: required profile-key fields (blood_type f1, shirt_size f3 on e1) must be
  // present + non-empty in custom_data — enforced by presence, NOT the org enum (canonical values
  // still pass). A direct/replayed API caller that omits a required passport field is rejected.
  it("rejects a registration that omits a required profile-key field", async () => {
    const user = await makeUser(`missing_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: "00000000-0000-0000-0000-0000000000e1",
        category_id: "00000000-0000-0000-0000-0000000000c3",
        custom_data: { shirt_size: "M" }, // omits required blood_type (f1)
        waiver_accepted: true,
        idempotency_key: `idem-missing-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(400);
    await service().auth.admin.deleteUser(user.id);
  });
});

describe("payment confirmation (fake) e2e", () => {
  it("checkout -> webhook -> paid + ticket + slot incremented", async () => {
    const svc = service();
    const user = await makeUser(`e2e_${Date.now()}@test.dev`);

    const before = await svc.from("categories").select("slots_taken").eq("id", "00000000-0000-0000-0000-0000000000c4").single();

    const checkout = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: "00000000-0000-0000-0000-0000000000e1",
        category_id: "00000000-0000-0000-0000-0000000000c4",
        custom_data: { blood_type: "A", shirt_size: "L" },
        waiver_accepted: true,
        idempotency_key: `idem-e2e-${Date.now()}`,
      }),
    }).then((r) => r.json());

    const hook = await postWebhook(paidEvent(checkout.registration_id));
    expect(hook.status).toBe(200);

    const reg = await svc.from("registrations").select("status,ticket_token").eq("id", checkout.registration_id).single();
    expect(reg.data?.status).toBe("paid");
    expect(reg.data?.ticket_token).toContain("."); // body.signature

    const pay = await svc.from("payments").select("status,platform_fee,net_to_org").eq("registration_id", checkout.registration_id).single();
    expect(pay.data?.status).toBe("paid");
    expect(pay.data?.platform_fee).toBe(Math.round(100000 * 0.10)); // 10K base, 10% commission
    expect(pay.data?.net_to_org).toBe(100000 - Math.round(100000 * 0.10));

    const after = await svc.from("categories").select("slots_taken").eq("id", "00000000-0000-0000-0000-0000000000c4").single();
    expect(after.data!.slots_taken).toBe(before.data!.slots_taken + 1); // relative — robust to prior runs

    // A duplicate confirmation is a no-op — slot stays at +1 (idempotent through confirm_payment_tx).
    await postWebhook(paidEvent(checkout.registration_id));
    const afterDup = await svc.from("categories").select("slots_taken").eq("id", "00000000-0000-0000-0000-0000000000c4").single();
    expect(afterDup.data!.slots_taken).toBe(before.data!.slots_taken + 1);

    await svc.from("registrations").delete().eq("id", checkout.registration_id);
    await svc.auth.admin.deleteUser(user.id);
  });
});

describe("confirm replay-safety (refunded)", () => {
  it("a replayed confirmation on a refunded registration is a no-op — no re-pay, no re-increment", async () => {
    const svc = service();
    const runner = await makeUser(`creplay_${Date.now()}@test.dev`);
    const rid = await paidRegistration(runner.token); // paid
    // move it to refunded (mirrors a refund: status flip + slot release)
    await svc.from("registrations").update({ status: "refunded" }).eq("id", rid);
    await svc.from("payments").update({ status: "refunded" }).eq("registration_id", rid);
    await svc.rpc("decrement_slot", { p_category_id: C4_RF });
    const slotAfterRefund = (await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken;
    // replay a payment via the fake-checkout page (calls confirmPayment) — must NOT re-confirm
    const res = await fetch(`${FN}/fake-checkout?rid=${rid}&return=${encodeURIComponent("racepace://cb")}&action=pay`);
    expect(res.status).toBe(200);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data!.status).toBe("refunded");
    expect((await svc.from("payments").select("status").eq("registration_id", rid).single()).data!.status).toBe("refunded");
    expect((await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken).toBe(slotAfterRefund);
    await svc.from("registrations").delete().eq("id", rid);
    await svc.auth.admin.deleteUser(runner.id);
  });
});

describe("fake-checkout sandbox page", () => {
  it("action=pay confirms the registration and returns a bounce page", async () => {
    const svc = service();
    const user = await makeUser(`fc_${Date.now()}@test.dev`);
    const checkout = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: "00000000-0000-0000-0000-0000000000e1",
        category_id: "00000000-0000-0000-0000-0000000000c4",
        custom_data: { blood_type: "A", shirt_size: "L" },
        waiver_accepted: true,
        idempotency_key: `idem-fc-${Date.now()}`,
      }),
    }).then((r) => r.json());

    const ret = "racepace://pay-callback";
    const res = await fetch(
      `${FN}/fake-checkout?rid=${checkout.registration_id}&return=${encodeURIComponent(ret)}&action=pay`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Payment complete");

    const reg = await svc.from("registrations").select("status,ticket_token").eq("id", checkout.registration_id).single();
    expect(reg.data?.status).toBe("paid");
    expect(reg.data?.ticket_token).toContain(".");

    await svc.from("registrations").delete().eq("id", checkout.registration_id);
    await svc.auth.admin.deleteUser(user.id);
  });
});

describe("psgc reference data", () => {
  it("anon can read psgc tables and a known city resolves its parents", async () => {
    const a = anon();
    const regions = await a.from("psgc_regions").select("code", { count: "exact", head: true });
    expect(regions.count).toBeGreaterThan(0);
    const city = await a.from("psgc_cities").select("code,name,province_code,region_code").eq("code", "012801000").maybeSingle();
    expect(city.data?.region_code).toBe("010000000");         // Adams → Ilocos Region
    const prov = await a.from("psgc_provinces").select("region_code").eq("code", city.data!.province_code!).maybeSingle();
    expect(prov.data?.region_code).toBe("010000000");
  });
});

const RWP_RF = "00000000-0000-0000-0000-0000000000a1";
const APO_RF = "00000000-0000-0000-0000-0000000000a2";
const E1_RF = "00000000-0000-0000-0000-0000000000e1";
const C4_RF = "00000000-0000-0000-0000-0000000000c4";

async function paidRegistration(runnerToken: string) {
  const checkout = await fetch(`${FN}/registrations-checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${runnerToken}` },
    body: JSON.stringify({ event_id: E1_RF, category_id: C4_RF, custom_data: { blood_type: "A", shirt_size: "L" }, waiver_accepted: true, idempotency_key: `idem-rf-${Date.now()}` }),
  }).then((r) => r.json());
  await fetch(`${FN}/fake-checkout?rid=${checkout.registration_id}&return=${encodeURIComponent("racepace://cb")}&action=pay`);
  return checkout.registration_id as string;
}
const refundCall = (token: string, rid: string) => fetch(`${FN}/admin-refund`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ registration_id: rid }) });

describe("admin-refund", () => {
  it("org admin refunds a paid registration -> refunded + slot released; non-admin & other-org blocked; idempotent", async () => {
    const svc = service();
    const admin = await makeUser(`rf_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP_RF });
    const other = await makeUser(`rf_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO_RF });
    const runner = await makeUser(`rf_run_${Date.now()}@test.dev`);

    const before = await svc.from("categories").select("slots_taken").eq("id", C4_RF).single();
    const rid = await paidRegistration(runner.token);
    const paid = await svc.from("categories").select("slots_taken").eq("id", C4_RF).single();
    expect(paid.data!.slots_taken).toBe(before.data!.slots_taken + 1);

    // runner (no role) and other-org admin are both forbidden
    expect((await refundCall(runner.token, rid)).status).toBe(403);
    expect((await refundCall(other.token, rid)).status).toBe(403);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data?.status).toBe("paid");

    // org admin refund => 200, refunded, slot released back to baseline
    const ok = await refundCall(admin.token, rid);
    expect(ok.status).toBe(200);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data?.status).toBe("refunded");
    expect((await svc.from("payments").select("status").eq("registration_id", rid).single()).data?.status).toBe("refunded");
    // refund metadata recorded in payments.raw, and the ticket left intact
    const paidPay = await svc.from("payments").select("raw").eq("registration_id", rid).single();
    expect((paidPay.data?.raw as Record<string, unknown>)?.refunded_by).toBe(admin.id);
    // A1: the provider refund result is recorded under payments.raw.provider_refund
    expect((paidPay.data?.raw as Record<string, unknown>)?.provider_refund).toBeTruthy();
    const paidReg = await svc.from("registrations").select("ticket_token").eq("id", rid).single();
    expect(paidReg.data?.ticket_token).toBeTruthy();
    expect((await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken).toBe(before.data!.slots_taken);

    // idempotent: a second refund is a no-op, no further decrement
    const again = await refundCall(admin.token, rid);
    const againBody = await again.json();
    expect(again.status).toBe(200);
    expect(againBody.already).toBe(true);
    expect((await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken).toBe(before.data!.slots_taken);

    await svc.from("registrations").delete().eq("id", rid);
    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    for (const u of [admin, other, runner]) await svc.auth.admin.deleteUser(u.id);
  });

  it("refuses to refund a pending (not paid) registration with 409", async () => {
    const svc = service();
    const admin = await makeUser(`rf_pend_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP_RF });
    const runner = await makeUser(`rf_prun_${Date.now()}@test.dev`);
    // checkout only (no webhook) => pending
    const checkout = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${runner.token}` },
      body: JSON.stringify({ event_id: E1_RF, category_id: C4_RF, custom_data: { blood_type: "A", shirt_size: "L" }, waiver_accepted: true, idempotency_key: `idem-pend-${Date.now()}` }),
    }).then((r) => r.json());
    expect((await refundCall(admin.token, checkout.registration_id)).status).toBe(409);

    await svc.from("registrations").delete().eq("id", checkout.registration_id);
    await svc.from("user_roles").delete().eq("user_id", admin.id);
    for (const u of [admin, runner]) await svc.auth.admin.deleteUser(u.id);
  });

  it("does not issue a second provider refund while one is parked pending", async () => {
    const svc = service();
    const admin = await makeUser(`rf_reentry_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP_RF });
    const runner = await makeUser(`rf_reentry_run_${Date.now()}@test.dev`);
    const rid = await paidRegistration(runner.token);
    const pay = (await svc.from("payments").select("raw").eq("registration_id", rid).single()).data!;
    await svc.from("payments").update({ raw: { ...(pay.raw ?? {}), refund: { status: "pending", id: "ref_pending_x" } } }).eq("registration_id", rid);
    const res = await refundCall(admin.token, rid);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pending).toBe(true);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data!.status).toBe("paid"); // not double-refunded
    await svc.from("registrations").delete().eq("id", rid);
    await svc.from("user_roles").delete().eq("user_id", admin.id);
    for (const u of [admin, runner]) await svc.auth.admin.deleteUser(u.id);
  });
});

describe("payments-webhook signed", () => {
  it("rejects a bad signature with 401", async () => {
    const res = await postWebhook(paidEvent("00000000-0000-0000-0000-0000000000ff"), "t=123,te=deadbeef");
    expect(res.status).toBe(401);
  });

  it("rejects a fresh timestamp with a wrong signature (HMAC path) with 401", async () => {
    const t = Math.floor(Date.now() / 1000).toString();
    const res = await postWebhook(paidEvent("00000000-0000-0000-0000-0000000000ff"), `t=${t},te=deadbeef`);
    expect(res.status).toBe(401);
  });

  it("ignores an unknown event type with 200", async () => {
    const res = await postWebhook({ data: { attributes: { type: "payment.failed", data: {} } } });
    expect(res.status).toBe(200);
  });

  it("reconciles refund.updated=succeeded on a pending refund -> refunded + slot released", async () => {
    const svc = service();
    const runner = await makeUser(`wh_rf_${Date.now()}@test.dev`);
    const rid = await paidRegistration(runner.token);
    const before = (await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken;

    // simulate a parked (pending) refund like refund.ts writes
    const refId = `ref_test_${Date.now()}`;
    const pay = (await svc.from("payments").select("raw").eq("registration_id", rid).single()).data!;
    await svc.from("payments").update({ raw: { ...(pay.raw ?? {}), refund: { status: "pending", id: refId, refunded_by: runner.id, note: null } } }).eq("registration_id", rid);

    const res = await postWebhook(refundEvent(refId, "succeeded"));
    expect(res.status).toBe(200);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data!.status).toBe("refunded");
    expect((await svc.from("payments").select("status").eq("registration_id", rid).single()).data!.status).toBe("refunded");
    expect((await svc.from("categories").select("slots_taken").eq("id", C4_RF).single()).data!.slots_taken).toBe(before - 1);

    await svc.from("registrations").delete().eq("id", rid);
    await svc.auth.admin.deleteUser(runner.id);
  });

  it("marks refund.updated=failed as failed and leaves the registration paid", async () => {
    const svc = service();
    const runner = await makeUser(`wh_rff_${Date.now()}@test.dev`);
    const rid = await paidRegistration(runner.token);
    const refId = `ref_fail_${Date.now()}`;
    const pay = (await svc.from("payments").select("raw").eq("registration_id", rid).single()).data!;
    await svc.from("payments").update({ raw: { ...(pay.raw ?? {}), refund: { status: "pending", id: refId, refunded_by: runner.id, note: null } } }).eq("registration_id", rid);

    const res = await postWebhook(refundEvent(refId, "failed"));
    expect(res.status).toBe(200);
    expect((await svc.from("registrations").select("status").eq("id", rid).single()).data!.status).toBe("paid");
    const after = (await svc.from("payments").select("raw").eq("registration_id", rid).single()).data!;
    expect((after.raw as any).refund.status).toBe("failed");

    await svc.from("registrations").delete().eq("id", rid);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
