import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

async function fixture(tag: string) {
  const db = svc();
  const stamp = `${tag}-${Date.now()}`;
  const org = (await db.from("organizations")
    .insert({ name: `Slug ${tag}`, slug: stamp })
    .select("id").single()).data!;
  return { db, orgId: org.id, cleanup: () => db.from("organizations").delete().eq("id", org.id) };
}

describe("event public slugs", () => {
  it("stores a valid slug and rejects malformed or duplicate values", async () => {
    const f = await fixture("contract");
    try {
      const first = await f.db.from("events").insert({
        org_id: f.orgId, name: "Apo Sky Ultra", slug: "apo-sky-ultra", status: "draft",
      }).select("slug").single();
      expect(first.error).toBeNull();
      expect(first.data?.slug).toBe("apo-sky-ultra");

      const malformed = await f.db.from("events").insert({
        org_id: f.orgId, name: "Bad", slug: "Bad Slug", status: "draft",
      });
      expect(malformed.error?.message).toContain("events_slug_format");

      const duplicate = await f.db.from("events").insert({
        org_id: f.orgId, name: "Duplicate", slug: "apo-sky-ultra", status: "draft",
      });
      expect(duplicate.error?.code).toBe("23505");
    } finally {
      await f.cleanup();
    }
  });

  it("allows draft edits, then freezes an existing slug after publication", async () => {
    const f = await fixture("stable");
    try {
      const event = (await f.db.from("events").insert({
        org_id: f.orgId, name: "Stable Race", slug: "stable-race", status: "draft",
      }).select("id").single()).data!;

      expect((await f.db.from("events").update({ slug: "stable-race-2027" }).eq("id", event.id)).error).toBeNull();
      expect((await f.db.from("events").update({ status: "closed" }).eq("id", event.id)).error).toBeNull();
      expect((await f.db.from("events").update({ name: "Stable Race Renamed" }).eq("id", event.id)).error).toBeNull();

      const locked = await f.db.from("events").update({ slug: "different-address" }).eq("id", event.id);
      expect(locked.error?.message).toContain("event_slug_locked");

      expect((await f.db.from("events").update({ status: "draft" }).eq("id", event.id)).error).toBeNull();
      const stillLocked = await f.db.from("events").update({ slug: "draft-again-address" }).eq("id", event.id);
      expect(stillLocked.error?.message).toContain("event_slug_locked");
    } finally {
      await f.cleanup();
    }
  });

  it("lets a legacy published event receive its first slug exactly once", async () => {
    const f = await fixture("legacy");
    try {
      const event = (await f.db.from("events").insert({
        org_id: f.orgId, name: "Legacy Race", status: "closed",
      }).select("id").single()).data!;
      expect((await f.db.from("events").update({ slug: "legacy-race" }).eq("id", event.id)).error).toBeNull();

      const second = await f.db.from("events").update({ slug: "legacy-race-new" }).eq("id", event.id);
      expect(second.error?.message).toContain("event_slug_locked");
    } finally {
      await f.cleanup();
    }
  });
});
