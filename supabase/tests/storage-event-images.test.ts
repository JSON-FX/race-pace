import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
import { seededIds } from "../../test/seeded";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });

async function makeUser(email: string) {
  const svc = service();
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}
// Resolved from the seed rather than restated — see test/seeded.ts.
let RWP: string, APO: string;
beforeAll(async () => {
  ({ ORG_A: RWP, ORG_B: APO } = await seededIds());
});

describe("event-images storage bucket", () => {
  it("exists and is public", async () => {
    const { data, error } = await service().storage.getBucket("event-images");
    expect(error).toBeNull();
    expect(data?.public).toBe(true);
  });

  it("an org admin writes only under their own org folder; anyone can read", async () => {
    const svc = service();
    const admin = await makeUser(`img_adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });
    const other = await makeUser(`img_oth_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: other.id, role: "admin", org_id: APO });
    const runner = await makeUser(`img_run_${Date.now()}@test.dev`);

    const body = new Blob(["hello"], { type: "text/plain" });
    const okPath = `${RWP}/${crypto.randomUUID()}.txt`;

    const up = await authed(admin.token).storage.from("event-images").upload(okPath, body);
    expect(up.error).toBeNull();

    const hack = await authed(other.token).storage.from("event-images").upload(`${RWP}/${crypto.randomUUID()}.txt`, body);
    expect(hack.error).not.toBeNull();

    const rup = await authed(runner.token).storage.from("event-images").upload(`${RWP}/${crypto.randomUUID()}.txt`, body);
    expect(rup.error).not.toBeNull();

    const publicUrl = svc.storage.from("event-images").getPublicUrl(okPath).data.publicUrl;
    const res = await fetch(publicUrl);
    expect(res.status).toBe(200);

    await svc.storage.from("event-images").remove([okPath]);
    await svc.from("user_roles").delete().in("user_id", [admin.id, other.id]);
  });
});
