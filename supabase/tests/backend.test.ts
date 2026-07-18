import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("organizations RLS", () => {
  it("anon can read an active org but not an inactive one", async () => {
    const svc = service();
    const active = await svc.from("organizations").insert({ name: "Active Org", slug: "active-org" }).select().single();
    const inactive = await svc.from("organizations").insert({ name: "Hidden Org", slug: "hidden-org", is_active: false }).select().single();
    expect(active.error).toBeNull();

    const { data } = await anon().from("organizations").select("slug");
    const slugs = (data ?? []).map((o) => o.slug);
    expect(slugs).toContain("active-org");
    expect(slugs).not.toContain("hidden-org");

    await svc.from("organizations").delete().in("id", [active.data!.id, inactive.data!.id]);
  });
});

describe("events catalog RLS", () => {
  it("hides draft events from anon, shows open ones", async () => {
    const svc = service();
    const org = await svc.from("organizations").insert({ name: "Cat Org", slug: "cat-org" }).select().single();
    const draft = await svc.from("events").insert({ org_id: org.data!.id, name: "Draft Race", status: "draft" }).select().single();
    const open = await svc.from("events").insert({ org_id: org.data!.id, name: "Open Race", status: "open" }).select().single();

    const { data } = await anon().from("events").select("name");
    const names = (data ?? []).map((e) => e.name);
    expect(names).toContain("Open Race");
    expect(names).not.toContain("Draft Race");

    await svc.from("events").delete().in("id", [draft.data!.id, open.data!.id]);
    await svc.from("organizations").delete().eq("id", org.data!.id);
  });
});

async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}

describe("registrations RLS", () => {
  it("a user reads only their own registration", async () => {
    const svc = service();
    const org = await svc.from("organizations").insert({ name: "Reg Org", slug: "reg-org" }).select().single();
    const ev = await svc.from("events").insert({ org_id: org.data!.id, name: "Reg Race", status: "open" }).select().single();
    const cat = await svc.from("categories").insert({ org_id: org.data!.id, event_id: ev.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 }).select().single();

    const alice = await makeUser(`alice_${Date.now()}@test.dev`);
    const bob = await makeUser(`bob_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({ org_id: org.data!.id, event_id: ev.data!.id, category_id: cat.data!.id, user_id: alice.id, total_amount: 100000 }).select().single();

    const asAlice = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${alice.token}` } }, auth: { persistSession: false } });
    const asBob = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${bob.token}` } }, auth: { persistSession: false } });

    const aliceView = await asAlice.from("registrations").select("id").eq("id", reg.data!.id);
    const bobView = await asBob.from("registrations").select("id").eq("id", reg.data!.id);
    expect(aliceView.data).toHaveLength(1);
    expect(bobView.data).toHaveLength(0); // RLS hides Alice's row from Bob

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(alice.id);
    await svc.auth.admin.deleteUser(bob.id);
    await svc.from("organizations").delete().eq("id", org.data!.id);
  });
});

describe("seed", () => {
  it("exposes the seeded org, event, and 4 categories to anon", async () => {
    const a = anon();
    const org = await a.from("organizations").select("slug").eq("slug", "run-with-point").single();
    expect(org.data?.slug).toBe("run-with-point");
    const cats = await a.from("categories").select("code").eq("event_id", "00000000-0000-0000-0000-0000000000e1");
    expect((cats.data ?? []).map((c) => c.code).sort()).toEqual(["100k", "10k", "21k", "50k"]);
  });
});
