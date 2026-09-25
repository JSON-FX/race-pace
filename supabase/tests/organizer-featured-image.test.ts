import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const created = { orgId: "", userIds: [] as string[] };

afterEach(async () => {
  if (created.orgId) await service().from("organizations").delete().eq("id", created.orgId);
  for (const userId of created.userIds) await service().auth.admin.deleteUser(userId);
  created.orgId = "";
  created.userIds = [];
});

async function userFor(orgId: string, role: "editor" | "admin") {
  const email = `featured-${role}-${randomUUID()}@racepace.test`;
  const { data, error } = await service().auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (error || !data.user) throw error ?? new Error("Could not create user");
  created.userIds.push(data.user.id);
  const assignment = await service().from("user_roles").insert({ user_id: data.user.id, org_id: orgId, role });
  if (assignment.error) throw assignment.error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password: "password123" });
  if (signedIn.error) throw signedIn.error;
  return client;
}

it("allows org admins to set a featured image but rejects editor and cross-org writes", async () => {
  const slug = `featured-${randomUUID()}`;
  const { data: org, error } = await service().from("organizations")
    .insert({ name: "Featured image fixture", slug }).select("id,featured_image_url").single();
  if (error || !org) throw error ?? new Error("Could not create organization");
  created.orgId = org.id;
  expect(org.featured_image_url).toBeNull();

  const editor = await userFor(org.id, "editor");
  const admin = await userFor(org.id, "admin");
  const other = await service().from("organizations")
    .insert({ name: "Other featured fixture", slug: `${slug}-other` }).select("id").single();
  if (other.error || !other.data) throw other.error ?? new Error("Could not create other organization");
  try {
    const denied = await editor.from("organizations")
      .update({ featured_image_url: "https://example.test/editor.png" }).eq("id", org.id).select("id");
    expect(denied.error?.code).toBe("42501");

    const saved = await admin.from("organizations")
      .update({ featured_image_url: "https://example.test/admin.png" }).eq("id", org.id).select("id");
    expect(saved.error).toBeNull();
    expect(saved.data).toHaveLength(1);

    const foreign = await admin.from("organizations")
      .update({ featured_image_url: "https://example.test/foreign.png" }).eq("id", other.data.id).select("id");
    expect(foreign.data).toEqual([]);
    const { data: rows } = await service().from("organizations")
      .select("id,featured_image_url").in("id", [org.id, other.data.id]);
    expect(rows?.find((row) => row.id === org.id)?.featured_image_url).toBe("https://example.test/admin.png");
    expect(rows?.find((row) => row.id === other.data.id)?.featured_image_url).toBeNull();
  } finally {
    await service().from("organizations").delete().eq("id", other.data.id);
  }
});
