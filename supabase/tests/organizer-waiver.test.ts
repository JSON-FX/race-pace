import { afterAll, beforeAll, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { loadEnv } from "../../test/env";
const { url, anonKey, serviceKey } = loadEnv();
const options = { auth: { persistSession: false } };
const service = createClient(url, serviceKey, options);
const admin = createClient(url, anonKey, options);
const anon = createClient(url, anonKey, options);
const org = randomUUID(), other = randomUUID(), version = randomUUID();
let user: string;
const body = "Sample organizer waiver — participant acceptance only.";
beforeAll(async () => {
 const email = `waiver-${randomUUID()}@example.com`;
 const result = await service.auth.admin.createUser({ email, password: "password123", email_confirm: true });
 if (result.error) throw result.error;
 user = result.data.user.id;
 const orgs = await service.from("organizations").insert([
  { id: org, name: "Waiver QA", slug: org }, { id: other, name: "Other QA", slug: other },
 ]);
 if (orgs.error) throw orgs.error;
 const role = await service.from("user_roles").insert({ user_id: user, org_id: org, role: "admin" });
 if (role.error) throw role.error;
 const login = await admin.auth.signInWithPassword({ email, password: "password123" });
 if (login.error) throw login.error;
});
afterAll(async () => {
 await service.from("events").delete().in("org_id", [org, other]);
 await service.from("organizer_waiver_versions").delete().in("org_id", [org, other]);
 await service.from("user_roles").delete().eq("user_id", user);
 await service.from("organizations").delete().in("id", [org, other]);
 await service.from("runner_passports").delete().eq("claimed_user_id", user);
 if (user) await service.auth.admin.deleteUser(user);
});
it("publishes exact text with a hash and safely retries", async () => {
 for (let i=0;i<2;i++) {
  const result = await admin.rpc("organizer_publish_waiver", { p_org_id: org, p_version_id: version, p_title: "Organizer waiver", p_body: body });
  expect(result.error).toBeNull(); expect(result.data).toBe(version);
 }
 const row = await anon.from("organizer_waiver_versions").select("body,content_hash,published_by").eq("id", version).single();
 expect(row.error).toBeNull();
 expect(row.data?.body).toBe(body);
 expect(row.data?.content_hash).toBe(createHash("sha256").update(body).digest("hex"));
 expect(row.data?.published_by).toBe(user);
});
it("denies publishing for another organizer and anonymous publication", async () => {
 const input = { p_org_id: other, p_version_id: randomUUID(), p_title: "Waiver", p_body: body };
 expect((await admin.rpc("organizer_publish_waiver", input)).error?.code).toBe("42501");
 expect((await anon.rpc("organizer_publish_waiver", input)).error?.code).toBe("42501");
});
it("cannot rewrite or delete published history through direct API calls or retry", async () => {
 expect((await admin.from("organizer_waiver_versions").update({ body: "Changed" }).eq("id", version)).error?.code).toBe("42501");
 expect((await admin.from("organizer_waiver_versions").delete().eq("id", version)).error?.code).toBe("42501");
 expect((await admin.rpc("organizer_publish_waiver", { p_org_id: org, p_version_id: version, p_title: "Organizer waiver", p_body: "Changed" })).error?.code).toBe("22023");
});

it("denies publishing through an editor-only database role", async () => {
 const changed = await service.from("user_roles").update({ role: "editor" }).eq("user_id", user).eq("org_id", org);
 expect(changed.error).toBeNull();
 try {
  expect((await admin.rpc("organizer_publish_waiver", { p_org_id: org, p_version_id: randomUUID(), p_title: "Editor attempt", p_body: body })).error?.code).toBe("42501");
 } finally {
  await service.from("user_roles").update({ role: "admin" }).eq("user_id", user).eq("org_id", org);
 }
});

it("binds an event to its own waiver and preserves canonical acceptance after replacement", async () => {
 const ev = await service.from("events").insert({ org_id: org, name: "Waiver event", status: "open" }).select().single();
 expect(ev.error).toBeNull();
 const category = await service.from("categories").insert({ org_id: org, event_id: ev.data.id, code: "W", label: "Waiver", base_price: 10000, slots_total: 10 }).select().single();
 expect(category.error).toBeNull();
 expect((await admin.rpc("event_select_waiver", { p_event_id: ev.data.id, p_version_id: version })).error).toBeNull();
 const cross = await service.from("events").insert({ org_id: other, name: "Other event", status: "open" }).select().single();
 expect((await service.from("events").update({ waiver_version_id: version }).eq("id", cross.data.id)).error?.code).toBe("23503");
 await service.from("runner_passports").update({ first_name: "Actual", last_name: "Participant" }).eq("claimed_user_id", user);
 const input = { org_id: org, event_id: ev.data.id, category_id: category.data.id, user_id: user, total_amount: 10000, idempotency_key: randomUUID(), waiver_accepted_at: "2000-01-01T00:00:00Z" };
 const stale = await service.from("registrations").insert(input);
 expect(stale.error?.message).toContain("waiver_version_changed");
 const accepted = await service.from("registrations").insert({ ...input, waiver_version_id: version, waiver_acceptance: { accepting_name: "Forged" } }).select("id,waiver_acceptance,waiver_accepted_at").single();
 expect(accepted.error).toBeNull();
 expect(accepted.data?.waiver_acceptance).toMatchObject({ version_id: version, accepting_name: "Actual Participant", booking_actor_id: user, capacity: "participant", method: "signed_in_self" });
 expect(accepted.data?.waiver_accepted_at).not.toContain("2000-01-01");
 expect((await service.from("registrations").update({ waiver_acceptance: {} }).eq("id", accepted.data.id)).error?.message).toContain("waiver_evidence_immutable");
 const next = randomUUID();
 expect((await admin.rpc("organizer_publish_waiver", { p_org_id: org, p_version_id: next, p_title: "Replacement", p_body: "Replacement text" })).error).toBeNull();
 expect((await admin.rpc("event_select_waiver", { p_event_id: ev.data.id, p_version_id: next })).error).toBeNull();
 expect((await service.from("registrations").select("waiver_acceptance").eq("id", accepted.data.id).single()).data?.waiver_acceptance).toEqual(accepted.data.waiver_acceptance);
 const { data: session } = await admin.auth.getSession();
 const response = await fetch(`${url}/functions/v1/registrations-checkout`, { method: "POST", headers: { Authorization: `Bearer ${session.session!.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ event_id: ev.data.id, category_id: category.data.id, waiver_accepted: true, waiver_version_id: version, idempotency_key: randomUUID() }) });
 expect(response.status).toBe(409);
 expect((await response.json()).error).toBe("waiver_version_changed");
 await service.from("user_roles").update({ role: "editor" }).eq("user_id", user).eq("org_id", org);
 try {
  expect((await admin.rpc("event_select_waiver", { p_event_id: ev.data.id, p_version_id: version })).error?.code).toBe("42501");
  expect((await admin.from("events").update({ waiver_version_id: version }).eq("id", ev.data.id)).error?.code).toBe("42501");
 } finally { await service.from("user_roles").update({ role: "admin" }).eq("user_id", user).eq("org_id", org); }
});
