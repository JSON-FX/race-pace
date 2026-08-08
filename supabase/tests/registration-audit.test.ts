import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function fixture(tag: string) {
  const s = svc();
  const email = `audit_${tag}_${Date.now()}@test.dev`;
  const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
  const org = (await s.from("organizations").insert({ name: "Audit Org", slug: `au-${tag}-${Date.now()}` }).select().single()).data!;
  const ev = (await s.from("events").insert({ org_id: org.id, name: "Audit Race", status: "open" }).select().single()).data!;
  const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
  const reg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid, total_amount: 100000, status: "paid", custom_data: { shirt_size: "M" } }).select().single()).data!;
  return { s, uid, email, org, ev, reg };
}

async function cleanup(s: ReturnType<typeof svc>, orgId: string, uid: string) {
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

describe("registration_audit", () => {
  it("stores an append-only row with actor and jsonb detail", async () => {
    const { s, uid, org, ev, reg } = await fixture("shape");
    const { data, error } = await s.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "field_changed", detail: { field: "shirt_size", from: "M", to: "L" },
      actor_id: uid, actor_role: "runner",
    }).select().single();
    expect(error).toBeNull();
    expect(data!.detail).toEqual({ field: "shirt_size", from: "M", to: "L" });
    expect(data!.created_at).toBeTruthy();
    await cleanup(s, org.id, uid);
  });

  it("lets the owning runner read their own rows but not insert", async () => {
    const { s, uid, email, org, ev, reg } = await fixture("rls");
    await s.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "field_changed", detail: { field: "shirt_size", from: "M", to: "L" },
      actor_id: uid, actor_role: "runner",
    });

    const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
    await asUser.auth.signInWithPassword({ email, password: "password123" });

    const read = await asUser.from("registration_audit").select("*").eq("registration_id", reg.id);
    expect(read.error).toBeNull();
    expect(read.data!.length).toBe(1);

    const write = await asUser.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "field_changed", detail: {}, actor_id: uid, actor_role: "runner",
    });
    expect(write.error).not.toBeNull();

    await cleanup(s, org.id, uid);
  });

  it("cascades away when the registration is deleted", async () => {
    const { s, uid, org, ev, reg } = await fixture("cascade");
    await s.from("registration_audit").insert({
      registration_id: reg.id, org_id: org.id, event_id: ev.id,
      action: "paid", detail: {}, actor_role: "system",
    });
    await s.from("registrations").delete().eq("id", reg.id);
    const rows = await s.from("registration_audit").select("id").eq("registration_id", reg.id);
    expect(rows.data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });
});
