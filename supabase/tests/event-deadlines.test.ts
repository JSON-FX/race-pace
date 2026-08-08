import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function org(tag: string) {
  const s = svc();
  const o = (await s.from("organizations").insert({ name: "Deadline Org", slug: `dl-${tag}-${Date.now()}` }).select().single()).data!;
  return { s, o };
}

describe("event deadline columns", () => {
  it("accepts a kit cutoff after the registration close", async () => {
    const { s, o } = await org("ok");
    try {
      // status doesn't matter here — only the kit-vs-registration-close CHECK constraint is
      // under test, via a service-role insert that bypasses RLS either way. 'draft' keeps a
      // leaked fixture invisible to anon reads on the public site.
      const { data, error } = await s.from("events").insert({
        org_id: o.id, name: "Deadline Race", status: "draft",
        registration_closes_at: "2026-09-01T15:59:00Z",
        kit_edit_closes_at: "2026-09-06T15:59:00Z",
      }).select().single();
      expect(error).toBeNull();
      expect(data!.registration_closes_at).not.toBeNull();
    } finally {
      await s.from("organizations").delete().eq("id", o.id);
    }
  });

  it("rejects a kit cutoff earlier than the registration close", async () => {
    const { s, o } = await org("bad");
    try {
      const { error } = await s.from("events").insert({
        org_id: o.id, name: "Bad Race", status: "draft",
        registration_closes_at: "2026-09-06T15:59:00Z",
        kit_edit_closes_at: "2026-09-01T15:59:00Z",
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain("events_kit_edit_after_reg_close");
    } finally {
      await s.from("organizations").delete().eq("id", o.id);
    }
  });

  it("allows both null so existing events are unaffected", async () => {
    const { s, o } = await org("null");
    try {
      const { data, error } = await s.from("events")
        .insert({ org_id: o.id, name: "No Deadline Race", status: "draft" }).select().single();
      expect(error).toBeNull();
      expect(data!.registration_closes_at).toBeNull();
      expect(data!.kit_edit_closes_at).toBeNull();
    } finally {
      await s.from("organizations").delete().eq("id", o.id);
    }
  });

  it("allows a kit cutoff with no registration close", async () => {
    const { s, o } = await org("kitonly");
    try {
      const { error } = await s.from("events").insert({
        org_id: o.id, name: "Kit Only Race", status: "draft",
        kit_edit_closes_at: "2026-09-06T15:59:00Z",
      });
      expect(error).toBeNull();
    } finally {
      await s.from("organizations").delete().eq("id", o.id);
    }
  });
});

describe("checkout enforces registration_closes_at", () => {
  it("refuses a registration for an event whose deadline has passed", async () => {
    const { s, o } = await org("checkout");
    let uid: string | undefined;
    try {
      const email = `dlco_${Date.now()}@test.dev`;
      uid = (await s.auth.admin.createUser({ email, password: "password123", email_confirm: true })).data.user!.id;
      // status must stay 'open': registrations-checkout refuses non-open events on its own,
      // and this test needs to isolate the registration_closes_at check from that.
      const ev = (await s.from("events").insert({
        org_id: o.id, name: "Closed Race", status: "open",
        registration_closes_at: "2020-01-01T00:00:00Z",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: o.id, event_id: ev.id, code: "10k", label: "10K",
        base_price: 100000, slots_total: 50, slots_taken: 0,
      }).select().single()).data!;

      const asUser = createClient(url, anonKey, { auth: { persistSession: false } });
      const session = await asUser.auth.signInWithPassword({ email, password: "password123" });
      const jwt = session.data.session!.access_token;

      const idempotencyKey = `dl-${Date.now()}`;
      const res = await fetch(`${url}/functions/v1/registrations-checkout`, {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify({
          event_id: ev.id, category_id: cat.id, addon_ids: [],
          custom_data: {}, waiver_accepted: true, idempotency_key: idempotencyKey,
        }),
      });

      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("registration_closed");

      // Verify no registration row was created despite the 409 response.
      // If the deadline check runs before the upsert (as it should), neither
      // registrations nor payments rows should exist.
      const regResult = await s.from("registrations")
        .select("id")
        .eq("user_id", uid)
        .eq("event_id", ev.id);
      expect(regResult.error).toBeNull();
      expect(regResult.data ?? []).toHaveLength(0);
    } finally {
      // org delete cascades event/category; the auth user is separate and only cleaned up
      // if creation got far enough to produce one.
      await s.from("organizations").delete().eq("id", o.id);
      if (uid) await s.auth.admin.deleteUser(uid);
    }
  });
});
