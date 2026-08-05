import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });

// Self-contained fixtures in the hosted project; destroyed in afterAll.
// Because the org is created here, the totals are EXACT — no >= fudging against
// whatever else happens to live in the database.
const TAG = `dvtest${Date.now()}`;
const userIds: string[] = [];
const orgIds: string[] = [];

async function makeUser(label: string) {
  const email = `${TAG}_${label}@test.dev`;
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (c.error) throw c.error;
  userIds.push(c.data.user!.id);
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  if (s.error) throw s.error;
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}

async function makeOrg(label: string): Promise<string> {
  const r = await svc.from("organizations")
    .insert({ name: `${TAG} ${label}`, slug: `${TAG}-${label}` }).select("id").single();
  if (r.error) throw r.error;
  orgIds.push(r.data.id);
  return r.data.id;
}

let ctx: {
  orgA: string; orgB: string; eventA: string;
  admin: { token: string }; other: { token: string };
};

beforeAll(async () => {
  const orgA = await makeOrg("orga");
  const orgB = await makeOrg("orgb");

  const ev = await svc.from("events").insert({ org_id: orgA, name: `${TAG} Event A` }).select("id").single();
  if (ev.error) throw ev.error;
  const eventA = ev.data.id;

  const cat = await svc.from("categories")
    .insert({ org_id: orgA, event_id: eventA, code: "10k", label: "10K", base_price: 100000 })
    .select("id").single();
  if (cat.error) throw cat.error;

  const admin = await makeUser("admin");
  await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: orgA });
  const other = await makeUser("other");
  await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: orgB });

  const mk = async (label: string, status: "paid" | "pending", amount: number) => {
    const runner = await makeUser(label);
    await svc.from("profiles").insert({ id: runner.id, full_name: `R ${amount}` });
    const reg = await svc.from("registrations").insert({
      org_id: orgA, event_id: eventA, category_id: cat.data.id, user_id: runner.id, status, total_amount: amount,
    }).select("id").single();
    if (reg.error) throw reg.error;
    await svc.from("payments").insert({
      org_id: orgA, registration_id: reg.data.id, amount,
      platform_fee: amount / 10, net_to_org: amount - amount / 10, method: "gcash", status,
    });
  };
  await mk("p1", "paid", 100000);
  await mk("p2", "paid", 200000);
  await mk("p3", "pending", 50000);

  ctx = { orgA, orgB, eventA, admin, other };
}, 60_000);

afterAll(async () => {
  for (const id of userIds) await svc.auth.admin.deleteUser(id);
  for (const id of orgIds) await svc.from("organizations").delete().eq("id", id);
}, 60_000);

describe("dashboard totals views", () => {
  it("sums only paid money, and counts pending without summing it", async () => {
    const res = await authed(ctx.admin.token)
      .from("admin_org_totals_v").select("*").eq("org_id", ctx.orgA).single();
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({
      reg_count: 3, paid_count: 2, pending_count: 1,
      gross_revenue: 300000, net_to_org: 270000, platform_fee: 30000,
    });
  });

  it("aggregates per event", async () => {
    const res = await authed(ctx.admin.token)
      .from("admin_event_totals_v").select("*").eq("event_id", ctx.eventA).single();
    expect(res.data).toMatchObject({ reg_count: 3, gross_revenue: 300000 });
  });

  it("leaks neither rows nor counts to another org", async () => {
    const org = await authed(ctx.other.token)
      .from("admin_org_totals_v").select("*", { count: "exact" }).eq("org_id", ctx.orgA);
    expect(org.data ?? []).toHaveLength(0);
    expect(org.count ?? 0).toBe(0);

    const event = await authed(ctx.other.token)
      .from("admin_event_totals_v").select("*", { count: "exact" }).eq("event_id", ctx.eventA);
    expect(event.data ?? []).toHaveLength(0);
    expect(event.count ?? 0).toBe(0);
  });
});
