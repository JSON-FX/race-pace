import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { loadEnv } from "../../test/env";

const db = new Client({ connectionString: loadEnv().dbUrl });
let org: string, otherOrg: string, admin: string, runner: string, passport: string;
const email = "discount-outside-runner@example.com";
const input = () => ({ kind: "special", discount_type: "percent", value: 2000,
  coverage: "entry", quantity: 1, passport_ids: [passport] });

beforeAll(() => db.connect());
beforeEach(async () => {
  await db.query("begin");
  [org, otherOrg, admin, runner] = Array.from({ length: 4 }, () => randomUUID());
  await db.query("insert into auth.users(id,email) values($1,$2),($3,$4)",
    [admin, `discount-admin-${admin}@example.com`, runner, email]);
  passport = (await db.query("select id from runner_passports where claimed_user_id=$1", [runner])).rows[0].id;
  await db.query("insert into organizations(id,name,slug) values($1::uuid,'Search QA',$1::text),($2::uuid,'Other QA',$2::text)", [org, otherOrg]);
  await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin')", [admin, org]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role','authenticated',true)", [admin]);
});
afterEach(async () => { await db.query("rollback"); });
afterAll(() => db.end());

async function search(query: string) {
  return (await db.query("select * from discount_passport_options($1,$2)", [org, query])).rows;
}
async function forbidden(sql: string, params: unknown[], message: string) {
  await db.query("savepoint denied_call");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.query("rollback to savepoint denied_call");
}

it("finds and assigns a registered runner with no organization history by name or email", async () => {
  await db.query("update runner_passports set first_name='Outside',last_name='Runner' where id=$1", [passport]);
  await db.query("set local role authenticated");
  for (const query of ["Outside Runner", " OUTSIDE ", "DISCOUNT-OUTSIDE-RUNNER@EXAMPLE.COM", passport]) {
    expect(await search(query)).toEqual([{ id: passport, label: "Outside Runner", email }]);
  }
  expect((await db.query("select * from discount_create($1,$2)", [org, input()])).rows[0])
    .toMatchObject({ org_id: org, assigned_passport_id: passport });
  expect((await db.query("select id from runner_passports where id=$1", [passport])).rowCount).toBe(0);
});

it("uses legacy, profile and account display names without inventing a missing name", async () => {
  await db.query("insert into profiles(id,full_name) values($1,'Profile Runner') on conflict(id) do update set full_name=excluded.full_name", [runner]);
  await db.query("update auth.users set raw_user_meta_data=$2 where id=$1", [runner, { full_name: "Account Runner", name: "Display Runner" }]);
  await db.query("update runner_passports set legacy_full_name='Legacy Runner' where id=$1", [passport]);
  expect(await search("Legacy Runner")).toEqual([{ id: passport, label: "Legacy Runner", email }]);
  await db.query("update runner_passports set legacy_full_name=' ' where id=$1", [passport]);
  expect(await search("Profile Runner")).toEqual([{ id: passport, label: "Profile Runner", email }]);
  await db.query("update profiles set full_name=null where id=$1", [runner]);
  expect(await search("Account Runner")).toEqual([{ id: passport, label: "Account Runner", email }]);
  await db.query("update auth.users set raw_user_meta_data=$2 where id=$1", [runner, { name: "Display Runner" }]);
  expect(await search("Display Runner")).toEqual([{ id: passport, label: "Display Runner", email }]);
  await db.query("update auth.users set raw_user_meta_data='{}' where id=$1", [runner]);
  expect(await search(email)).toEqual([{ id: passport, label: "Runner", email }]);
});

it("uses account email for claimed Passports, never an alternate participant address", async () => {
  await db.query("update runner_passports set participant_email='alternate-private@example.com' where id=$1", [passport]);
  expect(await search(email)).toEqual([{ id: passport, label: "Runner", email }]);
  expect(await search("alternate-private")).toEqual([]);
});

it("keeps managed runners discoverable only for their organization and uses their own email", async () => {
  const managed = randomUUID(), unknown = randomUUID(), event = randomUUID(), category = randomUUID(), waiver = randomUUID();
  await db.query("insert into runner_passports(id,created_by_user_id,first_name,participant_email) values($1,$2,'Managed','managed-participant@example.com'),($3,$2,'Unrelated','unrelated-managed@example.com')", [managed, runner, unknown]);
  await db.query("insert into passport_managers(passport_id,user_id) values($1,$2)", [managed, runner]);
  await db.query("insert into organizer_waiver_versions(id,org_id,title,body) values($1,$2,'Search QA','QA waiver')", [waiver, org]);
  await db.query("insert into events(id,org_id,name,status,waiver_version_id) values($1,$2,'Search QA','draft',$3)", [event, org, waiver]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'SEARCH','Search',10000,10)", [category, org, event]);
  await db.query("insert into registrations(org_id,event_id,category_id,user_id,booked_by_user_id,participant_passport_id,total_amount,waiver_version_id,waiver_acceptance_method) values($1,$2,$3,null,$4,$5,10000,$6,'participant_on_helper_device')", [org, event, category, runner, managed, waiver]);
  await db.query("set local role authenticated");
  expect(await search("managed-participant")).toEqual([{ id: managed, label: "Managed", email: "managed-participant@example.com" }]);
  expect((await search(email)).map((p) => p.id)).toEqual([passport]);
  expect(await search("unrelated-managed")).toEqual([]);
  expect((await db.query("select * from discount_create($1,$2)", [org, { ...input(), passport_ids: [managed] }])).rows[0].assigned_passport_id).toBe(managed);
  await forbidden("select * from discount_create($1,$2)", [org, { ...input(), passport_ids: [unknown] }], "invalid_assignment");
});

it("denies editors, ordinary runners and requests for another organization", async () => {
  await db.query("set local role authenticated");
  await forbidden("select * from discount_passport_options($1,$2)", [otherOrg, email], "forbidden");
  await forbidden("select * from discount_create($1,$2)", [otherOrg, input()], "forbidden");
  await db.query("reset role");
  await db.query("update user_roles set role='editor' where user_id=$1", [admin]);
  await db.query("set local role authenticated");
  await forbidden("select * from discount_passport_options($1,$2)", [org, email], "forbidden");
  await forbidden("select * from discount_create($1,$2)", [org, input()], "forbidden");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [runner]);
  await forbidden("select * from discount_passport_options($1,$2)", [org, email], "forbidden");
});

it("rejects anonymous-account, missing and duplicate assignments and preserves grants", async () => {
  await db.query("update auth.users set is_anonymous=true where id=$1", [runner]);
  expect(await search(email)).toEqual([]);
  await forbidden("select * from discount_create($1,$2)", [org, input()], "invalid_assignment");
  await forbidden("select * from discount_create($1,$2)", [org, { ...input(), passport_ids: [randomUUID()] }], "invalid_assignment");
  await forbidden("select * from discount_create($1,$2)", [org, { ...input(), quantity: 2, passport_ids: [passport, passport] }], "invalid_assignment");
  const grants = (await db.query("select has_function_privilege('anon','public.discount_passport_options(uuid,text)','execute') anon, has_function_privilege('authenticated','public.discount_passport_options(uuid,text)','execute') authenticated, has_function_privilege('service_role','public.discount_passport_options(uuid,text)','execute') service")).rows[0];
  expect(grants).toEqual({ anon: false, authenticated: true, service: true });
});

it("limits matches to 50 and treats wildcard characters as literal input", async () => {
  await db.query("insert into auth.users(id,email,raw_user_meta_data) select gen_random_uuid(),'bounded-'||i||'@example.com','{\"full_name\":\"Bounded Runner\"}'::jsonb from generate_series(1,55) i");
  expect(await search("Bounded Runner")).toHaveLength(50);
  expect(await search("Bounded%Runner")).toEqual([]);
  expect(await search("Bounded_Runner")).toEqual([]);
});
