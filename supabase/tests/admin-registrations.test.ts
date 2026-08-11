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
// Resolved from the seed rather than restated — see test/seeded.ts.
let RWP: string, APO: string, E1: string, C4: string;
beforeAll(async () => {
  ({ ORG_A: RWP, ORG_B: APO, EVENT_A: E1, CATEGORY_A: C4 } = await seededIds());
});

describe("admin registration reads", () => {
  it("an org admin reads its org's registrations/addons/payments + registrant profiles; other-org admin cannot; runner reads only own", async () => {
    const svc = service();
    const admin = await makeUser(`rr_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const other = await makeUser(`rr_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO });
    const runner = await makeUser(`rr_run_${Date.now()}@test.dev`);
    const stranger = await makeUser(`rr_str_${Date.now()}@test.dev`); // profile, but no registration in RWP
    await svc.from("profiles").insert({ id: runner.id, full_name: "Runner One", bib_name: "RUN1" });
    await svc.from("profiles").insert({ id: stranger.id, full_name: "Stranger" });

    const reg = await svc.from("registrations").insert({ org_id: RWP, event_id: E1, category_id: C4, user_id: runner.id, status: "paid", total_amount: 100000 }).select().single();
    await svc.from("payments").insert({ org_id: RWP, registration_id: reg.data!.id, amount: 100000, status: "paid" });
    await svc.from("registration_addons").insert({ registration_id: reg.data!.id, addon_id: "00000000-0000-0000-0000-0000000000d1", price: 60000 });

    // org admin sees the whole graph for its org
    expect((await authed(admin.token).from("registrations").select("id").eq("id", reg.data!.id)).data).toHaveLength(1);
    expect((await authed(admin.token).from("payments").select("registration_id").eq("registration_id", reg.data!.id)).data).toHaveLength(1);
    expect((await authed(admin.token).from("registration_addons").select("addon_id").eq("registration_id", reg.data!.id)).data).toHaveLength(1);
    expect((await authed(admin.token).from("profiles").select("id").eq("id", runner.id)).data).toHaveLength(1);
    // ...but NOT a profile of someone who never registered in its org
    expect((await authed(admin.token).from("profiles").select("id").eq("id", stranger.id)).data ?? []).toHaveLength(0);

    // other-org admin sees none of it
    expect((await authed(other.token).from("registrations").select("id").eq("id", reg.data!.id)).data ?? []).toHaveLength(0);
    expect((await authed(other.token).from("payments").select("registration_id").eq("registration_id", reg.data!.id)).data ?? []).toHaveLength(0);
    expect((await authed(other.token).from("profiles").select("id").eq("id", runner.id)).data ?? []).toHaveLength(0);
    expect((await authed(other.token).from("registration_addons").select("addon_id").eq("registration_id", reg.data!.id)).data ?? []).toHaveLength(0);

    // runner still reads only their own registration (read_own intact)
    expect((await authed(runner.token).from("registrations").select("id").eq("id", reg.data!.id)).data).toHaveLength(1);

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    await svc.from("profiles").delete().in("id", [runner.id, stranger.id]);
    for (const u of [admin, other, runner, stranger]) await svc.auth.admin.deleteUser(u.id);
  });

  it("decrement_slot is service-role only and floors slots_taken at 0", async () => {
    const svc = service();
    const runner = await makeUser(`ds_run_${Date.now()}@test.dev`);
    // a non-service (authenticated) caller cannot execute the function
    const denied = await authed(runner.token).rpc("decrement_slot", { p_category_id: C4 });
    expect(denied.error).not.toBeNull();
    // the service role can, and it floors slots_taken at 0
    const before = await svc.from("categories").select("slots_taken").eq("id", C4).single();
    const ok = await svc.rpc("decrement_slot", { p_category_id: C4 });
    expect(ok.error).toBeNull();
    const after = await svc.from("categories").select("slots_taken").eq("id", C4).single();
    expect(after.data!.slots_taken).toBe(Math.max(0, before.data!.slots_taken - 1));
    await svc.auth.admin.deleteUser(runner.id);
  });
});
