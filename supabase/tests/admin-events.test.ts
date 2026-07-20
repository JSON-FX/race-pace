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
const RWP = "00000000-0000-0000-0000-0000000000a1";
const APO = "00000000-0000-0000-0000-0000000000a2";

describe("admin event writes", () => {
  it("an org admin creates/edits their org's event + children; other-org admin cannot", async () => {
    const svc = service();
    const admin = await makeUser(`ev_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const other = await makeUser(`ev_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO });

    // admin inserts a draft event for RWP
    const ins = await authed(admin.token).from("events").insert({ org_id: RWP, name: "Plan10 Race", status: "draft" }).select().single();
    expect(ins.error).toBeNull();
    const evId = ins.data!.id;
    // update it
    const upd = await authed(admin.token).from("events").update({ name: "Plan10 Race v2" }).eq("id", evId).select();
    expect(upd.data).toHaveLength(1);
    // child category + addon
    const cat = await authed(admin.token).from("categories").insert({ org_id: RWP, event_id: evId, code: "21k", label: "21K", base_price: 150000, slots_total: 100 }).select().single();
    expect(cat.error).toBeNull();
    const add = await authed(admin.token).from("addons").insert({ org_id: RWP, event_id: evId, name: "Singlet", price: 65000 }).select();
    expect(add.data).toHaveLength(1);

    // other-org admin cannot update RWP's event, nor add a category to it
    const hack = await authed(other.token).from("events").update({ name: "hacked" }).eq("id", evId).select();
    expect(hack.data ?? []).toEqual([]);
    const hackCat = await authed(other.token).from("categories").insert({ org_id: APO, event_id: evId, code: "x", label: "x", base_price: 0, slots_total: 0 }).select();
    expect(hackCat.error).not.toBeNull();

    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
    await svc.from("events").delete().eq("id", evId); // cascades children
  });

  it("delete: draft event deletes; non-draft blocked; category-with-registration blocked", async () => {
    const svc = service();
    const admin = await makeUser(`ev_del_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });

    // draft delete OK
    const draft = await svc.from("events").insert({ org_id: RWP, name: "DraftDel", status: "draft" }).select().single();
    const delDraft = await authed(admin.token).from("events").delete().eq("id", draft.data!.id).select();
    expect(delDraft.data).toHaveLength(1);

    // non-draft delete blocked (policy gates to draft => 0 rows)
    const open = await svc.from("events").insert({ org_id: RWP, name: "OpenDel", status: "open" }).select().single();
    const delOpen = await authed(admin.token).from("events").delete().eq("id", open.data!.id).select();
    expect(delOpen.data ?? []).toEqual([]);

    // category with a registration: delete blocked by FK
    const cat = await svc.from("categories").insert({ org_id: RWP, event_id: open.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 }).select().single();
    const runner = await makeUser(`ev_run_${Date.now()}@test.dev`);
    await svc.from("registrations").insert({ org_id: RWP, event_id: open.data!.id, category_id: cat.data!.id, user_id: runner.id, total_amount: 100000 });
    const delCat = await authed(admin.token).from("categories").delete().eq("id", cat.data!.id).select();
    expect(delCat.error).not.toBeNull(); // FK restrict

    await svc.from("registrations").delete().eq("event_id", open.data!.id);
    await svc.from("events").delete().in("id", [open.data!.id]);
    await svc.from("user_roles").delete().eq("user_id", admin.id);
  });

  it("a runner (no admin role) cannot create an event", async () => {
    const runner = await makeUser(`ev_norole_${Date.now()}@test.dev`);
    const ins = await authed(runner.token).from("events").insert({ org_id: RWP, name: "nope", status: "draft" }).select();
    expect(ins.error).not.toBeNull();
  });
});
