import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (token: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}
const RWP = "00000000-0000-0000-0000-0000000000a1";
const APO = "00000000-0000-0000-0000-0000000000a2"; // Apo Skyrunners — second seeded org, for negative cases

describe("user_roles RLS", () => {
  it("a user reads only their own role rows", async () => {
    const svc = service();
    const alice = await makeUser(`ur_alice_${Date.now()}@test.dev`);
    const bob = await makeUser(`ur_bob_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert([
      { user_id: alice.id, role: "admin", org_id: RWP },
      { user_id: bob.id, role: "admin", org_id: RWP },
    ]);

    const { data } = await authed(alice.token).from("user_roles").select("user_id, role");
    expect(data).toEqual([{ user_id: alice.id, role: "admin" }]);

    await svc.from("user_roles").delete().in("user_id", [alice.id, bob.id]);
  });
});

describe("role helper functions", () => {
  it("editor on RWP: is not super admin, can admin RWP", async () => {
    const svc = service();
    const editor = await makeUser(`role_editor_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: editor.id, role: "editor", org_id: RWP });

    const client = authed(editor.token);
    const isSuperAdmin = await client.rpc("auth_is_super_admin");
    const canAdminRwp = await client.rpc("auth_can_admin_org", { target: RWP });
    expect(isSuperAdmin.data).toBe(false);
    expect(canAdminRwp.data).toBe(true);

    await svc.from("user_roles").delete().eq("user_id", editor.id);
  });

  it("super_admin (org_id null): is super admin, can admin RWP anyway", async () => {
    const svc = service();
    const superAdmin = await makeUser(`role_super_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: superAdmin.id, role: "super_admin", org_id: null });

    const client = authed(superAdmin.token);
    const isSuperAdmin = await client.rpc("auth_is_super_admin");
    const canAdminRwp = await client.rpc("auth_can_admin_org", { target: RWP });
    expect(isSuperAdmin.data).toBe(true);
    expect(canAdminRwp.data).toBe(true);

    await svc.from("user_roles").delete().eq("user_id", superAdmin.id);
  });

  it("admin on a different org (Apo Skyrunners): cannot admin RWP", async () => {
    const svc = service();
    const otherOrgAdmin = await makeUser(`role_other_admin_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: otherOrgAdmin.id, role: "admin", org_id: APO });

    const client = authed(otherOrgAdmin.token);
    const canAdminRwp = await client.rpc("auth_can_admin_org", { target: RWP });
    expect(canAdminRwp.data).toBe(false);

    await svc.from("user_roles").delete().eq("user_id", otherOrgAdmin.id);
  });

  it("no role at all: is not super admin, cannot admin RWP", async () => {
    const noRole = await makeUser(`role_none_${Date.now()}@test.dev`);

    const client = authed(noRole.token);
    const isSuperAdmin = await client.rpc("auth_is_super_admin");
    const canAdminRwp = await client.rpc("auth_can_admin_org", { target: RWP });
    expect(isSuperAdmin.data).toBe(false);
    expect(canAdminRwp.data).toBe(false);
  });
});
