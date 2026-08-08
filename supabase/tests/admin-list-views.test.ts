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

// Resolved from the seed rather than restated — see test/seeded.ts for why
// the old hardcoded constants silently became dangling foreign keys.
let RWP: string, APO: string, E1: string, C4: string;
beforeAll(async () => {
  ({ ORG_A: RWP, ORG_B: APO, EVENT_A: E1, CATEGORY_A: C4 } = await seededIds());
});

describe("admin list views", () => {
  it("flatten the join for the owning org and leak neither rows nor counts to another org", async () => {
    const svc = service();
    const admin = await makeUser(`av_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const other = await makeUser(`av_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO });
    const runner = await makeUser(`av_run_${Date.now()}@test.dev`);
    await svc.from("profiles").insert({ id: runner.id, full_name: "Ana Cruz", bib_name: "ANA" });
    // A true bystander: no user_roles row anywhere, no registration in any org.
    const bystander = await makeUser(`av_bys_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations")
      .insert({ org_id: RWP, event_id: E1, category_id: C4, user_id: runner.id, status: "paid", total_amount: 100000 })
      .select().single();
    await svc.from("payments").insert({ org_id: RWP, registration_id: reg.data!.id, amount: 100000, platform_fee: 10000, net_to_org: 90000, method: "gcash", status: "paid" });

    // The owning admin sees a flat row with the joined-in names.
    const pay = await authed(admin.token).from("admin_payments_v").select("*").eq("registration_id", reg.data!.id).single();
    expect(pay.data).toMatchObject({ full_name: "Ana Cruz", net_to_org: 90000, status: "paid", org_id: RWP });
    expect(pay.data!.event_name).toBeTruthy();

    const row = await authed(admin.token).from("admin_registrations_v").select("*").eq("id", reg.data!.id).single();
    expect(row.data).toMatchObject({ full_name: "Ana Cruz", bib_name: "ANA", payment_status: "paid", payment_method: "gcash" });
    expect(row.data!.category_label).toBeTruthy();

    // Server-side paging primitives work.
    const paged = await authed(admin.token).from("admin_registrations_v")
      .select("id", { count: "exact" }).eq("event_id", E1).order("created_at", { ascending: false }).range(0, 0);
    expect(paged.data).toHaveLength(1);
    expect(paged.count).toBeGreaterThanOrEqual(1);

    // Server-side search on the runner name — impossible before these views.
    const searched = await authed(admin.token).from("admin_registrations_v").select("id").eq("event_id", E1).ilike("full_name", "%ana%");
    expect((searched.data ?? []).map((r) => r.id)).toContain(reg.data!.id);

    // The other org sees no rows AND a zero count through every view.
    const otherPay = await authed(other.token).from("admin_payments_v").select("registration_id", { count: "exact" }).eq("registration_id", reg.data!.id);
    expect(otherPay.data ?? []).toHaveLength(0);
    expect(otherPay.count ?? 0).toBe(0);

    const otherReg = await authed(other.token).from("admin_registrations_v").select("id", { count: "exact" }).eq("id", reg.data!.id);
    expect(otherReg.data ?? []).toHaveLength(0);
    expect(otherReg.count ?? 0).toBe(0);

    const otherCounts = await authed(other.token).from("admin_event_reg_counts_v").select("*").eq("event_id", E1);
    expect(otherCounts.data ?? []).toHaveLength(0);

    // The registrant sees exactly their own row through the security-invoker views — this is
    // `payments_read_own` / `registrations_read_own` flowing through, same as querying the base
    // tables directly. It is not a cross-org leak (compare to the `other`-org checks above, which
    // stay at zero); it's a pinned property so a future change that accidentally makes these views
    // admin-only, or leaks wider than the base RLS already allows, gets caught either way.
    const runnerPay = await authed(runner.token).from("admin_payments_v").select("registration_id", { count: "exact" }).eq("registration_id", reg.data!.id);
    expect(runnerPay.data ?? []).toHaveLength(1);
    expect(runnerPay.count ?? 0).toBe(1);

    const runnerReg = await authed(runner.token).from("admin_registrations_v").select("id", { count: "exact" }).eq("id", reg.data!.id);
    expect(runnerReg.data ?? []).toHaveLength(1);
    expect(runnerReg.count ?? 0).toBe(1);

    // A true bystander — no user_roles row anywhere, no registration in any org — sees nothing
    // and gets a zero count through every view.
    const bystanderPay = await authed(bystander.token).from("admin_payments_v").select("registration_id", { count: "exact" }).eq("registration_id", reg.data!.id);
    expect(bystanderPay.data ?? []).toHaveLength(0);
    expect(bystanderPay.count ?? 0).toBe(0);

    const bystanderReg = await authed(bystander.token).from("admin_registrations_v").select("id", { count: "exact" }).eq("id", reg.data!.id);
    expect(bystanderReg.data ?? []).toHaveLength(0);
    expect(bystanderReg.count ?? 0).toBe(0);

    const bystanderCounts = await authed(bystander.token).from("admin_event_reg_counts_v").select("*").eq("event_id", E1);
    expect(bystanderCounts.data ?? []).toHaveLength(0);

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    await svc.from("profiles").delete().eq("id", runner.id);
  });
});
