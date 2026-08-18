import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

// Referenced inside RLS policies, which evaluate as the querying role — see the two allowlists
// below for why each needs what it needs. Never revoke EXECUTE on any of these, for any role.
//
// The last two were added by 20260818120000_org_management.sql and are a DELIBERATE edit to
// this list, which is the mechanism the enumeration test at the bottom of this file asks for
// ("if one is ever legitimately needed, that's a deliberate edit to this test"). They answer
// "which events / orgs does the caller hold a registration for?" for the SELECT policies on
// `events` and `organizations`, so a suspended org's own paying runners can still load their
// ticket. They are SECURITY DEFINER functions specifically SO THAT the alternative —
// `grant select on public.registrations to anon`, which an inline policy subselect would
// otherwise need because anon reads both those tables — never has to be granted. See that
// migration's section 0. For an anonymous caller they return the empty set, so anon EXECUTE
// discloses nothing.
const AUTH_PREDICATES = [
  "auth_can_admin_org",
  "auth_can_check_in_event",
  "auth_is_super_admin",
  "auth_registered_event_ids",
  "auth_registered_org_ids",
];

// Group B, per 20260808110000/task-sec-brief.md: client-called, each refuses unauthorized
// callers internally, so `authenticated` EXECUTE is required — plus the RLS-policy
// predicates, which must keep `authenticated` or row-level security evaluation across the schema
// breaks. Nothing else in `public` should be authenticated-executable without a deliberate edit
// to this list.
const AUTHENTICATED_ALLOWLIST = new Set([
  "admin_cancel_registration",
  "admin_registration_emails",
  "admin_org_signups_daily",
  "admin_payment_aggregates",
  "admin_registration_aggregates",
  "checkin_events",
  "checkin_roster",
  "checkin_undo",
  "payout_mark_paid",
  "payout_open_statement",
  // 20260811095000_payout_open_statement_v2.sql. Deliberate addition, and it honours the
  // contract above rather than bending it: the function raises 42501 for any caller who is
  // neither a super admin NOR an editor/admin of the event's own org. That is deliberately
  // wider than its two payout siblings, which are super-admin-only — the organizer-facing
  // settlement page reads this count and is gated on manage_org — and it is exactly the set
  // payments_read_org_admin grants SELECT to on the rows being counted, because the gate
  // calls auth_can_admin_org rather than restating the rule. Both refusals (unrelated-org
  // admin, roleless runner) and the org-staff pass are asserted in
  // payout-statements-v2.test.ts, so this entry is not taken on trust.
  "payout_unreconciled_count",
  "update_registration_fields_tx",
  ...AUTH_PREDICATES,
]);

// The RLS-policy predicates are additionally anon-executable — not a gap, a requirement:
// they're called from inside RLS policies on tables anon can read (e.g. `events`/`organizations`
// SELECT policies gated on `auth_can_admin_org`-adjacent logic), and a policy evaluates as
// whatever role is running the query, including anon. This is the ONE sanctioned exception to
// "no function is anon-executable" — task-sec-brief.md and every review pass since have called
// these out by name as the one thing that must never be touched, for any role: "Revoking
// EXECUTE from authenticated (or anon, for anon-readable tables whose policies reference them)
// would break row-level security evaluation across the whole schema." Confirmed via
// `_function_grant_audit` that this is the schema's actual, unchanged-since-before-this-task
// state (the original three were explicitly out of scope for every migration in this series) — not
// something to "fix" by revoking anon, which would violate that constraint and risk exactly the
// outage it warns about.
const ANON_ALLOWLIST = new Set(AUTH_PREDICATES);

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** Fresh org/event/category + one registration+payment, isolated from seed data.
 *  status "pending" backs the confirm_payment_tx tests; "paid" backs the refund tests.
 *  Exception-safe: if an insert partway through fails, whatever this function already
 *  created is torn down here before rethrowing — the caller's try/finally only runs
 *  cleanup() when fixture() itself returns successfully. */
async function fixture(tag: string, status: "pending" | "paid") {
  const s = svc();
  const stamp = `${tag}_${Date.now()}`;
  const email = `grants_${stamp}@test.dev`;
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
    cleanups.push(() => s.auth.admin.deleteUser(uid));
    const org = (await s.from("organizations").insert({ name: "Grants Org", slug: `gr-${stamp}` }).select().single()).data!;
    cleanups.push(() => s.from("organizations").delete().eq("id", org.id));
    // status doesn't matter — these RPCs are called directly, never through an anon read.
    const ev = (await s.from("events").insert({ org_id: org.id, name: "Grants Race", status: "draft" }).select().single()).data!;
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
  } catch (err) {
    for (const fn of cleanups.reverse()) await fn();
    throw err;
  }
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
        p_provider_refund: {}, p_refunded_amount: 100000, p_retained_net: 0,
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

  // Schema-wide regression guard, replacing 20260808120200's event trigger (removed by
  // 20260808130000 — it fired on CREATE OR REPLACE FUNCTION as well as fresh creates, silently
  // stripping `authenticated` from any existing client-called RPC the next time its body was
  // redefined, which this repo's own migrations do without restating grants). This is the
  // enumeration equivalent: it doesn't prevent a bad grant from happening, but it fails loudly,
  // in a test run, the moment one does — instead of silently, at runtime, in the admin console.
  //
  // Enumerates every SECURITY DEFINER function in `public` via the service-role-only
  // `_function_grant_audit` RPC (supabase-js has no way to run arbitrary SQL — see test/env.ts)
  // and asserts: no function is anon-executable except ANON_ALLOWLIST (the RLS predicates —
  // no other exception; if one is ever legitimately needed, that's a deliberate edit to this
  // test, not a passive default). No function is authenticated-executable except
  // AUTHENTICATED_ALLOWLIST above.
  it("no security-definer function in public is anon-executable (except the RLS predicates), and only the allowlist is authenticated-executable", async () => {
    const { data, error } = await svc().rpc("_function_grant_audit");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);

    const violations = (data as { fn_name: string; anon_exec: boolean; auth_exec: boolean }[])
      .filter((row) =>
        (row.anon_exec && !ANON_ALLOWLIST.has(row.fn_name)) ||
        (row.auth_exec && !AUTHENTICATED_ALLOWLIST.has(row.fn_name)))
      .map((row) => ({ fn_name: row.fn_name, anon_exec: row.anon_exec, auth_exec: row.auth_exec }));

    expect(violations, `unexpected grants: ${JSON.stringify(violations)}`).toEqual([]);
  });

  // The audit helper itself is security definer, so it's in scope of the enumeration above —
  // confirm directly that it isn't accidentally exempting itself by being reachable, rather than
  // relying on the enumeration test alone to notice.
  it("_function_grant_audit itself is locked to service_role", async () => {
    const r = await anon().rpc("_function_grant_audit");
    expect(r.error).not.toBeNull();
    expect(r.error!.code).toBe("42501");
  });
});
