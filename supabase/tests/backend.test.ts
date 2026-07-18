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
