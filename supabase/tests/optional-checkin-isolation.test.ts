import { afterAll, beforeAll, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const checked = <T>(result: { data: T; error: unknown }): T => {
  if (result.error) throw result.error;
  return result.data;
};
const users: string[] = [];
const orgs: string[] = [];
let orgA: string, orgB: string, eventA: string, eventB: string;
let registration: string, adminId: string, outsiderId: string;
let admin: SupabaseClient, outsider: SupabaseClient;

async function user(role: string, orgId: string) {
  const email = `optional-checkin-${crypto.randomUUID()}@test.dev`;
  const created = checked(await service.auth.admin.createUser({ email, password: "password123", email_confirm: true })).user!;
  users.push(created.id);
  checked(await service.from("user_roles").insert({ user_id: created.id, org_id: orgId, role }));
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  checked(await client.auth.signInWithPassword({ email, password: "password123" }));
  return { id: created.id, client };
}

beforeAll(async () => {
  const a = checked(await service.from("organizations").insert({ name: "Optional check-in A", slug: crypto.randomUUID() }).select("id").single());
  const b = checked(await service.from("organizations").insert({ name: "Optional check-in B", slug: crypto.randomUUID() }).select("id").single());
  orgA = a.id; orgB = b.id;
  orgs.push(orgA, orgB);
  const adminUser = await user("admin", orgA);
  const outsiderUser = await user("admin", orgB);
  adminId = adminUser.id; outsiderId = outsiderUser.id;
  admin = adminUser.client; outsider = outsiderUser.client;
  const updated = checked(await admin.from("organizations")
    .update({ check_in_required_default: false }).eq("id", orgA).select("id"));
  expect(updated).toHaveLength(1);
  eventA = checked(await service.from("events")
    .insert({ org_id: orgA, name: "No scans race", status: "draft" })
    .select("id,check_in_required").single()).id;
  eventB = checked(await service.from("events")
    .insert({ org_id: orgB, name: "Foreign race", status: "draft" })
    .select("id").single()).id;
  const category = checked(await service.from("categories").insert({
    org_id: orgA, event_id: eventA, code: "10K", label: "10K", base_price: 10000, slots_total: 10,
  }).select("id").single());
  registration = checked(await service.from("registrations").insert({
    org_id: orgA, event_id: eventA, category_id: category.id, user_id: adminId,
    status: "paid", total_amount: 10000,
  }).select("id").single()).id;
});

afterAll(async () => {
  for (const id of orgs) checked(await service.from("organizations").delete().eq("id", id));
  for (const id of users) checked(await service.auth.admin.deleteUser(id));
});

it("copies the organizer default only to new events and blocks all new check-in writes", async () => {
  const event = checked(await service.from("events").select("check_in_required").eq("id", eventA).single());
  expect(event.check_in_required).toBe(false);
  expect(checked(await admin.rpc("checkin_event_required", { p_event_id: eventA }))).toBe(false);
  expect(checked(await admin.rpc("checkin_events"))).toEqual(expect.arrayContaining([expect.objectContaining({ id: eventA })]));
  expect(checked(await service.rpc("checkin_record_tx", {
    p_registration_id: registration, p_event_id: eventA, p_actor_id: adminId,
  }))).toMatchObject({ error: "check_in_disabled" });
  expect(checked(await service.from("checkins").select("id").eq("registration_id", registration))).toEqual([]);
  const kit = checked(await service.rpc("kit_snapshot", { p_registration_id: registration }));
  expect(checked(await service.rpc("kit_release_tx", {
    p_registration_id: registration, p_event_id: eventA, p_actor_id: adminId,
    p_request_id: crypto.randomUUID(), p_expected_kit: kit,
  }))).toMatchObject({ ok: true });

  checked(await admin.from("organizations").update({ check_in_required_default: true }).eq("id", orgA));
  expect(checked(await service.from("events").select("check_in_required").eq("id", eventA).single()).check_in_required).toBe(false);
  const next = checked(await service.from("events").insert({ org_id: orgA, name: "New default" }).select("id,check_in_required").single());
  expect(next.check_in_required).toBe(true);
  const audit = checked(await admin.from("checkin_settings_audit").select("event_id,previous_value,required_value").eq("org_id", orgA));
  expect(audit).toEqual(expect.arrayContaining([
    expect.objectContaining({ event_id: null, previous_value: true, required_value: false }),
    expect.objectContaining({ event_id: null, previous_value: false, required_value: true }),
  ]));
});

it("limits event override to an organizer admin and keeps the change history", async () => {
  const editor = await user("editor", orgA);
  try {
    expect((await editor.client.from("events").update({ check_in_required: true }).eq("id", eventA)).error).toBeTruthy();
    expect(checked(await service.from("events").select("check_in_required").eq("id", eventA).single()).check_in_required).toBe(false);
    expect(checked(await admin.from("events").update({ check_in_required: true }).eq("id", eventA).select("id"))).toHaveLength(1);
    expect(checked(await admin.rpc("checkin_event_required", { p_event_id: eventA }))).toBe(true);
    expect(checked(await admin.from("checkin_settings_audit").select("actor_id,previous_value,required_value")
      .eq("event_id", eventA))).toEqual([{
      actor_id: adminId, previous_value: false, required_value: true,
    }]);
  } finally {
    checked(await service.from("user_roles").delete().eq("user_id", editor.id));
  }
});

it("denies a foreign organizer private rows, check-in operations, and setting changes", async () => {
  expect(checked(await outsider.from("events").select("id").eq("id", eventA))).toEqual([]);
  expect(checked(await outsider.from("registrations").select("id").eq("id", registration))).toEqual([]);
  expect(checked(await outsider.from("admin_registrations_v").select("id").eq("event_id", eventA))).toEqual([]);
  expect(checked(await outsider.rpc("admin_registration_emails", { p_event_id: eventA }))).toEqual([]);
  expect(checked(await outsider.rpc("checkin_roster", { p_event_id: eventA }))).toEqual([]);
  expect(checked(await outsider.rpc("checkin_event_required", { p_event_id: eventA }))).toBeNull();
  expect(checked(await outsider.rpc("kit_release_roster", { p_event_id: eventA }))).toEqual([]);
  expect(checked(await service.rpc("checkin_record_tx", {
    p_registration_id: registration, p_event_id: eventA, p_actor_id: outsiderId,
  }))).toMatchObject({ error: "forbidden" });
  expect(checked(await outsider.from("events").update({ check_in_required: false }).eq("id", eventA).select("id"))).toEqual([]);
  expect(checked(await outsider.from("organizations").update({ check_in_required_default: false }).eq("id", orgA).select("id"))).toEqual([]);
  expect(checked(await outsider.from("checkin_settings_audit").select("id").eq("org_id", orgA))).toEqual([]);
  expect(checked(await admin.rpc("checkin_event_required", { p_event_id: eventB }))).toBeNull();
});
