import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

/** kitClosesAt null = no kit deadline. Registration starts (by default) paid with shirt M;
 *  pass status = "pending" to cover the other editable state.
 *  Exception-safe: if an insert partway through fails, whatever this function already
 *  created is torn down here before rethrowing. Every test below wraps its call to
 *  fixture() + body in try/finally to cover assertion failures AFTER fixture() returns;
 *  this catch covers the case where fixture() itself never gets that far. */
async function fixture(tag: string, kitClosesAt: string | null, status: "pending" | "paid" = "paid") {
  const s = svc();
  const stamp = `${tag}_${Date.now()}`;
  const email = `edit_${stamp}@test.dev`;
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    const uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
    cleanups.push(() => s.auth.admin.deleteUser(uid));
    const org = (await s.from("organizations").insert({ name: "Edit Org", slug: `ed-${stamp}` }).select().single()).data!;
    cleanups.push(() => s.from("organizations").delete().eq("id", org.id));
    const ev = (await s.from("events").insert({
      org_id: org.id, name: "Edit Race", status: "open", kit_edit_closes_at: kitClosesAt,
    }).select().single()).data!;
    const cat = (await s.from("categories").insert({ org_id: org.id, event_id: ev.id, code: "10k", label: "10K", base_price: 100000, slots_total: 50, slots_taken: 0 }).select().single()).data!;
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id, user_id: uid,
      total_amount: 100000, status, custom_data: { shirt_size: "M", running_club: "Malaybalay" },
    }).select().single()).data!;
    return { s, uid, email, org, ev, reg };
  } catch (err) {
    for (const fn of cleanups.reverse()) await fn();
    throw err;
  }
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

// Every test wraps its body in try/finally so a failing assertion still tears down the org
// (cascades to event/category/registration/audit) and any extra auth users it created. A prior
// run without this leaked 14 orgs and 16 users into the shared hosted project when assertions
// failed before reaching an unconditional cleanup() call at the end of the test body.
describe("update_registration_fields_tx", () => {
  it("lets the owner change a kit field before the cutoff and writes one audit row", async () => {
    const { s, uid, email, org, reg } = await fixture("before", FUTURE);
    try {
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
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("refuses a kit change after the cutoff and writes nothing", async () => {
    const { s, uid, email, org, reg } = await fixture("after", PAST);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("locked");

      const row = (await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!;
      expect(row.custom_data.shirt_size).toBe("M");
      expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("treats a null kit cutoff as no deadline", async () => {
    const { s, uid, email, org, reg } = await fixture("nulldl", null);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "XL" })).data).toBe("ok");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("lets an org admin change a kit field after the cutoff, recorded as admin", async () => {
    const { s, uid, org, reg } = await fixture("admin", PAST);
    let adminUid: string | undefined;
    try {
      const adminEmail = `edit_admin_${Date.now()}@test.dev`;
      adminUid = (await s.auth.admin.createUser({ email: adminEmail, password: "password123", email_confirm: true })).data.user!.id;
      await s.from("user_roles").insert({ user_id: adminUid, role: "admin", org_id: org.id });

      const c = await signedIn(adminEmail);
      expect((await call(c, reg.id, { shirt_size: "S" })).data).toBe("ok");

      const audit = (await s.from("registration_audit").select("*").eq("registration_id", reg.id)).data!;
      expect(audit[0].actor_role).toBe("admin");
      expect(audit[0].actor_id).toBe(adminUid);
    } finally {
      if (adminUid) await s.auth.admin.deleteUser(adminUid);
      await cleanup(s, org.id, uid);
    }
  });

  it("refuses a signed-in stranger editing someone else's registration", async () => {
    const { s, uid, org, reg } = await fixture("stranger", FUTURE);
    let otherUid: string | undefined;
    try {
      const otherEmail = `edit_other_${Date.now()}@test.dev`;
      otherUid = (await s.auth.admin.createUser({ email: otherEmail, password: "password123", email_confirm: true })).data.user!.id;

      const c = await signedIn(otherEmail);
      expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("forbidden");
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");
    } finally {
      if (otherUid) await s.auth.admin.deleteUser(otherUid);
      await cleanup(s, org.id, uid);
    }
  });

  it("keeps safety fields editable after the kit cutoff", async () => {
    const { s, uid, email, org, reg } = await fixture("safety", PAST);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { blood_type: "B-" })).data).toBe("ok");
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.blood_type).toBe("B-");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("rejects an immutable key and writes nothing", async () => {
    const { s, uid, email, org, reg } = await fixture("immutable", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { running_club: "Other Club" })).data).toBe("invalid_value");
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.running_club).toBe("Malaybalay");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("rejects a shirt size outside the canonical list", async () => {
    const { s, uid, email, org, reg } = await fixture("badsize", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "XXXL" })).data).toBe("invalid_value");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("writes nothing at all when one key in a batch is invalid", async () => {
    const { s, uid, email, org, reg } = await fixture("mixed", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "L", running_club: "Other" })).data).toBe("invalid_value");
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");
      expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("writes one audit row per changed field", async () => {
    const { s, uid, email, org, reg } = await fixture("two", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "L", blood_type: "O+" })).data).toBe("ok");
      const audit = (await s.from("registration_audit").select("detail").eq("registration_id", reg.id)).data!;
      expect(audit.length).toBe(2);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("returns no_change and writes no audit row when the value is unchanged", async () => {
    const { s, uid, email, org, reg } = await fixture("same", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "M" })).data).toBe("no_change");
      expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("records a null `from` when the field had no previous value", async () => {
    const { s, uid, email, org, reg } = await fixture("newfield", FUTURE);
    try {
      const c = await signedIn(email);
      await call(c, reg.id, { blood_type: "A+" });
      const audit = (await s.from("registration_audit").select("detail").eq("registration_id", reg.id)).data!;
      expect(audit[0].detail).toEqual({ field: "blood_type", from: null, to: "A+" });
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("refuses to edit a refunded registration", async () => {
    const { s, uid, email, org, reg } = await fixture("refunded", FUTURE);
    try {
      await s.from("registrations").update({ status: "refunded" }).eq("id", reg.id);
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("not_editable");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("returns not_found for an unknown registration", async () => {
    const { s, uid, email, org } = await fixture("missing", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, "00000000-0000-0000-0000-0000000000ff", { shirt_size: "L" })).data).toBe("not_found");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("refuses an anonymous caller", async () => {
    const { s, uid, org, reg } = await fixture("anon", FUTURE);
    try {
      const c = createClient(url, anonKey, { auth: { persistSession: false } });
      const r = await call(c, reg.id, { shirt_size: "L" });
      // Updated by 20260808110000_lock_down_function_grants.sql: this RPC is Group B in that
      // migration's security audit (client-called, needs `authenticated`, `anon` has no business
      // reaching it) and now has anon EXECUTE revoked at the grant level. The call no longer
      // reaches the function body at all, so this is a Postgres 42501 permission error rather
      // than the function's own `v_actor is null` guard. Before that migration, EXECUTE was
      // granted to anon/authenticated/service_role via this project's ALTER DEFAULT PRIVILEGES
      // regardless of this function's own grant statement, so the anon-role call used to reach
      // the body and get refused internally ('forbidden') instead of by the database.
      expect(r.error).not.toBeNull();
      expect(r.error!.code).toBe("42501");
      expect(r.data).toBeNull();
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("rejects a JSON null for a canonical-list field and writes nothing", async () => {
    // Regression guard: `value #>> '{}'` on a JSON null yields SQL NULL, and `NULL not in (...)`
    // evaluates to NULL (not TRUE), so without an explicit type gate this would sail past the
    // shirt_size canonical-list check and null out the field.
    const { s, uid, email, org, reg } = await fixture("nullval", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: null })).data).toBe("invalid_value");
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("M");
      expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("rejects a non-string JSON value (object or number) and writes nothing", async () => {
    // Regression guard: `value #>> '{}'` silently stringifies objects/numbers into text instead
    // of rejecting them, which would store the JSON-serialized text as if it were a real value.
    const { s, uid, email, org, reg } = await fixture("nonstring", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { emergency_contact: { name: "Jane" } })).data).toBe("invalid_value");
      expect((await call(c, reg.id, { blood_type: 5 })).data).toBe("invalid_value");

      const row = (await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!;
      expect(row.custom_data.emergency_contact).toBeUndefined();
      expect(row.custom_data.blood_type).toBeUndefined();
      expect((await s.from("registration_audit").select("id").eq("registration_id", reg.id)).data!.length).toBe(0);
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("lets the owner edit a pending (not yet paid) registration", async () => {
    const { s, uid, email, org, reg } = await fixture("pending", FUTURE, "pending");
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { shirt_size: "L" })).data).toBe("ok");
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.shirt_size).toBe("L");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });

  it("lets the owner set emergency_contact and rejects one over 200 characters", async () => {
    const { s, uid, email, org, reg } = await fixture("emerg", FUTURE);
    try {
      const c = await signedIn(email);
      expect((await call(c, reg.id, { emergency_contact: "Jane Doe, +63 917 000 0000" })).data).toBe("ok");
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.emergency_contact)
        .toBe("Jane Doe, +63 917 000 0000");

      const tooLong = "a".repeat(201);
      expect((await call(c, reg.id, { emergency_contact: tooLong })).data).toBe("invalid_value");
      // still the previously-set value, not overwritten and not truncated
      expect((await s.from("registrations").select("custom_data").eq("id", reg.id).single()).data!.custom_data.emergency_contact)
        .toBe("Jane Doe, +63 917 000 0000");
    } finally {
      await cleanup(s, org.id, uid);
    }
  });
});
