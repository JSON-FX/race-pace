import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

// Exception-safe: if an insert partway through fails, whatever this function already
// created is torn down here before rethrowing — the caller's try/finally only reaches
// cleanup() when fixture() itself returns successfully.
async function fixture(tag: string) {
  const s = svc();
  const email = `audit_${tag}_${Date.now()}@test.dev`;
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
    cleanups.push(() => s.auth.admin.deleteUser(uid));
    const org = (await s.from("organizations").insert({ name: "Audit Org", slug: `au-${tag}-${Date.now()}` }).select().single()).data!;
    cleanups.push(() => s.from("organizations").delete().eq("id", org.id));
    // status doesn't matter — these tests exercise registration_audit RLS via the
    // authenticated role, never an anon read of the event/category.
    const ev = (await s.from("events").insert({ org_id: org.id, name: "Audit Race", status: "draft" }).select().single()).data!;
    const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
    const reg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid, total_amount: 100000, status: "paid", custom_data: { shirt_size: "M" } }).select().single()).data!;
    return { s, uid, email, org, ev, cat, reg };
  } catch (err) {
    for (const fn of cleanups.reverse()) await fn();
    throw err;
  }
}

async function cleanup(s: ReturnType<typeof svc>, orgId: string, uid: string) {
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

describe("registration_audit", () => {
  it("stores an append-only row with actor and jsonb detail", async () => {
    const { s, uid, org, ev, reg } = await fixture("shape");
    try {
      const { data, error } = await s.from("registration_audit").insert({
        registration_id: reg.id, org_id: org.id, event_id: ev.id,
        action: "field_changed", detail: { field: "shirt_size", from: "M", to: "L" },
        actor_id: uid, actor_role: "runner",
      }).select().single();
      expect(error).toBeNull();
      expect(data!.detail).toEqual({ field: "shirt_size", from: "M", to: "L" });
      expect(data!.created_at).toBeTruthy();
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("lets the owning runner read their own rows but not insert", async () => {
    const { s, uid, email, org, ev, reg } = await fixture("rls");
    try {
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
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("cascades away when the registration is deleted", async () => {
    const { s, uid, org, ev, reg } = await fixture("cascade");
    try {
      await s.from("registration_audit").insert({
        registration_id: reg.id, org_id: org.id, event_id: ev.id,
        action: "paid", detail: {}, actor_role: "system",
      });
      await s.from("registrations").delete().eq("id", reg.id);
      const rows = await s.from("registration_audit").select("id").eq("registration_id", reg.id);
      expect(rows.data!.length).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("does not let a fellow org runner read another runner's audit rows", async () => {
    // B must be a genuine runner IN THE SAME ORG (own registration, same org_id) — not merely
    // an unaffiliated stranger. A stranger reads 0 rows under both the correct read-own policy
    // and a hypothetically-broken org-scoped one, so that setup can't distinguish secure from
    // vulnerable. A same-org runner can: under the real policy they still get 0 rows (they
    // don't own reg A), but under a broken "org membership" policy they'd leak reg A's rows.
    const { s, uid, org, ev, cat, reg } = await fixture("cross");
    let otherUid: string | undefined;
    try {
      await s.from("registration_audit").insert({
        registration_id: reg.id, org_id: org.id, event_id: ev.id,
        action: "field_changed", detail: { field: "shirt_size", from: "M", to: "L" },
        actor_id: uid, actor_role: "runner",
      });

      const otherEmail = `audit_cross_other_${Date.now()}@test.dev`;
      otherUid = (await s.auth.admin.createUser({ email: otherEmail, password: "password123", email_confirm: true })).data.user!.id;
      const otherReg = (await s.from("registrations").insert({ org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: otherUid, total_amount: 100000, status: "paid" }).select().single()).data!;
      await s.from("registration_audit").insert({
        registration_id: otherReg.id, org_id: org.id, event_id: ev.id,
        action: "field_changed", detail: { field: "shirt_size", from: "S", to: "M" },
        actor_id: otherUid, actor_role: "runner",
      });

      const asOther = createClient(url, anonKey, { auth: { persistSession: false } });
      await asOther.auth.signInWithPassword({ email: otherEmail, password: "password123" });

      const readOwn = await asOther.from("registration_audit").select("*").eq("registration_id", otherReg.id);
      expect(readOwn.error).toBeNull();
      expect(readOwn.data!.length).toBe(1); // proves the query itself isn't just silently broken

      const readOther = await asOther.from("registration_audit").select("*").eq("registration_id", reg.id);
      expect(readOther.error).toBeNull();
      expect(readOther.data!.length).toBe(0);

      // otherReg cascades away with org delete, but delete it now anyway to mirror the
      // original ordering; not required for correctness.
      await s.from("registrations").delete().eq("id", otherReg.id);
    } finally {
      // org delete cascades reg/otherReg/audit rows; otherUid is a separate auth row.
      if (otherUid) await s.auth.admin.deleteUser(otherUid);
      await cleanup(s, org.id, uid);
    }
  });

  it("lets an org admin read a runner's audit rows via auth_can_admin_org", async () => {
    const { s, uid, org, ev, reg } = await fixture("admin");
    let adminUid: string | undefined;
    try {
      await s.from("registration_audit").insert({
        registration_id: reg.id, org_id: org.id, event_id: ev.id,
        action: "field_changed", detail: { field: "shirt_size", from: "M", to: "L" },
        actor_id: uid, actor_role: "runner",
      });

      const adminEmail = `audit_admin_${Date.now()}@test.dev`;
      adminUid = (await s.auth.admin.createUser({ email: adminEmail, password: "password123", email_confirm: true })).data.user!.id;
      await s.from("user_roles").insert({ user_id: adminUid, role: "admin", org_id: org.id });

      const asAdmin = createClient(url, anonKey, { auth: { persistSession: false } });
      await asAdmin.auth.signInWithPassword({ email: adminEmail, password: "password123" });

      const read = await asAdmin.from("registration_audit").select("*").eq("registration_id", reg.id);
      expect(read.error).toBeNull();
      expect(read.data!.length).toBe(1);
    } finally {
      // org delete cascades reg/audit; user_roles for adminUid cascades from the user delete.
      if (adminUid) await s.auth.admin.deleteUser(adminUid);
      await cleanup(s, org.id, uid);
    }
  });
});
