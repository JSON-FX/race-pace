import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * payout_open_statement and payout_mark_paid gate on auth_is_super_admin(),
 * which reads auth.uid(). The service role has no uid, so these RPCs cannot be
 * driven with the service key — and `opened_by` is NOT NULL referencing
 * auth.users, so a real session is required regardless.
 *
 * Signing in is therefore not a workaround; it is what makes these tests
 * exercise the authorization path the console actually uses.
 */
async function signedInAs(email: string, password = "password123"): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** Fresh org + event + N paid payments, plus a super admin who can settle them. */
async function fixture(tag: string, count: number) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  // Terms stated explicitly, as any real org must be — the defaults are 'fixed'
  // at ₱0, which would charge no commission and make these sums meaningless.
  const org = (await s.from("organizations").insert({
    name: "Payout Org", slug: stamp,
    commission_type: "percent", commission_rate: 0.10,
    refund_policy: "full", refund_fee_cents: 0,
  }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "Payout Race", status: "open" }).select().single()).data!;
  // registrations.category_id is NOT NULL — capacity and price live on categories.
  const cat = (await s.from("categories").insert({
    org_id: org.id, event_id: ev.id, code: "50k", label: "50K",
    base_price: 200000, slots_total: 100, slots_taken: 0,
  }).select().single()).data!;

  const adminEmail = `po_admin_${stamp}@test.dev`;
  const admin = await s.auth.admin.createUser({ email: adminEmail, password: "password123", email_confirm: true });
  const adminId = admin.data.user!.id;
  await s.from("user_roles").insert({ user_id: adminId, role: "super_admin", org_id: null });

  const users: string[] = [adminId];
  const regs: string[] = [];
  for (let i = 0; i < count; i++) {
    const u = await s.auth.admin.createUser({ email: `po_${stamp}_${i}@test.dev`, password: "password123", email_confirm: true });
    users.push(u.data.user!.id);
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id,
      user_id: u.data.user!.id, total_amount: 200000, status: "paid",
    }).select().single()).data!;
    regs.push(reg.id);
    await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 200000,
      platform_fee: 20000, net_to_org: 180000, status: "paid", provider: "fake",
    });
  }

  const as = await signedInAs(adminEmail);
  return { s, as, org, ev, users, regs };
}

async function cleanup(s: SupabaseClient, orgId: string, users: string[]) {
  await s.from("payout_statements").delete().eq("org_id", orgId);
  await s.from("organizations").delete().eq("id", orgId);
  for (const u of users) await s.auth.admin.deleteUser(u);
}

/** Fails loudly. A silent null here surfaces as "cannot read gross_cents of
 *  null" three lines later, which hides whatever the RPC actually said. */
async function openStatement(as: SupabaseClient, eventId: string): Promise<string> {
  const r = await as.rpc("payout_open_statement", { p_event_id: eventId });
  if (r.error) throw new Error(`payout_open_statement: ${r.error.message} (${r.error.code})`);
  return r.data as string;
}

async function stmt(s: SupabaseClient, id: string) {
  const r = await s.from("payout_statements").select("*").eq("id", id).single();
  if (r.error) throw new Error(`read statement ${id}: ${r.error.message}`);
  return r.data!;
}

describe("payout statements", () => {
  it("sums unsettled paid payments", async () => {
    const { s, as, org, ev, users } = await fixture("sum", 3);
    const id = await openStatement(as, ev.id);
    const st = await stmt(s, id);
    expect(Number(st.gross_cents)).toBe(600000);
    expect(Number(st.commission_cents)).toBe(60000);
    expect(Number(st.refunds_cents)).toBe(0);
    expect(Number(st.net_owed_cents)).toBe(540000);
    await cleanup(s, org.id, users);
  });

  it("a refund BEFORE payout contributes nothing — NOT a negative", async () => {
    const { s, as, org, ev, users, regs } = await fixture("early", 2);
    await s.from("payments").update({ status: "refunded" }).eq("registration_id", regs[0]);

    const id = await openStatement(as, ev.id);
    const st = await stmt(s, id);
    // Only the surviving entry counts. The refunded one is invisible: the org was
    // never given that money, so there is nothing to claw back. Keying on status
    // alone would have produced 200000 - 20000 - 180000 = 0 here, and a bare
    // -180000 had there been no surviving entry.
    expect(Number(st.gross_cents)).toBe(200000);
    expect(Number(st.refunds_cents)).toBe(0);
    expect(Number(st.net_owed_cents)).toBe(180000);
    await cleanup(s, org.id, users);
  });

  it("a refund AFTER payout is clawed back exactly once", async () => {
    const { s, as, org, ev, users, regs } = await fixture("late", 2);
    const first = await openStatement(as, ev.id);
    await as.rpc("payout_mark_paid", { p_statement_id: first, p_reference: "REF-1", p_note: null });

    await s.from("payments").update({ status: "refunded" }).eq("registration_id", regs[0]);

    const second = await openStatement(as, ev.id);
    const st2 = await stmt(s, second);
    expect(Number(st2.gross_cents)).toBe(0);
    expect(Number(st2.refunds_cents)).toBe(180000);
    expect(Number(st2.net_owed_cents)).toBe(-180000); // organizer owes it back
    await as.rpc("payout_mark_paid", { p_statement_id: second, p_reference: "REC-1", p_note: null });

    // A THIRD statement must not re-subtract the same refund.
    const third = await openStatement(as, ev.id);
    const st3 = await stmt(s, third);
    expect(Number(st3.refunds_cents)).toBe(0);
    expect(Number(st3.net_owed_cents)).toBe(0);
    await cleanup(s, org.id, users);
  });

  it("allows only one open statement per event", async () => {
    const { s, as, org, ev, users } = await fixture("uniq", 1);
    await as.rpc("payout_open_statement", { p_event_id: ev.id });
    const second = await as.rpc("payout_open_statement", { p_event_id: ev.id });
    expect(second.error).toBeTruthy();
    await cleanup(s, org.id, users);
  });

  it("mark_paid is idempotent", async () => {
    const { s, as, org, ev, users } = await fixture("idem", 1);
    const id = await openStatement(as, ev.id);
    expect((await as.rpc("payout_mark_paid", { p_statement_id: id, p_reference: "A", p_note: null })).data).toBe("paid");
    expect((await as.rpc("payout_mark_paid", { p_statement_id: id, p_reference: "B", p_note: null })).data).toBe("already");
    await cleanup(s, org.id, users);
  });

  it("refuses a caller who is not a super admin", async () => {
    const { s, org, ev, users } = await fixture("authz", 1);
    // An ORG admin of this very org — legitimate staff, but settlement is a
    // platform capability. The UI hides it; this proves the database does too.
    const stamp = `orgadmin-${Date.now()}`;
    const email = `${stamp}@test.dev`;
    const u = await s.auth.admin.createUser({ email, password: "password123", email_confirm: true });
    await s.from("user_roles").insert({ user_id: u.data.user!.id, role: "admin", org_id: org.id });
    const asOrgAdmin = await signedInAs(email);

    const r = await asOrgAdmin.rpc("payout_open_statement", { p_event_id: ev.id });
    expect(r.error).toBeTruthy();

    await s.auth.admin.deleteUser(u.data.user!.id);
    await cleanup(s, org.id, users);
  });
});
