import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

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

describe("notifications table", () => {
  it("is owner-scoped: a user reads only their own rows and can mark them read", async () => {
    const svc = service();
    const me = await makeUser(`ntf_me_${Date.now()}@test.dev`);
    const other = await makeUser(`ntf_ot_${Date.now()}@test.dev`);
    const ins = await svc.from("notifications").insert({
      user_id: me.id, type: "registered", title: "hi", body: "b", data: {},
    }).select().single();
    expect(ins.error).toBeNull();

    // owner reads it; other user does not
    expect((await authed(me.token).from("notifications").select("id").eq("id", ins.data!.id)).data).toHaveLength(1);
    expect((await authed(other.token).from("notifications").select("id").eq("id", ins.data!.id)).data ?? []).toHaveLength(0);

    // owner can set read_at on their own row
    const upd = await authed(me.token).from("notifications").update({ read_at: new Date().toISOString() }).eq("id", ins.data!.id);
    expect(upd.error).toBeNull();
    // a client cannot INSERT (no insert grant/policy)
    const badInsert = await authed(me.token).from("notifications").insert({ user_id: me.id, type: "paid", title: "x", body: "y", data: {} });
    expect(badInsert.error).not.toBeNull();

    await svc.from("notifications").delete().eq("id", ins.data!.id);
    for (const u of [me, other]) await svc.auth.admin.deleteUser(u.id);
  });
});

describe("device_tokens table", () => {
  it("lets a user upsert and read only their own token", async () => {
    const svc = service();
    const me = await makeUser(`dt_me_${Date.now()}@test.dev`);
    const tok = `ExponentPushToken[${Date.now()}]`;
    const up = await authed(me.token).from("device_tokens").upsert(
      { user_id: me.id, token: tok, platform: "ios" }, { onConflict: "token" });
    expect(up.error).toBeNull();
    expect((await authed(me.token).from("device_tokens").select("token").eq("token", tok)).data).toHaveLength(1);
    await svc.from("device_tokens").delete().eq("token", tok);
    await svc.auth.admin.deleteUser(me.id);
  });
});
