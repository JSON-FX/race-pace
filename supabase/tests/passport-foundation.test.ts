import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey, dbUrl } = loadEnv();
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const anonymous = createClient(url, anonKey, { auth: { persistSession: false } });
const users: string[] = [];
const passports: string[] = [];
let owner: SupabaseClient;
let stranger: SupabaseClient;
let ownPassport: string;
let managed: string;

async function account() {
  const email = `passport-${randomUUID()}@example.com`;
  const created = await service.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (created.error) throw created.error;
  users.push(created.data.user.id);
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password: "password123" });
  if (login.error) throw login.error;
  return client;
}

beforeAll(async () => {
  owner = await account();
  stranger = await account();
  const own = await owner.from("runner_passports").select("id,first_name,claimed_user_id").single();
  expect(own.error).toBeNull();
  expect(own.data?.claimed_user_id).toBe(users[0]);
  expect(own.data?.first_name).toBeNull();
  ownPassport = own.data!.id;
  managed = randomUUID();
  passports.push(managed);
});
afterAll(async () => {
  const own = await service.from("runner_passports").select("id").in("claimed_user_id", users);
  for (const p of own.data ?? []) passports.push(p.id);
  await service.from("runner_passports").delete().in("id", passports);
  for (const id of users) await service.auth.admin.deleteUser(id);
});

describe("Passport foundation", () => {
  it("creates managed identities without auth accounts and retries return the same identity", async () => {
    for (let i = 0; i < 2; i++) {
      const result = await owner.rpc("passport_create_managed", { p_passport_id: managed });
      expect(result.error).toBeNull();
      expect(result.data).toBe(managed);
    }
    const row = await owner.from("runner_passports").select("claimed_user_id,created_by_user_id").eq("id", managed).single();
    expect(row.data).toEqual({ claimed_user_id: null, created_by_user_id: users[0] });
    const managers = await owner.from("passport_managers").select("user_id").eq("passport_id", managed);
    expect(managers.data).toEqual([{ user_id: users[0] }]);
  });

  it("limits reads and edits to the owner or manager, including direct data calls", async () => {
    for (const id of [ownPassport, managed]) {
      const save = await owner.from("runner_passports").update({ first_name: "Ana", last_name: "Cruz", contact_number: "09171234567" }).eq("id", id).select();
      expect(save.error).toBeNull();
      expect(save.data).toHaveLength(1);
      const hidden = await stranger.from("runner_passports").select("*").eq("id", id);
      expect(hidden.data).toEqual([]);
      const denied = await stranger.from("runner_passports").update({ first_name: "Forged" }).eq("id", id).select();
      expect(denied.data).toEqual([]);
    }
    expect((await anonymous.from("runner_passports").select("*")).error?.code).toBe("42501");
  });

  it("does not grant ownership or management through client supplied identifiers", async () => {
    expect((await stranger.rpc("passport_create_managed", { p_passport_id: managed })).error?.code).toBe("42501");
    expect((await anonymous.rpc("passport_create_managed", { p_passport_id: randomUUID() })).error?.code).toBe("42501");
    expect((await owner.from("runner_passports").update({ claimed_user_id: users[0] }).eq("id", managed)).error?.code).toBe("42501");
    expect((await stranger.from("passport_managers").insert({ passport_id: managed, user_id: users[1] })).error?.code).toBe("42501");
    expect((await owner.from("runner_passports").insert({ created_by_user_id: users[0] })).error?.code).toBe("42501");
    expect((await owner.from("runner_passports").delete().eq("id", managed)).error?.code).toBe("42501");
  });

  it("backfills existing accounts and registrations without changing legacy data", async () => {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    try {
      const missing = await db.query(`select count(*)::int as count from auth.users u
        left join public.runner_passports p on p.claimed_user_id=u.id where p.id is null`);
      expect(missing.rows[0].count).toBe(0);
      const mismatched = await db.query(`select count(*)::int as count from public.registrations r
        left join public.runner_passports p on p.id=r.participant_passport_id
        where p.id is null or p.claimed_user_id is distinct from r.user_id or r.booked_by_user_id is null`);
      expect(mismatched.rows[0].count).toBe(0);
      const grants = await db.query(`select
        has_column_privilege('authenticated','public.runner_passports','first_name','UPDATE') as editable,
        has_column_privilege('authenticated','public.runner_passports','claimed_user_id','UPDATE') as claimable,
        has_table_privilege('authenticated','public.passport_managers','INSERT') as grantable`);
      expect(grants.rows[0]).toEqual({ editable: true, claimable: false, grantable: false });
    } finally { await db.end(); }
  });

  it("validates shipping references and keeps the ZIP code as a four-digit string", async () => {
    const address = { shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "Unit 1, Sample Street" };
    const saved = await owner.from("runner_passports").update(address).eq("id", managed).select("shipping_zip_code").single();
    expect(saved.error).toBeNull(); expect(saved.data?.shipping_zip_code).toBe("0123");
    expect((await owner.from("runner_passports").update({ shipping_barangay_code: "999999999" }).eq("id", managed)).error?.code).toBe("23503");
    expect((await owner.from("runner_passports").update({ shipping_zip_code: "123" }).eq("id", managed)).error?.code).toBe("23514");
    expect((await owner.from("runner_passports").update({ shipping_address_line: "  " }).eq("id", managed)).error?.code).toBe("23514");
    expect((await anonymous.from("psgc_barangays").select("code").eq("code", address.shipping_barangay_code)).data).toHaveLength(1);
    expect((await owner.from("psgc_barangays").update({ name: "Tampered" }).eq("code", address.shipping_barangay_code)).error?.code).toBe("42501");
  });

  it("syncs self prefill while preserving bib names and never overwrites the helper from a managed Passport", async () => {
    expect((await service.from("profiles").upsert({ id: users[0], bib_name: "LEGACY" })).error).toBeNull();
    const update = { first_name: "Ana", last_name: "Santos", emergency_contact_name: "Juan", emergency_contact_number: "09171234567" };
    expect((await owner.from("runner_passports").update(update).eq("id", ownPassport)).error).toBeNull();
    expect((await owner.from("runner_passports").update({ ...update, first_name: "Lola" }).eq("id", managed)).error).toBeNull();
    const profile = await service.from("profiles").select("full_name,bib_name,emergency_contact").eq("id", users[0]).single();
    expect(profile.data).toEqual({ full_name: "Ana Santos", bib_name: "LEGACY", emergency_contact: "Juan — 09171234567" });
  });

  it("cannot recreate revoked management through a creation retry", async () => {
    const id = randomUUID();
    passports.push(id);
    const created = await Promise.all([1, 2].map(() => owner.rpc("passport_create_managed", { p_passport_id: id })));
    for (const result of created) expect(result.error).toBeNull();
    expect((await service.from("passport_managers").delete().eq("passport_id", id)).error).toBeNull();
    expect((await owner.rpc("passport_create_managed", { p_passport_id: id })).error?.code).toBe("42501");
    expect((await owner.from("runner_passports").select("id").eq("id", id)).data).toEqual([]);
  });

  it("keeps self registration compatible and rejects mismatched participant accounts", async () => {
    const org = await service.from("organizations").insert({ name: "Passport QA", slug: `passport-${randomUUID()}` }).select().single();
    expect(org.error).toBeNull();
    try {
      const event = await service.from("events").insert({ org_id: org.data.id, name: "Identity QA" }).select().single();
      const category = await service.from("categories").insert({ org_id: org.data.id, event_id: event.data.id, code: "10k", label: "10k", base_price: 0, slots_total: 10 }).select().single();
      const input = { org_id: org.data.id, event_id: event.data.id, category_id: category.data.id, user_id: users[0], total_amount: 0 };
      const created = await service.from("registrations").insert(input).select("participant_passport_id,booked_by_user_id").single();
      expect(created.error).toBeNull();
      expect(created.data).toEqual({ participant_passport_id: ownPassport, booked_by_user_id: users[0] });
      const assisted = await service.from("registrations").insert({ ...input, participant_passport_id: managed });
      expect(assisted.error?.message).toContain("participant_account_mismatch");
    } finally {
      await service.from("organizations").delete().eq("id", org.data.id);
    }
  });
});
