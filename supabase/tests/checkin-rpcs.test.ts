import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });

// Everything below is created by this file and destroyed in afterAll. The real
// org (…a1) and its events are never touched.
const TAG = `citest${Date.now()}`;
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

async function makeEvent(orgId: string, name: string): Promise<string> {
  const r = await svc.from("events").insert({ org_id: orgId, name: `${TAG} ${name}` }).select("id").single();
  if (r.error) throw r.error;
  return r.data.id;
}

async function makeCategory(orgId: string, eventId: string): Promise<string> {
  const r = await svc.from("categories")
    .insert({ org_id: orgId, event_id: eventId, code: "10k", label: "10K", base_price: 100000 })
    .select("id").single();
  if (r.error) throw r.error;
  return r.data.id;
}

async function makeRunner(label: string, name: string, bib: string) {
  const u = await makeUser(label);
  await svc.from("profiles").insert({ id: u.id, full_name: name, bib_name: bib });
  return u;
}

type Ctx = {
  orgA: string; orgB: string; eventA: string; eventA2: string; eventB: string; catA: string;
  marshal: { token: string }; otherAdmin: { token: string }; plain: { token: string }; scoped: { token: string };
  editor: { token: string }; admin: { token: string }; superAdmin: { token: string };
  paidReg: string; pendingReg: string; checkedReg: string;
};
let ctx: Ctx;

beforeAll(async () => {
  const orgA = await makeOrg("orga");
  const orgB = await makeOrg("orgb");
  const eventA = await makeEvent(orgA, "Event A");
  const eventA2 = await makeEvent(orgA, "Event A2");     // proves event_scope narrows
  const eventB = await makeEvent(orgB, "Event B");
  const catA = await makeCategory(orgA, eventA);

  const marshal = await makeUser("marshal");
  await svc.from("user_roles").insert({ user_id: marshal.id, role: "marshal", org_id: orgA });

  const otherAdmin = await makeUser("otheradmin");
  await svc.from("user_roles").insert({ user_id: otherAdmin.id, role: "admin", org_id: orgB });

  const plain = await makeUser("plain");

  const scoped = await makeUser("scoped");
  await svc.from("user_roles")
    .insert({ user_id: scoped.id, role: "marshal", org_id: orgA, event_scope: eventA });

  // The allowed role set is marshal | editor | admin | super_admin — exercise
  // every one of them, not just marshal, so dropping a role from the SQL (or
  // adding one to canCheckIn() without updating the SQL) fails a test.
  const editor = await makeUser("editor");
  await svc.from("user_roles").insert({ user_id: editor.id, role: "editor", org_id: orgA });

  const admin = await makeUser("admin");
  await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: orgA });

  const superAdmin = await makeUser("superadmin");
  await svc.from("user_roles").insert({ user_id: superAdmin.id, role: "super_admin", org_id: null });

  const reg = async (label: string, name: string, bib: string, status: string, token: string) => {
    const runner = await makeRunner(label, name, bib);
    const r = await svc.from("registrations").insert({
      org_id: orgA, event_id: eventA, category_id: catA, user_id: runner.id,
      status, total_amount: 100000, ticket_token: token, custom_data: { shirt: "M" },
    }).select("id").single();
    if (r.error) throw r.error;
    return r.data.id as string;
  };

  const paidReg = await reg("r1", "Ana Cruz", "ANA", "paid", `${TAG}_tok1`);
  const pendingReg = await reg("r2", "Ben Reyes", "BEN", "pending", `${TAG}_tok2`);
  const checkedReg = await reg("r3", "Cely Lim", "CEL", "paid", `${TAG}_tok3`);
  await svc.from("checkins").insert({ org_id: orgA, registration_id: checkedReg, event_id: eventA });

  ctx = {
    orgA, orgB, eventA, eventA2, eventB, catA,
    marshal, otherAdmin, plain, scoped, editor, admin, superAdmin,
    paidReg, pendingReg, checkedReg,
  };
}, 60_000);

// Users first: that cascades registrations → payments/checkins, and user_roles.
// Orgs second: that cascades events and categories, which registrations reference
// with NO ACTION and would otherwise block.
afterAll(async () => {
  for (const id of userIds) await svc.auth.admin.deleteUser(id);
  for (const id of orgIds) await svc.from("organizations").delete().eq("id", id);
}, 60_000);

describe("checkin_roster", () => {
  it("gives a marshal the roster fields and nothing else", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(res.error).toBeNull();
    const row = (res.data ?? []).find((r: any) => r.registration_id === ctx.paidReg);
    expect(row).toMatchObject({
      ticket_token: `${TAG}_tok1`, runner: "Ana Cruz", bib: "ANA", status: "paid", checked_in_at: null,
    });
    expect(row.category).toBe("10K");

    // The whole reason this is an RPC and not an RLS policy.
    expect(row).not.toHaveProperty("total_amount");
    expect(row).not.toHaveProperty("custom_data");
  });

  it("includes pending so the client can say 'not paid' rather than 'not found'", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    const row = (res.data ?? []).find((r: any) => r.registration_id === ctx.pendingReg);
    expect(row).toMatchObject({ status: "pending" });
  });

  it("reflects an existing check-in", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    const row = (res.data ?? []).find((r: any) => r.registration_id === ctx.checkedReg);
    expect(row.checked_in_at).not.toBeNull();
  });

  it("returns nothing to an admin of another org, or to a user with no role", async () => {
    const other = await authed(ctx.otherAdmin.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(other.error).toBeNull();
    expect(other.data ?? []).toHaveLength(0);
    const plain = await authed(ctx.plain.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(plain.error).toBeNull();
    expect(plain.data ?? []).toHaveLength(0);
  });

  it("gives an editor and an admin of the same org a non-empty roster", async () => {
    const editorRes = await authed(ctx.editor.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(editorRes.error).toBeNull();
    expect((editorRes.data ?? []).length).toBeGreaterThan(0);

    const adminRes = await authed(ctx.admin.token).rpc("checkin_roster", { p_event_id: ctx.eventA });
    expect(adminRes.error).toBeNull();
    expect((adminRes.data ?? []).length).toBeGreaterThan(0);
  });

  it("lets a super_admin read another org's roster without error", async () => {
    const res = await authed(ctx.superAdmin.token).rpc("checkin_roster", { p_event_id: ctx.eventB });
    expect(res.error).toBeNull();
  });
});

describe("checkin_events", () => {
  it("lists every event of the marshal's org", async () => {
    const res = await authed(ctx.marshal.token).rpc("checkin_events");
    const ids = (res.data ?? []).map((e: any) => e.id);
    expect(ids).toContain(ctx.eventA);
    expect(ids).toContain(ctx.eventA2);
    expect(ids).not.toContain(ctx.eventB);
  });

  it("narrows to a single event when event_scope is set", async () => {
    const res = await authed(ctx.scoped.token).rpc("checkin_events");
    const ids = (res.data ?? []).map((e: any) => e.id);
    expect(ids).toContain(ctx.eventA);
    expect(ids).not.toContain(ctx.eventA2);

    // …and the scoped marshal still cannot read the sibling event's roster.
    const sibling = await authed(ctx.scoped.token).rpc("checkin_roster", { p_event_id: ctx.eventA2 });
    expect(sibling.error).toBeNull();
    expect(sibling.data ?? []).toHaveLength(0);
  });

  it("returns nothing to a user with no role", async () => {
    const res = await authed(ctx.plain.token).rpc("checkin_events");
    expect(res.error).toBeNull();
    const ids = (res.data ?? []).map((e: any) => e.id);
    expect(ids).not.toContain(ctx.eventA);
    expect(ids).not.toContain(ctx.eventB);
  });

  it("lets a super_admin see events across orgs", async () => {
    const res = await authed(ctx.superAdmin.token).rpc("checkin_events");
    expect(res.error).toBeNull();
    const ids = (res.data ?? []).map((e: any) => e.id);
    expect(ids).toContain(ctx.eventB);
  });
});
