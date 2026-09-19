import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";
import { groupReservationInputSchema } from "../functions/_shared/groupRegistration";
import { prepareGroupLine } from "../functions/_shared/groupReservationValidation";

const env = loadEnv();
const svc = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
const db = new Client({ connectionString: env.dbUrl });
const org = randomUUID(), event = randomUUID(), category = randomUUID(), waiver = randomUUID(), addon = randomUUID();
const guest = randomUUID(), secondGuest = randomUUID();
let actor: string, stranger: string, self: string, token: string, strangerToken: string;
let handler: (req: Request) => Promise<Response>;
const settings: Record<string, string> = { SUPABASE_URL: env.url, SUPABASE_SERVICE_ROLE_KEY: env.serviceKey, GROUP_RESERVATIONS_ENABLED: "true" };
const identity = { first_name: "QA", last_name: "Participant", date_of_birth: "1950-01-01", gender: "Female", contact_number: "09171234567", emergency_contact_name: "Helper", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", shirt_size: "S", shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "Unit 1, Sample Street" };
async function account() {
  const email = `group-${randomUUID()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password: "password123" });
  if (login.error) throw login.error;
  return { id: created.data.user.id, token: login.data.session!.access_token };
}
function request(ids = [self, guest]) {
  return groupReservationInputSchema.parse({ event_id: event, category_id: category, idempotency_key: randomUUID(), waiver_version_id: waiver,
    participants: ids.map((id) => ({ participant_passport_id: id, addon_ids: id === guest ? [addon] : [], shirt_size: id === guest ? "M" : "XL", custom_data: { first_name: "Fake" }, waiver_accepted: true,
      waiver_acceptance_method: id === self ? "signed_in_self" : "participant_on_helper_device" })) });
}
async function call(payload: unknown, bearer = token) {
  return handler(new Request("http://localhost/group-reservations", { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(payload) }));
}
async function snapshots(input = request()) {
  const rows = await svc.from("runner_passports").select("*").in("id", input.participants.map((p) => p.participant_passport_id));
  if (rows.error) throw rows.error;
  return { p_actor: actor, p_request: input, p_fields: [], p_lines: input.participants.map((line) => prepareGroupLine(line, rows.data.find((p) => p.id === line.participant_passport_id)!, [], actor, "2026-09-17")) };
}
async function rpc(connection: Client, args: Awaited<ReturnType<typeof snapshots>>) {
  return (await connection.query("select booking_order_reserve($1,$2,$3,$4) as result", [args.p_actor, args.p_request, JSON.stringify(args.p_lines), JSON.stringify(args.p_fields)])).rows[0].result;
}
beforeAll(async () => {
  await db.connect();
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  const a = await account(), b = await account(); actor = a.id; token = a.token; stranger = b.id; strangerToken = b.token;
  self = (await db.query("select id from runner_passports where claimed_user_id=$1", [actor])).rows[0].id;
  await db.query("insert into organizations(id,name,slug) values($1::uuid,'Group reservation QA',$1::text)", [org]);
  await db.query("insert into organizer_waiver_versions(id,org_id,title,body) values($1,$2,'QA waiver','Sample waiver only')", [waiver, org]);
  await db.query("insert into events(id,org_id,name,status,waiver_version_id) values($1,$2,'Group QA','open',$3)", [event, org, waiver]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'QA','QA',100000,10)", [category, org, event]);
  await db.query("insert into addons(id,org_id,event_id,name,price) values($1,$2,$3,'Sample kit',25000)", [addon, org, event]);
  for (const id of [guest, secondGuest]) {
    await db.query("insert into runner_passports(id,created_by_user_id) values($1,$2)", [id, actor]);
    await db.query("insert into passport_managers(passport_id,user_id) values($1,$2)", [id, actor]);
  }
  vi.stubGlobal("Deno", { env: { get: (key: string) => settings[key] }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/group-reservations/index");
});
beforeEach(async () => {
  settings.GROUP_RESERVATIONS_ENABLED = "true";
  await db.query("delete from registrations where event_id=$1", [event]);
  await db.query("delete from booking_orders where event_id=$1", [event]);
  await db.query("delete from form_fields where event_id=$1", [event]);
  await db.query("update categories set slots_total=10,slots_taken=0,base_price=100000 where id=$1", [category]);
  await db.query("update events set status='open',registration_closes_at=null where id=$1", [event]);
  await db.query("update organizations set is_active=true where id=$1", [org]);
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [actor]);
  const update = await svc.from("runner_passports").update(identity).in("id", [self, guest, secondGuest]);
  if (update.error) throw update.error;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.query("delete from registrations where event_id=$1", [event]);
  await db.query("delete from booking_orders where event_id=$1", [event]);
  await db.query("delete from events where id=$1", [event]);
  await db.query("delete from organizer_waiver_versions where id=$1", [waiver]);
  await db.query("delete from organizations where id=$1", [org]);
  await db.query("delete from runner_passports where id=any($1::uuid[]) or claimed_user_id=any($2::uuid[])", [[guest, secondGuest], [actor, stranger].filter(Boolean)]);
  for (const id of [actor, stranger].filter(Boolean)) await svc.auth.admin.deleteUser(id);
  await db.end();
});
it("reserves self plus a guest, freezes identity/options, computes entry totals and creates no payment/ticket", async () => {
  const input = request();
  const response = await call(input);
  expect(response.status, await response.clone().text()).toBe(200);
  const result = await response.json();
  expect(result).toMatchObject({ status: "pending", entry_total_cents: 225000 });
  expect(result.registrations).toHaveLength(2);
  const regs = (await db.query("select * from registrations where booking_order_id=$1", [result.order_id])).rows;
  expect(new Set(regs.map((r) => r.id)).size).toBe(2);
  for (const r of regs) {
    expect(r.custom_data.first_name).toBe("QA");
    expect(r.custom_data.shirt_size).toBe(r.participant_passport_id === guest ? "M" : "XL");
    expect(r.waiver_acceptance.accepting_name).toBe("QA Participant");
    expect(r.ticket_token).toBeNull();
    expect(r.expires_at.toISOString()).toBe(new Date(result.expires_at).toISOString());
  }
  expect((await db.query("select p.id from payments p join registrations r on r.id=p.registration_id where r.event_id=$1", [event])).rowCount).toBe(0);
  expect((await db.query("select price from registration_addons where registration_id=any($1::uuid[])", [regs.map((r) => r.id)])).rows).toEqual([{ price: 25000 }]);
  const payment = await fetch(`${env.url}/functions/v1/payment-session`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ registration_id: regs[0].id, method: "gcash" }) });
  expect(payment.status).toBe(409);
  expect(await payment.json()).toMatchObject({ error: "group_checkout_not_available" });
});
it("supports guests only and normalizes participant order on replay", async () => {
  const input = request([guest, secondGuest]);
  const first = await call(input); expect(first.status, await first.clone().text()).toBe(200);
  const result = await first.json();
  await db.query("update runner_passports set first_name=null where id=$1", [guest]);
  const replay = await call({ ...input, participants: [...input.participants].reverse() });
  expect(replay.status).toBe(200); expect(await replay.json()).toEqual(result);
  expect((await db.query("select user_id from registrations where booking_order_id=$1", [result.order_id])).rows).toEqual([{ user_id: null }, { user_id: null }]);
  const changed = await call({ ...input, participants: [input.participants[0]] });
  expect(changed.status).toBe(409); expect(await changed.json()).toMatchObject({ error: "idempotency_conflict" });
});
it("rolls back all entries when capacity is insufficient", async () => {
  await db.query("update categories set slots_total=1 where id=$1", [category]);
  const response = await call(request()); expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: "sold_out" });
  expect((await db.query("select id from booking_orders where event_id=$1", [event])).rowCount).toBe(0);
  expect((await db.query("select id from registrations where event_id=$1", [event])).rowCount).toBe(0);
});
it("fails closed for strangers, incomplete Passports, stale waivers and missing add-ons", async () => {
  const input = request();
  expect((await call(input, strangerToken)).status).toBe(403);
  await db.query("update runner_passports set first_name=null where id=$1", [guest]);
  expect(await (await call(input)).json()).toMatchObject({ error: "passport_incomplete" });
  await db.query("update runner_passports set first_name='QA' where id=$1", [guest]);
  expect(await (await call({ ...input, waiver_version_id: randomUUID() })).json()).toMatchObject({ error: "waiver_version_changed" });
  input.participants[0].addon_ids = [randomUUID()];
  expect(await (await call(input)).json()).toMatchObject({ error: "invalid_addons" });
  expect((await db.query("select id from booking_orders where event_id=$1", [event])).rowCount).toBe(0);
});
it("rejects closed, draft, suspended and unverified bookings", async () => {
  for (const status of ["closed", "draft"]) {
    await db.query("update events set status=$1 where id=$2", [status, event]);
    expect(await (await call(request())).json()).toMatchObject({ error: "registration_closed" });
  }
  await db.query("update events set status='open',registration_closes_at=now()-interval '1 second' where id=$1", [event]);
  expect(await (await call(request())).json()).toMatchObject({ error: "registration_closed" });
  await db.query("update events set registration_closes_at=null where id=$1", [event]);
  await db.query("update organizations set is_active=false where id=$1", [org]);
  expect(await (await call(request())).json()).toMatchObject({ error: "org_suspended" });
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [actor]);
  expect((await call(request())).status).toBe(403);
});
it("rejects changed server snapshots and denies direct client RPC execution", async () => {
  const args = await snapshots();
  await db.query("update runner_passports set first_name='Changed' where id=$1", [guest]);
  expect((await svc.rpc("booking_order_reserve", args)).error?.message).toBe("reservation_input_changed");
  const fresh = await snapshots();
  await db.query("insert into form_fields(org_id,event_id,key,label,type,required) values($1,$2,'experience','Experience','text',true)", [org, event]);
  expect((await svc.rpc("booking_order_reserve", fresh)).error?.message).toBe("reservation_input_changed");
  const client = createClient(env.url, env.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  expect((await client.rpc("booking_order_reserve", args)).error?.code).toBe("42501");
});
it("rechecks manager access and rejects add-ons from a different event", async () => {
  const args = await snapshots();
  await db.query("delete from passport_managers where passport_id=$1 and user_id=$2", [guest, actor]);
  try {
    expect((await svc.rpc("booking_order_reserve", args)).error?.message).toBe("participant_not_accessible");
  } finally { await db.query("insert into passport_managers(passport_id,user_id) values($1,$2)", [guest, actor]); }
  const otherEvent = randomUUID(), otherAddon = randomUUID();
  try {
    await db.query("insert into events(id,org_id,name,status) values($1,$2,'Other event','open')", [otherEvent, org]);
    await db.query("insert into addons(id,org_id,event_id,name,price) values($1,$2,$3,'Wrong event option',1)", [otherAddon, org, otherEvent]);
    const input = request(); input.participants[0].addon_ids = [otherAddon];
    expect(await (await call(input)).json()).toMatchObject({ error: "invalid_addons" });
    expect((await db.query("select id from booking_orders where event_id=$1", [event])).rowCount).toBe(0);
  } finally { await db.query("delete from events where id=$1", [otherEvent]); }
});
it("rolls back the whole group when one participant already has a live entry", async () => {
  await db.query("insert into registrations(org_id,event_id,category_id,user_id,total_amount,idempotency_key,waiver_version_id) values($1,$2,$3,$4,100000,$5,$6)", [org, event, category, actor, randomUUID(), waiver]);
  const response = await call(request()); expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "participant_already_registered" });
  expect((await db.query("select id from booking_orders where event_id=$1", [event])).rowCount).toBe(0);
  expect((await db.query("select id from registrations where event_id=$1", [event])).rowCount).toBe(1);
});
it("uses current server prices and prevents later order-term edits", async () => {
  const args = await snapshots();
  await db.query("update categories set base_price=120000 where id=$1", [category]);
  const result = await svc.rpc("booking_order_reserve", args);
  expect(result.error).toBeNull(); expect(result.data.entry_total_cents).toBe(265000);
  await expect(db.query("update booking_orders set entry_total_cents=1 where id=$1", [result.data.order_id])).rejects.toThrow("order_terms_immutable");
});
it("accepts required event answers and preserves each participant's own answer", async () => {
  await db.query("insert into form_fields(org_id,event_id,key,label,type,required) values($1,$2,'experience','Experience','text',true)", [org, event]);
  const input = request();
  expect(await (await call(input)).json()).toMatchObject({ error: "invalid_custom_data" });
  input.participants.forEach((line, index) => { line.custom_data.experience = `Participant ${index}`; });
  const response = await call(input); expect(response.status, await response.clone().text()).toBe(200);
  const result = await response.json();
  const rows = (await db.query("select custom_data from registrations where booking_order_id=$1 order by participant_passport_id", [result.order_id])).rows;
  expect(rows.map((row) => row.custom_data.experience)).toEqual(["Participant 0", "Participant 1"]);
});
it("does not renew an expired order on replay", async () => {
  const input = request();
  const response = await call(input); expect(response.status, await response.clone().text()).toBe(200);
  const result = await response.json();
  await db.query("update booking_orders set expires_at=now()-interval '1 hour' where id=$1", [result.order_id]);
  const replay = await call(input); const data = await replay.json();
  expect(data.status).toBe("expired"); expect(data.order_id).toBe(result.order_id);
  expect(Date.parse(data.expires_at)).toBeLessThan(Date.now());
});
it("serializes a group against legacy checkout for the remaining capacity", async () => {
  await db.query("update categories set slots_total=2 where id=$1", [category]);
  const args = await snapshots(request([guest, secondGuest]));
  const other = new Client({ connectionString: env.dbUrl }); await other.connect();
  try {
    await db.query("begin");
    const order = await rpc(db, args); expect(order.registrations).toHaveLength(2);
    const pending = other.query("insert into registrations(org_id,event_id,category_id,user_id,total_amount,idempotency_key,waiver_version_id) values($1,$2,$3,$4,100000,$5,$6)", [org, event, category, actor, randomUUID(), waiver]).then(() => null, (e) => e.message);
    await db.query("commit");
    expect(await pending).toContain("category_capacity_exhausted");
    expect((await db.query("select id from registrations where event_id=$1", [event])).rowCount).toBe(2);
  } finally { await db.query("rollback"); await other.end(); }
});
it("admits only one concurrent group when each needs both remaining slots", async () => {
  await db.query("update categories set slots_total=2 where id=$1", [category]);
  const responses = await Promise.all([call(request([self, guest])), call(request([self, secondGuest]))]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await db.query("select id from booking_orders where event_id=$1", [event])).rowCount).toBe(1);
  expect((await db.query("select id from registrations where event_id=$1", [event])).rowCount).toBe(2);
});
it("serializes simultaneous retries into one reservation", async () => {
  const input = request();
  const responses = await Promise.all([call(input), call(input)]);
  for (const response of responses) expect(response.status, await response.clone().text()).toBe(200);
  expect(await responses[0].json()).toEqual(await responses[1].json());
  expect((await db.query("select id from booking_orders where event_id=$1", [event])).rowCount).toBe(1);
});
it("blocks legacy checkout from reviving an expired group line by its internal key", async () => {
  const response = await call(request()); expect(response.status, await response.clone().text()).toBe(200);
  const result = await response.json();
  const reg = (await db.query("update registrations set status='expired',expires_at=null where booking_order_id=$1 returning *", [result.order_id])).rows[0];
  const legacy = await fetch(`${env.url}/functions/v1/registrations-checkout`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({
    event_id: event, category_id: category, participant_passport_id: reg.participant_passport_id,
    idempotency_key: reg.idempotency_key, waiver_accepted: true, waiver_version_id: waiver,
    waiver_acceptance_method: reg.waiver_acceptance_method,
  }) });
  expect(legacy.status).toBe(409);
  expect(await legacy.json()).toEqual({ error: "group_checkout_not_available" });
  expect((await db.query("select status from registrations where id=$1", [reg.id])).rows[0].status).toBe("expired");
  expect((await db.query("select id from payments where registration_id=$1", [reg.id])).rowCount).toBe(0);
});
it("stays disabled by default and rejects invalid credentials/payloads", async () => {
  delete settings.GROUP_RESERVATIONS_ENABLED;
  expect((await call(request())).status).toBe(503);
  settings.GROUP_RESERVATIONS_ENABLED = "true";
  expect((await call(request(), "invalid")).status).toBe(401);
  expect((await call({ ...request(), amount: 1 })).status).toBe(400);
  expect((await call({ data: "x".repeat(65536) })).status).toBe(413);
});
