import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

/** kitClosesAt null = no kit deadline. Registration always starts paid with shirt M. */
async function fixture(tag: string, kitClosesAt: string | null) {
  const s = svc();
  const stamp = `${tag}_${Date.now()}`;
  const email = `edit_${stamp}@test.dev`;
  const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
  const org = (await s.from("organizations").insert({ name: "Edit Org", slug: `ed-${stamp}` }).select().single()).data!;
  const ev = (await s.from("events").insert({
    org_id: org.id, name: "Edit Race", status: "open", kit_edit_closes_at: kitClosesAt,
  }).select().single()).data!;
  const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
  const reg = (await s.from("registrations").insert({
    org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid,
    total_amount: 100000, status: "paid", custom_data: { shirt_size: "M", running_club: "Malaybalay" },
  }).select().single()).data!;
  return { s, uid, email, org, ev, reg };
}

async function signedIn(email: string): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: "password123" });
  return c;
}

async function cleanup(s: ReturnType<typeof svc>, orgId: string, uid: string) {
  await s.from("organizations").delete().eq("id", orgId);
  await s.auth.admin.deleteUser(uid);
}

const call = (c: SupabaseClient, rid: string, changes: Record<string, unknown>) =>
  c.rpc("update_registration_fields_tx", { p_registration_id: rid, p_changes: changes });

describe("update_registration_fields_tx", () => {
  it("lets the owner change a kit field before the cutoff and writes one audit row", async () => {
    const { s, uid, email, org, reg } = await fixture("before", FUTURE);
    const c = await signedIn(email);
    const r = await call(c, reg.id, { shirt_size: "L" });
    expect(r.data).toBe("ok");

    const row = (await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!;
    expect(row.custom_data.shirt_size).toBe("L");
    expect(row.custom_data.running_club).toBe("Malaybalay");

    const audit = (await s.from("registration_audit").select("*").eq("registration_id", reg.id)).data!;
    expect(audit.length).toBe(1);
    expect(audit[0].action).toBe("field_changed");
    expect(audit[0].detail).toEqual({ field: "shirt_size", from: "M", to: "L" });
    expect(audit[0].actor_role).toBe("runner");
    expect(audit[0].actor_id).toBe(uid);
    await cleanup(s, org.id, uid);
  });

  it("refuses a kit change after the cutoff and writes nothing", async () => {
    const { s, uid, email, org, reg } = await fixture("after", PAST);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("locked");

    const row = (await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!;
    expect(row.custom_data.shirt_size).toBe("M");
    expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });

  it("treats a null kit cutoff as no deadline", async () => {
    const { s, uid, email, org, reg } = await fixture("nulldl", null);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "XL" })).data).toBe("ok");
    await cleanup(s, org.id, uid);
  });

  it("lets an org admin change a kit field after the cutoff, recorded as admin", async () => {
    const { s, uid, org, reg } = await fixture("admin", PAST);
    const adminEmail = `edit_admin_${Date.now()}@test.dev`;
    const adminUid = (await s.auth.admin.createUser({ email: adminEmail, password: "password123", email_confirm: true })).data.user!.id;
    await s.from("user_roles").insert({ user_id: adminUid, role: "admin", org_id: org.id });

    const c = await signedIn(adminEmail);
    expect((await call(c, reg.id, { shirt_size: "S" })).data).toBe("ok");

    const audit = (await s.from("registration_audit").select("*").eq("registration_id", reg.id)).data!;
    expect(audit[0].actor_role).toBe("admin");
    expect(audit[0].actor_id).toBe(adminUid);

    await s.auth.admin.deleteUser(adminUid);
    await cleanup(s, org.id, uid);
  });

  it("refuses a signed-in stranger editing someone else's registration", async () => {
    const { s, uid, org, reg } = await fixture("stranger", FUTURE);
    const otherEmail = `edit_other_${Date.now()}@test.dev`;
    const otherUid = (await s.auth.admin.createUser({ email: otherEmail, password: "password123", email_confirm: true })).data.user!.id;

    const c = await signedIn(otherEmail);
    expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("forbidden");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");

    await s.auth.admin.deleteUser(otherUid);
    await cleanup(s, org.id, uid);
  });

  it("keeps safety fields editable after the kit cutoff", async () => {
    const { s, uid, email, org, reg } = await fixture("safety", PAST);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { blood_type: "B-" })).data).toBe("ok");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.blood_type).toBe("B-");
    await cleanup(s, org.id, uid);
  });

  it("rejects an immutable key and writes nothing", async () => {
    const { s, uid, email, org, reg } = await fixture("immutable", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { running_club: "Other Club" })).data).toBe("invalid_value");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.running_club).toBe("Malaybalay");
    await cleanup(s, org.id, uid);
  });

  it("rejects a shirt size outside the canonical list", async () => {
    const { s, uid, email, org, reg } = await fixture("badsize", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "XXXL" })).data).toBe("invalid_value");
    await cleanup(s, org.id, uid);
  });

  it("writes nothing at all when one key in a batch is invalid", async () => {
    const { s, uid, email, org, reg } = await fixture("mixed", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L", running_club: "Other" })).data).toBe("invalid_value");
    expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");
    expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });

  it("writes one audit row per changed field", async () => {
    const { s, uid, email, org, reg } = await fixture("two", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L", blood_type: "O+" })).data).toBe("ok");
    const audit = (await s.from("registration_audit").select("detail").eq("registration_id", reg.id)).data!;
    expect(audit.length).toBe(2);
    await cleanup(s, org.id, uid);
  });

  it("returns no_change and writes no audit row when the value is unchanged", async () => {
    const { s, uid, email, org, reg } = await fixture("same", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "M" })).data).toBe("no_change");
    expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    await cleanup(s, org.id, uid);
  });

  it("records a null `from` when the field had no previous value", async () => {
    const { s, uid, email, org, reg } = await fixture("newfield", FUTURE);
    const c = await signedIn(email);
    await call(c, reg.id, { blood_type: "A+" });
    const audit = (await s.from("registration_audit").select("detail").eq("registration_id", reg.id)).data!;
    expect(audit[0].detail).toEqual({ field: "blood_type", from: null, to: "A+" });
    await cleanup(s, org.id, uid);
  });

  it("refuses to edit a refunded registration", async () => {
    const { s, uid, email, org, reg } = await fixture("refunded", FUTURE);
    await s.from("registrations").update({ status: "refunded" }).eq("id", reg.id);
    const c = await signedIn(email);
    expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("not_editable");
    await cleanup(s, org.id, uid);
  });

  it("returns not_found for an unknown registration", async () => {
    const { s, uid, email, org } = await fixture("missing", FUTURE);
    const c = await signedIn(email);
    expect((await call(c, "00000000-0000-0000-0000-0000000000ff", { shirt_size: "L" })).data).toBe("not_found");
    await cleanup(s, org.id, uid);
  });

  it("refuses an anonymous caller", async () => {
    const { s, uid, org, reg } = await fixture("anon", FUTURE);
    const c = createClient(url, anonKey, { auth: { persistSession: false } });
    const r = await call(c, reg.id, { shirt_size: "L" });
    expect(r.data === "forbidden" || r.error !== null).toBe(true);
    await cleanup(s, org.id, uid);
  });
});
