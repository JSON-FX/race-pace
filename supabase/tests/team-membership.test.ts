import { afterAll, beforeAll, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
const { url, anonKey, serviceKey } = loadEnv();
const service = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
const ck = <T>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};
let org: string,
  otherOrg: string,
  event: string,
  otherEvent: string,
  owner: string,
  staff: string;
const users: string[] = [];
let staffClient = createClient(url, anonKey, {
  auth: { persistSession: false },
});
async function user() {
  const email = `team-scope-${crypto.randomUUID()}@example.com`;
  const u = ck(
    await service.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    }),
  ).user!;
  users.push(u.id);
  return { id: u.id, email };
}
const write = (extra: Record<string, unknown> = {}) =>
  service
    .rpc("team_member_write_tx", {
      p_org_id: org,
      p_actor_id: owner,
      p_user_id: staff,
      p_role: "claiming",
      p_event_scope: event,
      p_replace_scope: true,
      ...extra,
    })
    .then(ck);
beforeAll(async () => {
  org = ck(
    await service
      .from("organizations")
      .insert({ name: "Team scope QA", slug: crypto.randomUUID() })
      .select("id")
      .single(),
  ).id;
  otherOrg = ck(
    await service
      .from("organizations")
      .insert({ name: "Other team QA", slug: crypto.randomUUID() })
      .select("id")
      .single(),
  ).id;
  event = ck(
    await service
      .from("events")
      .insert({ org_id: org, name: "Assigned" })
      .select("id")
      .single(),
  ).id;
  otherEvent = ck(
    await service
      .from("events")
      .insert({ org_id: otherOrg, name: "Foreign" })
      .select("id")
      .single(),
  ).id;
  ck(await service.from("events").insert({org_id:org,name:"Unassigned same-org event"}));
  const a = await user(),
    s = await user();
  owner = a.id;
  staff = s.id;
  ck(
    await service
      .from("user_roles")
      .insert({ org_id: org, user_id: owner, role: "admin" }),
  );
  ck(
    await staffClient.auth.signInWithPassword({
      email: s.email,
      password: "password123",
    }),
  );
});
afterAll(async () => {
  for (const id of [org, otherOrg])
    if (id) ck(await service.from("organizations").delete().eq("id", id));
  for (const id of users) ck(await service.auth.admin.deleteUser(id));
});
it("assigns only the selected event and preserves omitted scope", async () => {
  expect(await write()).toMatchObject({ ok: true, event_scope: event });
  expect(ck(await staffClient.rpc("kit_release_events"))).toMatchObject([
    { id: event },
  ]);
  expect(
    await write({
      p_role: "marshal",
      p_replace_scope: false,
      p_event_scope: null,
    }),
  ).toMatchObject({ ok: true, event_scope: event });
  expect(ck(await staffClient.rpc("checkin_events"))).toMatchObject([
    { id: event },
  ]);
});
it("rejects foreign scope and unsupported role without losing existing access", async () => {
  expect(await write({ p_event_scope: otherEvent })).toMatchObject({
    error: "invalid_event_scope",
  });
  expect(await write({ p_role: "admin" })).toMatchObject({
    error: "invalid_event_scope",
  });
  expect(
    await write({ p_role: "super_admin", p_event_scope: null }),
  ).toMatchObject({ error: "bad_role" });
  const rows = ck(
    await service
      .from("user_roles")
      .select("role,event_scope")
      .eq("user_id", staff),
  );
  expect(rows).toMatchObject([{ role: "marshal", event_scope: event }]);
});
it("requires service callers and a verified organization administrator", async () => {
  expect(
    (
      await staffClient.rpc("team_member_write_tx", {
        p_org_id: org,
        p_actor_id: owner,
        p_user_id: staff,
        p_role: "admin",
      })
    ).error,
  ).toBeTruthy();
  expect(await write({ p_actor_id: staff })).toMatchObject({
    error: "forbidden",
  });
});
it("serializes simultaneous last-admin demotions", async () => {
  expect(await write({ p_role: "admin", p_event_scope: null })).toMatchObject({
    ok: true,
  });
  // Both requests use the owner actor. Either demotion wins, but the second cannot leave zero admins.
  const results = await Promise.all([
    write({ p_user_id: owner, p_role: "marshal", p_event_scope: null }),
    write({ p_user_id: staff, p_role: "marshal", p_event_scope: null }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(
    results.some((r) => r.error === "last_admin" || r.error === "forbidden"),
  ).toBe(true);
  const admins = ck(
    await service
      .from("user_roles")
      .select("user_id")
      .eq("org_id", org)
      .eq("role", "admin"),
  );
  expect(admins).toHaveLength(1);
  owner = admins![0].user_id;
  staff = users.find((id) => id !== owner)!;
});
it("removal immediately revokes an existing session", async () => {
  // Restore the original staff account so the authenticated session is the subject of revocation.
  const staffUser = ck(await staffClient.auth.getUser()).user!.id;
  if (owner === staffUser) {
    ck(
      await service
        .from("user_roles")
        .insert({ org_id: org, user_id: users[0], role: "admin" }),
    );
    owner = users[0];
  }
  expect(
    await write({
      p_user_id: staffUser,
      p_role: "claiming",
      p_event_scope: event,
    }),
  ).toMatchObject({ ok: true });
  expect(ck(await staffClient.rpc("kit_release_events"))).toHaveLength(1);
  expect(await write({ p_user_id: staffUser, p_role: null })).toMatchObject({
    ok: true,
  });
  expect(ck(await staffClient.rpc("kit_release_events"))).toHaveLength(0);
});
