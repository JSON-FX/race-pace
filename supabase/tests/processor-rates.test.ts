import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("processor_rates", () => {
  it("seeds VAT-INCLUSIVE rates for the methods the checkout offers", async () => {
    const s = svc();
    const { data, error } = await s.from("processor_rates")
      .select("method,scope,percent_bps,fixed_cents")
      .eq("provider", "paymongo").is("effective_to", null);
    expect(error).toBeNull();
    const byKey = new Map(data!.map((r) => [`${r.method}:${r.scope}`, r]));

    // Quoted ex-VAT x 1.12. 3.125% -> 3.50%, ₱13.39 -> ₱15.00.
    expect(byKey.get("card:local")).toMatchObject({ percent_bps: 350, fixed_cents: 1500 });
    expect(byKey.get("card:international")).toMatchObject({ percent_bps: 450, fixed_cents: 1500 });
    expect(byKey.get("gcash:local")).toMatchObject({ percent_bps: 150, fixed_cents: 0 });
    expect(byKey.get("paymaya:local")).toMatchObject({ percent_bps: 150, fixed_cents: 0 });
  });

  it("returns the rate in force at a given time, not today's", async () => {
    const s = svc();
    const stamp = `rate-${Date.now()}`;
    // Close the current gcash row and open a new one, so there are two eras.
    const cut = "2026-09-01T00:00:00Z";
    await s.from("processor_rates").update({ effective_to: cut })
      .eq("provider", "paymongo").eq("method", "gcash").eq("scope", "local").is("effective_to", null);
    const inserted = (await s.from("processor_rates").insert({
      provider: "paymongo", method: "gcash", scope: "local",
      percent_bps: 200, fixed_cents: 0, effective_from: cut, note: stamp,
    }).select().single()).data!;
    try {
      const before = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: "gcash", p_scope: "local",
        p_at: "2026-08-15T00:00:00Z",
      });
      expect(before.data![0]).toMatchObject({ percent_bps: 150 });

      const after = await s.rpc("processor_rate_at", {
        p_provider: "paymongo", p_method: "gcash", p_scope: "local",
        p_at: "2026-09-15T00:00:00Z",
      });
      expect(after.data![0]).toMatchObject({ percent_bps: 200 });
    } finally {
      await s.from("processor_rates").delete().eq("id", inserted.id);
      await s.from("processor_rates").update({ effective_to: null })
        .eq("provider", "paymongo").eq("method", "gcash").eq("scope", "local").eq("effective_to", cut);
    }
  });

  it("returns no row for a method with no rate card entry", async () => {
    const s = svc();
    const { data } = await s.rpc("processor_rate_at", {
      p_provider: "paymongo", p_method: "grab_pay", p_scope: "local",
      p_at: "2026-08-15T00:00:00Z",
    });
    expect(data ?? []).toHaveLength(0);
  });

  it("allows only one open-ended row per provider/method/scope", async () => {
    const s = svc();
    const res = await s.from("processor_rates").insert({
      provider: "paymongo", method: "gcash", scope: "local",
      percent_bps: 999, fixed_cents: 0,
    });
    expect(res.error).not.toBeNull();
  });
});
