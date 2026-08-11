import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { loadEnv } from "../../test/env";
import { seededIds } from "../../test/seeded";
import { computeFee, type FeeTerms } from "../functions/_shared/fee.ts";
import { predictProcessorFee, type ProcessorRate } from "../functions/_shared/processorFee.ts";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

// Resolved from the seed rather than restated — see test/seeded.ts. Declared
// once here for the whole file: the checkout suite above and the refund suite
// below both work against the same two seeded orgs and the same event/category,
// and previously each restated them as literals.
//
// ORG_A_TERMS and GCASH_RATE are read the same way, for the same reason: the
// money-path tests below must compute their expected commission and processor
// fee with computeFee()/predictProcessorFee() over the org's REAL stored terms
// and the rate card's REAL current row, never a restated literal — a repeat of
// exactly the drift that broke this file (the org went from a hardcoded 10% to
// the seed's actual 6%; a ₱3,800 category was asserted as if it were ₱1,000).
let RWP_RF: string, APO_RF: string, E1_RF: string, C4_RF: string;
let ORG_A_TERMS: FeeTerms;
let GCASH_RATE: ProcessorRate;
beforeAll(async () => {
  ({ ORG_A: RWP_RF, ORG_B: APO_RF, EVENT_A: E1_RF, CATEGORY_A: C4_RF } = await seededIds());

  const svc = service();
  const org = await svc.from("organizations")
    .select("commission_type,commission_rate,commission_flat_cents")
    .eq("id", RWP_RF).single();
  if (org.error || !org.data) throw org.error ?? new Error("seeded org ORG_A not found");
  ORG_A_TERMS = {
    commission_type: org.data.commission_type,
    commission_rate: org.data.commission_rate === null ? null : Number(org.data.commission_rate),
    commission_flat_cents: org.data.commission_flat_cents,
  };

  // Same lookup processor_rate_at() does (provider/method/scope, current row),
  // just performed at test time instead of confirm time.
  const rate = await svc.from("processor_rates")
    .select("percent_bps,fixed_cents")
    .eq("provider", "paymongo").eq("method", "gcash").eq("scope", "local")
    .is("effective_to", null).single();
  if (rate.error || !rate.data) throw rate.error ?? new Error("no current local gcash processor_rates row");
  GCASH_RATE = rate.data;
});

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
// A webhook fixture whose payment looks like a real CAPTURED PayMongo payment —
// status "paid" plus amount/fee/net_amount — so reportedProcessorFee() (confirm.ts)
// finds a figure it is entitled to trust. paidEvent() above deliberately carries
// none of these fields, which is what drives confirm.ts's 'predicted' fallback.
const paidEventWithFee = (
  registrationId: string, method: string, amount: number, fee: number, netAmount: number,
) => ({
  data: { attributes: { type: "checkout_session.payment.paid", data: { attributes: {
    metadata: { registration_id: registrationId },
    payments: [{ attributes: { status: "paid", source: { type: method }, amount, fee, net_amount: netAmount } }],
  } } } },
});

describe("organizations RLS", () => {
  it("anon can read an active org but not an inactive one", async () => {
    const svc = service();
    // Cleanup thunks are pushed the instant each row exists, so a throw anywhere below —
    // including inside the second insert — still tears down whatever was already created.
    const cleanups: Array<() => Promise<unknown>> = [];
    try {
      const active = await svc.from("organizations").insert({ name: "Active Org", slug: "active-org" }).select().single();
      expect(active.error).toBeNull();
      cleanups.push(() => svc.from("organizations").delete().eq("id", active.data!.id));

      const inactive = await svc.from("organizations").insert({ name: "Hidden Org", slug: "hidden-org", is_active: false }).select().single();
      cleanups.push(() => svc.from("organizations").delete().eq("id", inactive.data!.id));

      const { data } = await anon().from("organizations").select("slug");
      const slugs = (data ?? []).map((o) => o.slug);
      expect(slugs).toContain("active-org");
      expect(slugs).not.toContain("hidden-org");
    } finally {
      for (const fn of cleanups.reverse()) await fn();
    }
  });
});

describe("events catalog RLS", () => {
  it("hides draft events from anon, shows open ones", async () => {
    const svc = service();
    const cleanups: Array<() => Promise<unknown>> = [];
    try {
      const org = await svc.from("organizations").insert({ name: "Cat Org", slug: "cat-org" }).select().single();
      // org delete cascades its events, so one thunk covers the whole tree below it.
      cleanups.push(() => svc.from("organizations").delete().eq("id", org.data!.id));

      await svc.from("events").insert({ org_id: org.data!.id, name: "Draft Race", status: "draft" });
      await svc.from("events").insert({ org_id: org.data!.id, name: "Open Race", status: "open" });

      const { data } = await anon().from("events").select("name");
      const names = (data ?? []).map((e) => e.name);
      expect(names).toContain("Open Race");
      expect(names).not.toContain("Draft Race");
    } finally {
      for (const fn of cleanups.reverse()) await fn();
    }
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
    const cleanups: Array<() => Promise<unknown>> = [];
    try {
      // status doesn't matter — Alice/Bob read via the authenticated role and the
      // registrations table's own RLS, not the events-catalog anon policy.
      const org = await svc.from("organizations").insert({ name: "Reg Org", slug: "reg-org" }).select().single();
      cleanups.push(() => svc.from("organizations").delete().eq("id", org.data!.id));
      const ev = await svc.from("events").insert({ org_id: org.data!.id, name: "Reg Race", status: "draft" }).select().single();
      const cat = await svc.from("categories").insert({ org_id: org.data!.id, event_id: ev.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 }).select().single();

      const alice = await makeUser(`alice_${Date.now()}@test.dev`);
      cleanups.push(() => svc.auth.admin.deleteUser(alice.id));
      const bob = await makeUser(`bob_${Date.now()}@test.dev`);
      cleanups.push(() => svc.auth.admin.deleteUser(bob.id));
      const reg = await svc.from("registrations").insert({ org_id: org.data!.id, event_id: ev.data!.id, category_id: cat.data!.id, user_id: alice.id, total_amount: 100000 }).select().single();

      const asAlice = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${alice.token}` } }, auth: { persistSession: false } });
      const asBob = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${bob.token}` } }, auth: { persistSession: false } });

      const aliceView = await asAlice.from("registrations").select("id").eq("id", reg.data!.id);
      const bobView = await asBob.from("registrations").select("id").eq("id", reg.data!.id);
      expect(aliceView.data).toHaveLength(1);
      expect(bobView.data).toHaveLength(0); // RLS hides Alice's row from Bob
    } finally {
      for (const fn of cleanups.reverse()) await fn();
    }
  });
});

describe("seed", () => {
  it("exposes the seeded org, event, and its categories to anon", async () => {
    // Ground truth via service role (bypasses RLS), then verify anon sees the exact
    // same thing. Neither the org's slug nor the event's category codes are restated
    // here — both used to be hardcoded ("race-pace" / a literal 4-code list) and both
    // went stale when seed.sql was rewritten (current org slugs are "muspo" /
    // "runwithpoint"; EVENT_A has 3 categories, not 4). Deriving them from the DB
    // means the next seed rewrite cannot break this test the same way again.
    const svc = service();
    const a = anon();

    const orgTruth = await svc.from("organizations").select("slug").eq("id", RWP_RF).single();
    expect(orgTruth.error).toBeNull();
    const orgSeen = await a.from("organizations").select("slug").eq("id", RWP_RF).single();
    expect(orgSeen.data?.slug).toBe(orgTruth.data?.slug);

    const catsTruth = await svc.from("categories").select("code").eq("event_id", E1_RF);
    const expectedCodes = (catsTruth.data ?? []).map((c) => c.code).sort();
    expect(expectedCodes.length).toBeGreaterThan(0); // sanity: the event must actually have categories

    const catsSeen = await a.from("categories").select("code").eq("event_id", E1_RF);
    expect((catsSeen.data ?? []).map((c) => c.code).sort()).toEqual(expectedCodes);
  });
});

const FN = `${url}/functions/v1`;

describe("registrations-checkout", () => {
  // The global seed's only event/category with a full custom_data shape (a required
  // profile-key field, an optional non-profile text field, and an org-level enum that
  // a canonical passport value deliberately violates — see seed.sql's form_fields
  // insert) sits on event 00000000-0000-0000-0000-000000010009 ("Valencia Twin
  // Peaks"), which is status 'completed' — permanently closed to new registrations
  // (isRegistrationClosed treats 'completed' as closed, and that check runs BEFORE
  // custom_data is ever read). E1_RF/CATEGORY_A (the seed's only OPEN event in
  // ORG_A) carries no form_fields at all — form_fields are seeded on ONE event only,
  // per seed.sql's own comment, and it isn't this one. So no existing seeded event is
  // simultaneously open AND field-configured, and a literal category id
  // ("...c3") that predates seed.sql's move to gen_random_uuid() categories is what
  // produced the 404s here (confirmed: that id matches zero rows).
  //
  // These four tests build their own fixture instead — same field shape as seed.sql's
  // f1/f2/f3 (required select blood_type, optional text running_club, required select
  // shirt_size) on a fresh org/event/category that IS open — mirroring the
  // "registrations RLS" / "events catalog RLS" fixtures above rather than depending on
  // the global seed for behavior the global seed no longer provides on an open event.
  let fx: { eventId: string; categoryId: string; addonId: string; addonPrice: number; basePrice: number };
  let fixtureOrgId: string;

  beforeAll(async () => {
    const svc = service();
    const stamp = `checkout-fx-${Date.now()}`;
    const org = (await svc.from("organizations").insert({ name: "Checkout Fixture Org", slug: stamp }).select().single()).data!;
    fixtureOrgId = org.id;
    const ev = (await svc.from("events").insert({ org_id: org.id, name: "Checkout Fixture Race", status: "open" }).select().single()).data!;
    const cat = (await svc.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "fx", label: "Fixture Category",
      base_price: 170000, slots_total: 50,
    }).select().single()).data!;
    const addon = (await svc.from("addons").insert({
      org_id: org.id, event_id: ev.id, name: "Fixture Addon", price: 60000,
    }).select().single()).data!;
    await svc.from("form_fields").insert([
      { org_id: org.id, event_id: ev.id, key: "blood_type", label: "Blood type", type: "select", required: true, options: ["A", "B", "AB", "O"], sort_order: 1 },
      { org_id: org.id, event_id: ev.id, key: "running_club", label: "Running club", type: "text", required: false, options: null, sort_order: 2 },
      { org_id: org.id, event_id: ev.id, key: "shirt_size", label: "Shirt size", type: "select", required: true, options: ["S", "M", "L", "XL"], sort_order: 3 },
    ]);

    fx = {
      eventId: ev.id, categoryId: cat.id,
      addonId: addon.id, addonPrice: addon.price, basePrice: cat.base_price,
    };
  });
  afterAll(async () => {
    // org delete cascades event -> category/addon/form_fields (and any registrations
    // a failed test left behind), same cascade the RLS fixtures above rely on.
    if (fixtureOrgId) await service().from("organizations").delete().eq("id", fixtureOrgId);
  });

  it("validates fields, creates a pending registration, returns a checkout url", async () => {
    const user = await makeUser(`reg_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: fx.eventId,
        category_id: fx.categoryId,
        addon_ids: [fx.addonId],
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
    expect(reg.data?.total_amount).toBe(fx.basePrice + fx.addonPrice); // fixture category + fixture addon, read back from the inserts

    await svc.from("registrations").delete().eq("id", body.registration_id);
    await svc.auth.admin.deleteUser(user.id);
  });

  it("rejects invalid custom_data", async () => {
    const user = await makeUser(`bad_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: fx.eventId,
        category_id: fx.categoryId,
        custom_data: { running_club: 12345 }, // fixture field `running_club` is a text field — number fails z.string()
        waiver_accepted: true,
        idempotency_key: `idem-bad-${Date.now()}`,
      }),
    });
    expect(res.status).toBe(400);
    await service().auth.admin.deleteUser(user.id);
  });

  // Model B (spec §8): profile-key fields (blood_type, shirt_size, ...) are prefilled from the
  // runner's profile and validated client-side against canonical shared lists + passport rules,
  // not the org's per-event `options` enum. A canonical value that would fail the fixture's own
  // enum (blood_type options ['A','B','AB','O']; shirt_size options ['S','M','L','XL']) must
  // still succeed server-side and persist as sent.
  it("accepts canonical passport values that fail the org's enum, and persists them", async () => {
    const user = await makeUser(`passport_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: fx.eventId,
        category_id: fx.categoryId,
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

  // Model B hardening: required profile-key fields (blood_type, shirt_size on the fixture
  // event) must be present + non-empty in custom_data — enforced by presence, NOT the org enum
  // (canonical values still pass). A direct/replayed API caller that omits a required passport
  // field is rejected.
  it("rejects a registration that omits a required profile-key field", async () => {
    const user = await makeUser(`missing_${Date.now()}@test.dev`);
    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: fx.eventId,
        category_id: fx.categoryId,
        custom_data: { shirt_size: "M" }, // omits required blood_type
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

    const before = await svc.from("categories").select("slots_taken").eq("id", C4_RF).single();

    const checkout = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: E1_RF,
        category_id: C4_RF,
        custom_data: { blood_type: "A", shirt_size: "L" },
        waiver_accepted: true,
        idempotency_key: `idem-e2e-${Date.now()}`,
      }),
    }).then((r) => r.json());

    const hook = await postWebhook(paidEvent(checkout.registration_id));
    expect(hook.status).toBe(200);

    const reg = await svc.from("registrations").select("status,ticket_token,total_amount").eq("id", checkout.registration_id).single();
    expect(reg.data?.status).toBe("paid");
    expect(reg.data?.ticket_token).toContain("."); // body.signature

    // paidEvent()'s payment carries no status/amount/fee/net_amount, so
    // reportedProcessorFee() (confirm.ts) returns null and confirmation takes the
    // rate-card fallback — the 'predicted' path. platform_fee, the processor fee,
    // and net_to_org are all derived from the org's REAL commission terms and the
    // gcash rate card's REAL current row (both resolved once, above) — never a
    // restated literal. See "processor fee source" below for the 'actual' path.
    const totalAmount = reg.data!.total_amount;
    const expectedPlatformFee = computeFee(totalAmount, ORG_A_TERMS);
    const expectedProcessorFee = predictProcessorFee(totalAmount, GCASH_RATE);

    const pay = await svc.from("payments")
      .select("status,amount,platform_fee,processor_fee_cents,processor_fee_source,net_to_org")
      .eq("registration_id", checkout.registration_id).single();
    expect(pay.data?.status).toBe("paid");
    expect(pay.data?.amount).toBe(totalAmount);
    expect(pay.data?.platform_fee).toBe(expectedPlatformFee);
    expect(pay.data?.processor_fee_source).toBe("predicted");
    expect(pay.data?.processor_fee_cents).toBe(expectedProcessorFee);
    expect(pay.data?.net_to_org).toBe(totalAmount - expectedPlatformFee - expectedProcessorFee);
    // The three-party ledger invariant, checked directly on the stored row.
    expect(pay.data!.amount - pay.data!.processor_fee_cents - pay.data!.platform_fee).toBe(pay.data!.net_to_org);

    const after = await svc.from("categories").select("slots_taken").eq("id", C4_RF).single();
    expect(after.data!.slots_taken).toBe(before.data!.slots_taken + 1); // relative — robust to prior runs

    // A duplicate confirmation is a no-op — slot stays at +1 (idempotent through confirm_payment_tx).
    await postWebhook(paidEvent(checkout.registration_id));
    const afterDup = await svc.from("categories").select("slots_taken").eq("id", C4_RF).single();
    expect(afterDup.data!.slots_taken).toBe(before.data!.slots_taken + 1);

    await svc.from("registrations").delete().eq("id", checkout.registration_id);
    await svc.auth.admin.deleteUser(user.id);
  });
});

// Task 5's whole point: the ledger trusts what PayMongo reported over what the rate
// card guessed. Nothing above drives that branch — paidEvent()'s fixture carries no
// status/amount/fee/net_amount, so it only ever exercises the 'predicted' fallback.
// These three cases go through the real /payments-webhook endpoint (not a unit call
// into confirm.ts) so the wiring itself — not just the branch logic already covered
// by processor-fee-ledger.test.ts's unit tests — is proven.
describe("processor fee source — actual vs predicted (e2e)", () => {
  // custom_data here only touches blood_type/shirt_size (profile keys — see Model B
  // above), so the seeded E1_RF/C4_RF (no form_fields) is fine for these; unlike the
  // registrations-checkout suite, nothing here depends on a non-profile field.
  async function checkoutOnSeed(emailPrefix: string) {
    const svc = service();
    const user = await makeUser(`${emailPrefix}_${Date.now()}@test.dev`);
    const checkout = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({
        event_id: E1_RF,
        category_id: C4_RF,
        custom_data: { blood_type: "A", shirt_size: "L" },
        waiver_accepted: true,
        idempotency_key: `idem-${emailPrefix}-${Date.now()}`,
      }),
    }).then((r) => r.json());
    const reg = await svc.from("registrations").select("total_amount").eq("id", checkout.registration_id).single();
    return { svc, user, rid: checkout.registration_id as string, amount: reg.data!.total_amount as number };
  }

  it("a captured payment whose amount - fee = net_amount is trusted as 'actual', not the rate-card prediction", async () => {
    const { svc, user, rid, amount } = await checkoutOnSeed("e2ea");
    try {
      const predicted = predictProcessorFee(amount, GCASH_RATE);
      // Deliberately different from the rate card's prediction, so a passing test
      // proves the code recorded what PayMongo REPORTED rather than silently using
      // the estimate — even though the estimate was available and well-formed.
      const actualFee = predicted + 137;
      const hook = await postWebhook(paidEventWithFee(rid, "gcash", amount, actualFee, amount - actualFee));
      expect(hook.status).toBe(200);

      const expectedPlatformFee = computeFee(amount, ORG_A_TERMS);
      const pay = await svc.from("payments")
        .select("status,amount,platform_fee,processor_fee_cents,processor_fee_source,net_to_org")
        .eq("registration_id", rid).single();
      expect(pay.data?.status).toBe("paid");
      expect(pay.data?.processor_fee_source).toBe("actual");
      expect(pay.data?.processor_fee_cents).toBe(actualFee);
      expect(pay.data?.processor_fee_cents).not.toBe(predicted); // proves it did not fall back to the estimate
      expect(pay.data?.platform_fee).toBe(expectedPlatformFee);
      expect(pay.data?.net_to_org).toBe(amount - expectedPlatformFee - actualFee);
      // The three-party ledger invariant, on the stored row.
      expect(pay.data!.amount - pay.data!.processor_fee_cents - pay.data!.platform_fee).toBe(pay.data!.net_to_org);
    } finally {
      await svc.from("registrations").delete().eq("id", rid);
      await svc.auth.admin.deleteUser(user.id);
    }
  });

  it("a payload whose amount - fee != net_amount fails the integrity check and is recorded 'predicted', never 'actual'", async () => {
    const { svc, user, rid, amount } = await checkoutOnSeed("e2ei");
    try {
      const predicted = predictProcessorFee(amount, GCASH_RATE);
      const reportedFee = predicted + 50; // a plausible-looking figure
      const brokenNetAmount = amount - reportedFee + 999; // amount - fee != net_amount
      const hook = await postWebhook(paidEventWithFee(rid, "gcash", amount, reportedFee, brokenNetAmount));
      expect(hook.status).toBe(200);

      const expectedPlatformFee = computeFee(amount, ORG_A_TERMS);
      const pay = await svc.from("payments")
        .select("status,amount,platform_fee,processor_fee_cents,processor_fee_source,net_to_org")
        .eq("registration_id", rid).single();
      expect(pay.data?.status).toBe("paid"); // still confirms — flagged for manual review, not blocked
      expect(pay.data?.processor_fee_source).toBe("predicted");
      expect(pay.data?.processor_fee_source).not.toBe("actual");
      // The broken reported figure is discarded outright, not partially trusted: the
      // stored fee is the rate card's prediction, neither `reportedFee` nor a figure
      // derived from the broken `net_amount`.
      expect(pay.data?.processor_fee_cents).toBe(predicted);
      expect(pay.data?.processor_fee_cents).not.toBe(reportedFee);
      expect(pay.data?.platform_fee).toBe(expectedPlatformFee);
      expect(pay.data?.net_to_org).toBe(amount - expectedPlatformFee - predicted);
      expect(pay.data!.amount - pay.data!.processor_fee_cents - pay.data!.platform_fee).toBe(pay.data!.net_to_org);
    } finally {
      await svc.from("registrations").delete().eq("id", rid);
      await svc.auth.admin.deleteUser(user.id);
    }
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
        event_id: E1_RF,
        category_id: C4_RF,
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
