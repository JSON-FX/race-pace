import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey, dbUrl } = loadEnv();
// This suite creates accounts and Storage objects. Refuse hosted credentials
// before constructing clients, even when an inherited shell overrides dotenv.
for (const address of [url, dbUrl]) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(address).hostname)) {
    throw new Error("Guide integration tests require loopback Supabase API and database URLs");
  }
}

const options = { auth: { persistSession: false } };
const service = createClient(url, serviceKey, options);
const anonymous = createClient(url, anonKey, options);
const bucket = "guide-videos";
const orgIds = [randomUUID(), randomUUID()];
const userIds: string[] = [];
const guideIds: string[] = [];
const objectPaths: string[] = [];
let superAdmin: SupabaseClient;
let admins: SupabaseClient[];
let deniedReaders: SupabaseClient[];

function guide(isPublished = false) {
  const id = randomUUID();
  guideIds.push(id);
  return {
    id,
    title: `Guide ${id}`,
    description: "Use the admin console to prepare your event.",
    topic: "Getting started",
    duration_seconds: 523,
    storage_path: `${id}/${randomUUID()}.mp4`,
    thumbnail_path: `${id}/${randomUUID()}.jpg`,
    is_published: isPublished,
  };
}
const published = guide(true);
const draft = guide();
const orphanPath = `${published.id}/${randomUUID()}.mp4`;

function checked<T extends { data: unknown; error: { message: string } | null }>(result: T): NonNullable<T["data"]> {
  if (result.error) throw new Error(result.error.message);
  // Successful reads return data; write-only calls may return null and ignore it.
  return result.data as NonNullable<T["data"]>;
}

async function user(role?: "super_admin" | "admin" | "editor" | "marshal", orgId?: string) {
  const email = `guide-${randomUUID()}@racepace.test`;
  const created = checked(await service.auth.admin.createUser({ email, password: "password123", email_confirm: true }));
  if (!created.user) throw new Error("Could not create Guide test user");
  userIds.push(created.user.id);
  if (role) checked(await service.from("user_roles").insert({ user_id: created.user.id, role, org_id: orgId ?? null }));
  const client = createClient(url, anonKey, options);
  checked(await client.auth.signInWithPassword({ email, password: "password123" }));
  return client;
}

async function upload(client: SupabaseClient, path: string, type = "video/mp4") {
  objectPaths.push(path);
  return client.storage.from(bucket).upload(path, new Blob(["Guide storage authorization fixture"], { type }));
}

beforeAll(async () => {
  checked(await service.from("organizations").insert(orgIds.map((id) => ({ id, name: "Guide fixture", slug: id }))));
  superAdmin = await user("super_admin");
  admins = [await user("admin", orgIds[0]), await user("admin", orgIds[1])];
  deniedReaders = [await user("editor", orgIds[0]), await user("marshal", orgIds[0]), await user(), anonymous];
  checked(await superAdmin.from("guide_videos").insert([published, draft]));
  for (const row of [published, draft]) {
    checked(await upload(superAdmin, row.storage_path));
    checked(await upload(superAdmin, row.thumbnail_path, "image/jpeg"));
  }
  checked(await upload(superAdmin, orphanPath));
});

afterAll(async () => {
  const errors: string[] = [];
  const record = (result: { error: { message: string } | null }) => {
    if (result.error) errors.push(result.error.message);
  };
  if (objectPaths.length) record(await service.storage.from(bucket).remove(objectPaths));
  if (guideIds.length) record(await service.from("guide_videos").delete().in("id", guideIds));
  if (userIds.length) record(await service.from("user_roles").delete().in("user_id", userIds));
  record(await service.from("organizations").delete().in("id", orgIds));
  for (const id of userIds) record(await service.auth.admin.deleteUser(id));
  expect(errors, "Guide fixture cleanup").toEqual([]);
});

describe("global Guide library authorization", () => {
  it("pins a private 100 MB bucket and supported video/thumbnail MIME types", async () => {
    const found = checked(await service.storage.getBucket(bucket));
    expect(found.public).toBe(false);
    expect(found.file_size_limit).toBe(100_000_000);
    const others = checked(await service.storage.listBuckets()).filter(item => item.id !== bucket);
    for (const other of others) {
      expect(other.file_size_limit).toBeGreaterThan(0);
      expect(other.file_size_limit).toBeLessThanOrEqual(52_428_800);
    }
    expect(found.allowed_mime_types?.sort()).toEqual(["image/jpeg", "video/mp4", "video/webm"]);
    const unsupported = await upload(superAdmin, `${published.id}/${randomUUID()}.txt`, "text/plain");
    expect(unsupported.error).not.toBeNull();
  });

  it("shares published rows across organizations while keeping drafts super-admin-only", async () => {
    for (const client of admins) {
      const rows = checked(await client.from("guide_videos").select("id").in("id", [published.id, draft.id]));
      expect(rows.map((row) => row.id)).toEqual([published.id]);
    }
    const all = checked(await superAdmin.from("guide_videos").select("id").in("id", [published.id, draft.id]));
    expect(all.map((row) => row.id).sort()).toEqual([published.id, draft.id].sort());
    for (const client of deniedReaders) {
      const response = await client.from("guide_videos").select("id").in("id", [published.id, draft.id]);
      if (client === anonymous) expect(response.error?.code).toBe("42501");
      else {
        expect(response.error).toBeNull();
        expect(response.data).toEqual([]);
      }
    }
  });

  it("lets super admins create, edit, publish, draft and delete metadata", async () => {
    const row = { ...guide(), thumbnail_path: null };
    checked(await superAdmin.from("guide_videos").insert(row));
    const edited = checked(await superAdmin.from("guide_videos")
      .update({ title: "Updated guide", is_published: true, updated_at: new Date().toISOString() })
      .eq("id", row.id).select("title,is_published").single());
    expect(edited).toEqual({ title: "Updated guide", is_published: true });
    expect(checked(await admins[0].from("guide_videos").select("id").eq("id", row.id))).toHaveLength(1);
    checked(await superAdmin.from("guide_videos").update({ is_published: false }).eq("id", row.id));
    expect(checked(await admins[0].from("guide_videos").select("id").eq("id", row.id))).toEqual([]);
    expect(checked(await superAdmin.from("guide_videos").delete().eq("id", row.id).select("id"))).toEqual([{ id: row.id }]);
  });

  it("denies metadata and Storage mutations to every non-super-admin role", async () => {
    for (const client of [...admins, ...deniedReaders]) {
      expect((await client.from("guide_videos").insert(guide(true))).error).not.toBeNull();
      const edited = await client.from("guide_videos").update({ title: "Unauthorized rewrite" }).eq("id", published.id).select("id");
      expect(edited.data ?? []).toEqual([]);
      const deleted = await client.from("guide_videos").delete().eq("id", published.id).select("id");
      expect(deleted.data ?? []).toEqual([]);
      expect((await upload(client, `${published.id}/${randomUUID()}.mp4`)).error).not.toBeNull();
      const replaced = await client.storage.from(bucket).update(published.storage_path, new Blob(["Unauthorized"], { type: "video/mp4" }));
      expect(replaced.error).not.toBeNull();
      // Storage remove may silently filter unauthorized objects rather than error.
      await client.storage.from(bucket).remove([published.storage_path]);
    }
    expect(checked(await service.from("guide_videos").select("title").eq("id", published.id).single()).title).toBe(published.title);
    const original = checked(await service.storage.from(bucket).download(published.storage_path));
    expect(await original.text()).toBe("Guide storage authorization fixture");
  });

  it("signs only exact published video/thumbnail paths for org admins", async () => {
    for (const client of admins) {
      for (const path of [published.storage_path, published.thumbnail_path]) {
        const signed = checked(await client.storage.from(bucket).createSignedUrl(path, 60));
        const response = await fetch(signed.signedUrl);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Guide storage authorization fixture");
      }
      for (const path of [draft.storage_path, draft.thumbnail_path, orphanPath]) {
        expect((await client.storage.from(bucket).createSignedUrl(path, 60)).error).not.toBeNull();
      }
    }
    for (const client of deniedReaders) {
      for (const path of [published.storage_path, published.thumbnail_path]) {
        expect((await client.storage.from(bucket).createSignedUrl(path, 60)).error).not.toBeNull();
      }
    }
    for (const path of [draft.storage_path, draft.thumbnail_path, orphanPath]) {
      expect((await superAdmin.storage.from(bucket).createSignedUrl(path, 60)).error).toBeNull();
    }
    const publicUrl = service.storage.from(bucket).getPublicUrl(published.storage_path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
  });

  it("blocks new video and thumbnail signing after unpublishing", async () => {
    checked(await superAdmin.from("guide_videos").update({ is_published: false }).eq("id", published.id));
    try {
      for (const path of [published.storage_path, published.thumbnail_path]) {
        expect((await admins[0].storage.from(bucket).createSignedUrl(path, 60)).error).not.toBeNull();
      }
    } finally {
      checked(await superAdmin.from("guide_videos").update({ is_published: true }).eq("id", published.id));
    }
  });

  it("lets super admins replace and remove their uploaded objects", async () => {
    const path = `${draft.id}/${randomUUID()}.webm`;
    checked(await upload(superAdmin, path, "video/webm"));
    checked(await superAdmin.storage.from(bucket).update(path, new Blob(["Replacement"], { type: "video/webm" })));
    expect(await checked(await superAdmin.storage.from(bucket).download(path)).text()).toBe("Replacement");
    checked(await superAdmin.storage.from(bucket).remove([path]));
    expect((await service.storage.from(bucket).download(path)).error).not.toBeNull();
  });

  it("rejects invalid metadata and video/thumbnail paths bound to another guide", async () => {
    const invalid = [
      { title: "" }, { title: " \n\t " }, { title: "t".repeat(161) },
      { description: "" }, { description: " \t " }, { description: "d".repeat(2001) },
      { topic: "All guides" }, { duration_seconds: 0 }, { duration_seconds: 14401 },
      { storage_path: published.storage_path }, { storage_path: `${randomUUID()}/${randomUUID()}.mp4` },
      { storage_path: `${randomUUID()}/bad.mp4` }, { thumbnail_path: published.thumbnail_path },
      { thumbnail_path: `${randomUUID()}/${randomUUID()}.jpg` },
    ];
    for (const fields of invalid) {
      const rejected = await superAdmin.from("guide_videos").insert({ ...guide(), ...fields });
      expect(rejected.error?.code, JSON.stringify(fields)).toBe("23514");
    }
  });
});
