import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** Fresh org/event/category + one registration+payment, isolated from seed data.
 *  status "pending" backs the confirm_payment_tx tests; "paid" backs the refund tests. */
async function fixture(tag: string, status: "pending" | "paid") {
  const s = svc();
  const stamp = `${tag}_${Date.now()}`;
  const email = `grants_${stamp}@test.dev`;
  const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
  const org = (await s.from("organizations").insert({ name: "Grants Org", slug: `gr-${stamp}` }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "Grants Race", status: "open" }).select().single()).data!;
  const cat = (await s.from("categories").insert({
    org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
    base_price: 100000, slots_total: 50, slots_taken: status === "paid" ? 1 : 0,
  }).select().single()).data!;
  const reg = (await s.from("registrations").insert({
    org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid,
    total_amount: 100000, status, ticket_token: status === "paid" ? "real.ticket" : null,
  }).select().single()).data!;
  await s.from("payments").insert({
    org_id: org.id, registration_id: reg.id, amount: 100000, provider: "fake",
    status: status === "paid" ? "paid" : "pending",
    ...(status === "paid" ? { platform_fee: 10000, net_to_org: 90000 } : {}),
  });
  return { s, uid, email, org, ev, cat, reg };
}

async function cleanup(s: ReturnType<typeof svc>, orgId: string, uid: string) {
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

describe("function grants — service-role-only RPCs reject anon", () => {
  // This is the regression guard for the proven exploit: an anonymous caller invoked
  // confirm_payment_tx directly against the hosted project and turned a pending registration
  // into a paid one with a minted ticket_token, without paying. Asserting on the error code
  // alone would pass even if the write had gone through underneath a misleading error — the
  // re-read with the service client is what actually proves the money-state didn't move.
  it("anon cannot confirm a payment, and the registration is untouched", async () => {
    const { s, uid, org, reg } = await fixture("confirm_anon", "pending");
    try {
      const r = await anon().rpc("confirm_payment_tx", {
        p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000,
        p_token: "forged.token", p_raw: { source: "exploit-attempt" },
      });
      expect(r.error).not.toBeNull();
      expect(r.error!.code).toBe("42501");

      const row = (await s.from("registrations").select("status,ticket_token").eq("id", reg.id).single()).data!;
      expect(row.status).toBe("pending");
      expect(row.ticket_token).toBeNull();
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("anon cannot refund, and the registration is untouched", async () => {
    const { s, uid, org, reg } = await fixture("refund_anon", "paid");
    try {
      const r = await anon().rpc("refund_registration_tx", {
        p_registration_id: reg.id, p_refunded_by: uid, p_note: "exploit attempt",
        p_provider_refund: {}, p_refunded_amount: 100000, p_retained_fee: 0, p_retained_net: 0,
      });
      expect(r.error).not.toBeNull();
      expect(r.error!.code).toBe("42501");

      const row = (await s.from("registrations").select("status").eq("id", reg.id).single()).data!;
      expect(row.status).toBe("paid");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  // Proves the revoke did not break the real payment path — the way this fix could plausibly
  // cause an outage. payments-webhook / _shared/confirm.ts call this as service_role.
  it("service_role can still confirm a payment", async () => {
    const { s, uid, org, reg } = await fixture("confirm_svc", "pending");
    try {
      const r = await s.rpc("confirm_payment_tx", {
        p_registration_id: reg.id, p_method: "gcash", p_fee: 10000, p_net: 90000,
        p_token: "real.token", p_raw: { source: "test" },
      });
      expect(r.error).toBeNull();
      expect(r.data).toBe("paid");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  // A Group B function (client-called, refuses unauthorized callers internally). A signed-in
  // non-admin must still get the function's own internal refusal ('unauthorized'), not a
  // privilege error — proving `authenticated` still holds EXECUTE and this migration did not
  // over-revoke Group B.
  it("a signed-in non-admin gets 'unauthorized' from admin_cancel_registration, not a privilege error", async () => {
    const { s, uid, email, org, reg } = await fixture("cancel_nonadmin", "pending");
    try {
      // The fixture's own runner account has no admin role on this org (or any org).
      const c = await signedIn(email);
      const r = await c.rpc("admin_cancel_registration", { p_registration_id: reg.id });
      expect(r.error).toBeNull();
      expect(r.data).toBe("unauthorized");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  // anon is refused outright by a Group B function — a 42501 privilege error, not an empty
  // result set from the function's own row-filtering logic.
  it("anon is refused by checkin_events with a privilege error, not an empty array", async () => {
    const r = await anon().rpc("checkin_events");
    expect(r.error).not.toBeNull();
    expect(r.error!.code).toBe("42501");
    expect(r.data).toBeNull();
  });

  // Regression guard for 20260808120200_close_new_function_public_execute_gap.sql. The obvious
  // fix (naming PUBLIC in the ALTER DEFAULT PRIVILEGES revoke, 20260808120000) does NOT actually
  // suppress Postgres's built-in "EXECUTE granted to PUBLIC" default for new functions — proven
  // empirically while writing these migrations, see 20260808120000's header — so PUBLIC's grant
  // applies to every role, and a brand-new function was exactly as anon/authenticated-executable
  // as before the fix, silently. `_grants_regression_canary` (20260808120300) is a permanent
  // fixture function created by a real migration with no grant statement of its own, exactly the
  // shape a careless future migration would produce; this proves anon and authenticated cannot
  // call it, rather than trusting that the schema-wide defaults still say what these migrations
  // claim they say.
  it("a function created with no explicit grant is anon- and authenticated-unreachable by default", async () => {
    const anonResult = await anon().rpc("_grants_regression_canary");
    expect(anonResult.error).not.toBeNull();
    expect(anonResult.error!.code).toBe("42501");

    const { data: { user }, error: signUpError } = await svc().auth.admin.createUser({
      email: `grants_canary_${Date.now()}@test.dev`, password: "password123", email_confirm: true,
    });
    expect(signUpError).toBeNull();
    try {
      const c = await signedIn(user!.email!);
      const authedResult = await c.rpc("_grants_regression_canary");
      expect(authedResult.error).not.toBeNull();
      expect(authedResult.error!.code).toBe("42501");
    } finally {
      await svc().auth.admin.deleteUser(user!.id);
    }
  });
});
