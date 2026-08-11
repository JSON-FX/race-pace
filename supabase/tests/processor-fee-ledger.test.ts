import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("processor fee columns", () => {
  it("defaults a new payment to zero fee from an unknown source", async () => {
    const s = svc();
    const stamp = `pfc-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Fee Col Org", slug: stamp,
      commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Fee Col Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
        base_price: 200000, slots_total: 10, slots_taken: 0,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 200000, status: "pending",
      }).select().single()).data!;
      const pay = (await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 200000,
      }).select("processor_fee_cents,processor_fee_predicted_cents,processor_fee_source").single()).data!;

      expect(pay.processor_fee_cents).toBe(0);
      expect(pay.processor_fee_predicted_cents).toBeNull();
      expect(pay.processor_fee_source).toBe("none");

      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });

  it("defaults an organization to absorb mode", async () => {
    const s = svc();
    const stamp = `fm-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "Mode Org", slug: stamp })
      .select("fee_mode").single()).data!;
    expect(org.fee_mode).toBe("absorb");
    await s.from("organizations").delete().eq("slug", stamp);
  });

  it("rejects an unknown fee mode", async () => {
    const s = svc();
    const stamp = `fmx-${Date.now()}`;
    const res = await s.from("organizations").insert({
      name: "Bad Mode Org", slug: stamp, fee_mode: "invoice_later",
    });
    expect(res.error).not.toBeNull();
  });

  it("rejects a negative processor fee", async () => {
    const s = svc();
    const stamp = `neg-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "Neg Org", slug: stamp })
      .select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Neg Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "5k", label: "5K",
        base_price: 100000, slots_total: 10, slots_taken: 0,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 100000, status: "pending",
      }).select().single()).data!;
      const res = await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 100000, processor_fee_cents: -1,
      });
      expect(res.error).not.toBeNull();
      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });
});
