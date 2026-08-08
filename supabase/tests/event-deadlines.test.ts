import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function org(tag: string) {
  const s = svc();
  const o = (await s.from("organizations").insert({ name: "Deadline Org", slug: `dl-${tag}-${Date.now()}` }).select().single()).data!;
  return { s, o };
}

describe("event deadline columns", () => {
  it("accepts a kit cutoff after the registration close", async () => {
    const { s, o } = await org("ok");
    const { data, error } = await s.from("events").insert({
      org_id: o.id, name: "Deadline Race", status: "open",
      registration_closes_at: "2026-09-01T15:59:00Z",
      kit_edit_closes_at: "2026-09-06T15:59:00Z",
    }).select().single();
    expect(error).toBeNull();
    expect(data!.registration_closes_at).not.toBeNull();
    await s.from("organizations").delete().eq("id", o.id);
  });

  it("rejects a kit cutoff earlier than the registration close", async () => {
    const { s, o } = await org("bad");
    const { error } = await s.from("events").insert({
      org_id: o.id, name: "Bad Race", status: "open",
      registration_closes_at: "2026-09-06T15:59:00Z",
      kit_edit_closes_at: "2026-09-01T15:59:00Z",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("events_kit_edit_after_reg_close");
    await s.from("organizations").delete().eq("id", o.id);
  });

  it("allows both null so existing events are unaffected", async () => {
    const { s, o } = await org("null");
    const { data, error } = await s.from("events")
      .insert({ org_id: o.id, name: "No Deadline Race", status: "open" }).select().single();
    expect(error).toBeNull();
    expect(data!.registration_closes_at).toBeNull();
    expect(data!.kit_edit_closes_at).toBeNull();
    await s.from("organizations").delete().eq("id", o.id);
  });

  it("allows a kit cutoff with no registration close", async () => {
    const { s, o } = await org("kitonly");
    const { error } = await s.from("events").insert({
      org_id: o.id, name: "Kit Only Race", status: "open",
      kit_edit_closes_at: "2026-09-06T15:59:00Z",
    });
    expect(error).toBeNull();
    await s.from("organizations").delete().eq("id", o.id);
  });
});
