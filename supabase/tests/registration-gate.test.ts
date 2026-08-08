import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** Seed ids drifted out of seed.sql once already (see the Global Constraints
 *  note). Every fixture here is created by the test that needs it. */
async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}

async function makeEvent(slug: string) {
  const svc = service();
  const org = await svc.from("organizations").insert({ name: `Gate ${slug}`, slug: `gate-${slug}` }).select().single();
  const ev = await svc.from("events")
    .insert({ org_id: org.data!.id, name: `Gate Race ${slug}`, status: "open" }).select().single();
  const cat = await svc.from("categories")
    .insert({ org_id: org.data!.id, event_id: ev.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 })
    .select().single();
  return { orgId: org.data!.id, eventId: ev.data!.id, categoryId: cat.data!.id };
}

function regRow(f: { orgId: string; eventId: string; categoryId: string }, userId: string) {
  return { org_id: f.orgId, event_id: f.eventId, category_id: f.categoryId, user_id: userId, total_amount: 100000 };
}

describe("one live registration per event", () => {
  it("rejects a second live registration for the same event", async () => {
    const svc = service();
    const f = await makeEvent(`dup${Date.now()}`);
    const runner = await makeUser(`gate_dup_${Date.now()}@test.dev`);

    const first = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(first.error).toBeNull();

    const second = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe("23505");
  });

  it("allows a new registration once the previous one is cancelled, refunded or expired", async () => {
    const svc = service();
    for (const exitStatus of ["cancelled", "refunded", "expired"] as const) {
      const f = await makeEvent(`re${exitStatus}${Date.now()}`);
      const runner = await makeUser(`gate_re_${exitStatus}_${Date.now()}@test.dev`);

      const first = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      expect(first.error).toBeNull();
      await svc.from("registrations").update({ status: exitStatus }).eq("id", first.data!.id);

      const again = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      expect(again.error, `re-entry after ${exitStatus} must be allowed`).toBeNull();
    }
  });

  it("scopes the gate to one event — the same runner may enter a different event", async () => {
    const svc = service();
    const a = await makeEvent(`ea${Date.now()}`);
    const b = await makeEvent(`eb${Date.now()}`);
    const runner = await makeUser(`gate_two_${Date.now()}@test.dev`);

    expect((await svc.from("registrations").insert(regRow(a, runner.id)).select().single()).error).toBeNull();
    expect((await svc.from("registrations").insert(regRow(b, runner.id)).select().single()).error).toBeNull();
  });

  it("stamps a 24-hour expiry on a new pending registration", async () => {
    const svc = service();
    const f = await makeEvent(`exp${Date.now()}`);
    const runner = await makeUser(`gate_exp_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select("created_at,expires_at").single();
    expect(reg.error).toBeNull();
    const hours = (Date.parse(reg.data!.expires_at!) - Date.parse(reg.data!.created_at)) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });
});
