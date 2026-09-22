import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { verifyTicketToken } from "../functions/_shared/ticket";
const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../functions/_shared/email.ts", async original => ({ ...await original<typeof import("../functions/_shared/email.ts")>(), sendEmail: mail.send }));
const refundProvider = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }));
vi.mock("../functions/_shared/paymongo.ts", async (original) => ({
  ...await original<typeof import("../functions/_shared/paymongo.ts")>(), pmCreateRefund: refundProvider.create, pmGetRefund: refundProvider.get,
}));
const provider = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn() }));
vi.mock("../functions/_shared/groupPaymongo.ts", async (original) => ({
  ...await original<typeof import("../functions/_shared/groupPaymongo.ts")>(), createGroupSession: provider.create, retrieveGroupSession: provider.retrieve,
}));
import { loadEnv } from "../../test/env";
import { prepareGroupLine } from "../functions/_shared/groupReservationValidation";
import { groupReservationInputSchema } from "../functions/_shared/groupRegistration";
import { quoteGroup, type GroupFeeTerms, type GroupRate } from "../functions/_shared/groupPricing";
const env = loadEnv(), db = new Client({ connectionString: env.dbUrl });
const svc = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
const org = randomUUID(), event = randomUUID(), category = randomUUID(), category2 = randomUUID(), guest = randomUUID(), waiver = randomUUID(), addon = randomUUID();
let actor: string, stranger: string, token: string, strangerToken: string, self: string;
let handler: (req: Request) => Promise<Response>;
let deliveryHandler: (req: Request) => Promise<Response>;
let refundHandler: (req: Request) => Promise<Response>;
let groupHandler: (req: Request) => Promise<Response>;
let cancelHandler: (req: Request) => Promise<Response>;
const settings: Record<string, string> = { SUPABASE_URL: env.url, SUPABASE_SERVICE_ROLE_KEY: env.serviceKey, GROUP_RESERVATIONS_ENABLED: "true", GROUP_PAYMENT_PREPARATION_ENABLED: "true", GROUP_PAYMENTS_ENABLED: "true", GROUP_REFUNDS_ENABLED: "true", PAYMONGO_SECRET_KEY: "sk_test_mock_only", TICKET_SIGNING_SECRET: "group-test-secret", GROUP_PAYMENT_RETURN_URL: "https://racepace.test/bookings" };
async function account() {
  const email = `payment-prepare-${randomUUID()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password: "password123" });
  if (login.error) throw login.error;
  return { id: created.data.user.id, token: login.data.session!.access_token };
}
async function reserve(mixedCategories = false) {
  const input = groupReservationInputSchema.parse({ event_id: event, ...(mixedCategories ? {} : { category_id: category }), waiver_version_id: waiver, idempotency_key: randomUUID(), participants: [self, guest].map((id) => ({
    participant_passport_id: id, ...(mixedCategories ? { category_id: id === self ? category : category2 } : {}), addon_ids: id === guest ? [addon] : [], waiver_accepted: true, waiver_acceptance_method: id === self ? "signed_in_self" : "participant_on_helper_device",
  })) });
  const rows = await svc.from("runner_passports").select("*").in("id", [self, guest]);
  if (rows.error) throw rows.error;
  const lines = input.participants.map((line) => prepareGroupLine(line, rows.data.find((p) => p.id === line.participant_passport_id)!, [], actor, "2026-09-17"));
  const result = await svc.rpc("booking_order_reserve", { p_actor: actor, p_request: input, p_lines: lines, p_fields: [] });
  if (result.error) throw result.error;
  return result.data.order_id as string;
}
function args(order: string, key = randomUUID(), method = "card") { return { p_actor: actor, p_order: order, p_method: method, p_key: key }; }
async function call(order: string, key = randomUUID(), method = "card", bearer = token) {
  return handler(new Request("http://localhost/group-payment-prepare", { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ order_id: order, method, idempotency_key: key }) }));
}
beforeAll(async () => {
  await db.connect(); await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  const a = await account(), b = await account(); actor = a.id; token = a.token; stranger = b.id; strangerToken = b.token;
  self = (await db.query("select id from runner_passports where claimed_user_id=$1", [actor])).rows[0].id;
  await db.query("insert into organizations(id,name,slug) values($1::uuid,'Payment preparation QA',$1::text)", [org]);
  await db.query("insert into organizer_waiver_versions(id,org_id,title,body) values($1,$2,'QA waiver','Sample waiver')", [waiver, org]);
  await db.query("insert into events(id,org_id,name,status,waiver_version_id) values($1,$2,'Payment preparation QA','open',$3)", [event, org, waiver]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','Q',100000,20)", [category, org, event]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'U','Ultra',175000,20)", [category2, org, event]);
  await db.query("insert into addons(id,org_id,event_id,name,price) values($1,$2,$3,'Optional kit',25000)", [addon, org, event]);
  await db.query("insert into runner_passports(id,created_by_user_id) values($1,$2)", [guest, actor]);
  await db.query("insert into passport_managers(passport_id,user_id) values($1,$2)", [guest, actor]);
  const updated = await svc.from("runner_passports").update({ first_name: "QA", last_name: "Runner", date_of_birth: "1950-01-01", gender: "Female", contact_number: "09171234567", emergency_contact_name: "Helper", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "Unit 1, Sample Street" }).in("id", [self, guest]);
  if (updated.error) throw updated.error;
  vi.stubGlobal("Deno", { env: { get: (key: string) => settings[key] }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/group-payment-prepare/index");
  vi.stubGlobal("Deno", { env: { get: (key: string) => settings[key] }, serve: (fn: typeof handler) => { groupHandler = fn; } });
  await import("../functions/group-payment/index");
  vi.stubGlobal("Deno", { env: { get: (key: string) => settings[key] }, serve: (fn: typeof handler) => { refundHandler = fn; } });
  await import("../functions/admin-group-refund/index");
  vi.stubGlobal("Deno", { env: { get: (key: string) => settings[key] }, serve: (fn: typeof handler) => { deliveryHandler = fn; } });
  await import("../functions/group-ticket-delivery/index");
  vi.stubGlobal("Deno", { env: { get: (key: string) => settings[key] }, serve: (fn: typeof handler) => { cancelHandler = fn; } });
  await import("../functions/group-order-cancel/index");
});
beforeEach(async () => {
  settings.GROUP_RESERVATIONS_ENABLED = "true";
  settings.GROUP_PAYMENT_PREPARATION_ENABLED = "true";
  settings.GROUP_PAYMENTS_ENABLED = "true";
  await db.query("delete from user_roles where user_id=$1 and role='super_admin'", [actor]);
  settings.GROUP_REFUNDS_ENABLED = "true";
  settings.PAYMONGO_SECRET_KEY = "sk_test_mock_only";
  await db.query("delete from user_roles where user_id=$1 and org_id=$2", [stranger, org]);
  await db.query("update organizations set refund_policy='full',refund_fee_cents=0 where id=$1", [org]);
  settings.GROUP_TICKET_DELIVERY_ENABLED="true";
  settings.TICKET_EMAIL_SECRET="qa-delivery-secret";
  settings.PUBLIC_SITE_URL="https://racepace.test";
  settings.PUBLIC_FUNCTIONS_URL="https://functions.racepace.test";
  vi.clearAllMocks();
  mail.send.mockResolvedValue({ok:true});
  provider.create.mockResolvedValue({ sessionId: "cs_mocksession", checkoutUrl: "https://checkout.paymongo.com/mock" });
  await db.query("delete from booking_refund_lines where org_id=$1", [org]);
  await db.query("delete from booking_refund_requests where org_id=$1", [org]);
  await db.query("delete from booking_order_deliveries where org_id=$1", [org]);
  await db.query("delete from booking_payment_allocations where org_id=$1", [org]);
  await db.query("delete from payout_statements where org_id=$1", [org]);
  await db.query("delete from booking_payment_captures where org_id=$1", [org]);
  await db.query("delete from booking_payment_dispatches where org_id=$1", [org]);
  await db.query("delete from booking_payment_attempts where org_id=$1", [org]);
  await db.query("delete from registrations where event_id=$1", [event]);
  await db.query("delete from booking_orders where event_id=$1", [event]);
  await db.query("update organizations set fee_mode='pass_on',commission_type='fixed',commission_flat_cents=1000,commission_rate=0.03,is_active=true where id=$1", [org]);
  await db.query("update categories set base_price=case when id=$1 then 100000 else 175000 end,slots_total=20,slots_taken=0 where id=any($2::uuid[])", [category, [category, category2]]);
  await db.query("update addons set price=25000 where id=$1", [addon]);
  await db.query("update events set status='open' where id=$1", [event]);
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [actor]);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await db.query("delete from booking_refund_lines where org_id=$1", [org]);
  await db.query("delete from booking_refund_requests where org_id=$1", [org]);
  await db.query("delete from booking_order_deliveries where org_id=$1", [org]);
  await db.query("delete from booking_payment_allocations where org_id=$1", [org]);
  await db.query("delete from payout_statements where org_id=$1", [org]);
  await db.query("delete from booking_payment_captures where org_id=$1", [org]);
  await db.query("delete from booking_payment_dispatches where org_id=$1", [org]);
  await db.query("delete from booking_payment_attempts where org_id=$1", [org]);
  await db.query("delete from registrations where event_id=$1", [event]);
  await db.query("delete from booking_orders where event_id=$1", [event]);
  await db.query("delete from events where id=$1", [event]);
  await db.query("delete from organizer_waiver_versions where id=$1", [waiver]);
  await db.query("delete from organizations where id=$1", [org]);
  await db.query("delete from runner_passports where id=$1 or claimed_user_id=any($2::uuid[])", [guest, [actor, stranger].filter(Boolean)]);
  for (const id of [actor, stranger].filter(Boolean)) await svc.auth.admin.deleteUser(id);
  await db.end();
});
it("prepares one combined quote with exact participant allocations and no charge", async () => {
  const order = await reserve(); const response = await call(order);
  expect(response.status, await response.clone().text()).toBe(200);
  const result = await response.json();
  const expected = quoteGroup(result.lines.map((l: { registration_id: string; base_cents: number }) => ({ id: l.registration_id, base_cents: l.base_cents })), result.terms_snapshot as GroupFeeTerms, result.terms_snapshot as GroupRate);
  expect(result).toMatchObject({ status: "prepared", currency: "PHP", base_cents: 225000, platform_fee_cents: 2000 });
  for (const key of ["gross_cents", "platform_fee_cents", "processor_surcharge_cents", "processor_fee_predicted_cents", "net_to_org_predicted_cents"] as const) expect(result[key]).toBe(expected[key]);
  for (const line of expected.lines) expect(result.lines.find((l: { registration_id: string }) => l.registration_id === line.registration_id)).toMatchObject(line);
  expect((await db.query("select p.id from payments p join registrations r on r.id=p.registration_id where r.event_id=$1", [event])).rowCount).toBe(0);
  expect((await db.query("select status,ticket_token from registrations where event_id=$1", [event])).rows).toEqual([{ status: "pending", ticket_token: null }, { status: "pending", ticket_token: null }]);
});
it("rolls back the whole mixed-category reservation when one category is full", async () => {
  await db.query("update categories set slots_total=0 where id=$1", [category2]);
  await expect(reserve(true)).rejects.toThrow("category_capacity_exhausted");
  expect((await db.query("select count(*)::int n from booking_orders where event_id=$1", [event])).rows[0].n).toBe(0);
  expect((await db.query("select count(*)::int n from registrations where event_id=$1", [event])).rows[0].n).toBe(0);
});
it("freezes terms on replay and refuses overlapping payment attempts", async () => {
  const order = await reserve(), key = randomUUID();
  const initial = await svc.rpc("booking_order_prepare_payment", args(order, key)); expect(initial.error).toBeNull();
  await db.query("update organizations set commission_flat_cents=9000 where id=$1", [org]);
  const replay = await svc.rpc("booking_order_prepare_payment", args(order, key)); expect(replay.data).toEqual(initial.data);
  expect((await svc.rpc("booking_order_prepare_payment", args(order, key, "gcash"))).error?.message).toBe("idempotency_conflict");
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("payment_attempt_in_progress");
  await db.query("update booking_payment_attempts set status='creation_unknown' where id=$1", [initial.data.id]);
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("payment_attempt_in_progress");
});
it("serializes simultaneous same-key and competing-key requests", async () => {
  const order = await reserve(), key = randomUUID();
  const same = await Promise.all([svc.rpc("booking_order_prepare_payment", args(order, key)), svc.rpc("booking_order_prepare_payment", args(order, key))]);
  expect(same.map((r) => r.error)).toEqual([null, null]); expect(same[0].data).toEqual(same[1].data);
  await db.query("delete from booking_payment_attempts where booking_order_id=$1", [order]);
  const competing = await Promise.all([svc.rpc("booking_order_prepare_payment", args(order)), svc.rpc("booking_order_prepare_payment", args(order))]);
  expect(competing.filter((r) => r.error === null)).toHaveLength(1);
  expect(competing.find((r) => r.error)?.error?.message).toBe("payment_attempt_in_progress");
});
it("keeps zero-commission pilot and absorb mode totals consistent", async () => {
  await db.query("update organizations set commission_flat_cents=0,fee_mode='absorb' where id=$1", [org]);
  const result = await svc.rpc("booking_order_prepare_payment", args(await reserve(), randomUUID(), "maya"));
  expect(result.error).toBeNull(); expect(result.data).toMatchObject({ method: "paymaya", gross_cents: 225000, platform_fee_cents: 0, processor_surcharge_cents: 0 });
  expect(result.data.net_to_org_predicted_cents).toBe(225000 - result.data.processor_fee_predicted_cents);
});
it("prepares QR Ph with the existing server-side rate card", async () => {
  await db.query("update organizations set fee_mode='absorb' where id=$1", [org]);
  const result = await svc.rpc("booking_order_prepare_payment", args(await reserve(), randomUUID(), "qrph"));
  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({ method: "qrph", gross_cents: 225000, processor_surcharge_cents: 0 });
  expect(result.data.processor_fee_predicted_cents).toBe(3375);
});
it("makes a fully free order fee-free and preserves a free participant in mixed orders", async () => {
  await db.query("update categories set base_price=0 where id=$1", [category]);
  const mixedOrder = await reserve();
  const mixed = await svc.rpc("booking_order_prepare_payment", args(mixedOrder)); expect(mixed.error).toBeNull();
  expect(mixed.data.lines.find((l: { base_cents: number }) => l.base_cents === 0)).toMatchObject({ gross_cents: 0, platform_fee_cents: 0, processor_fee_predicted_cents: 0 });
  await db.query("delete from booking_payment_attempts where booking_order_id=$1", [mixedOrder]);
  await db.query("delete from registrations where booking_order_id=$1", [mixedOrder]);
  await db.query("delete from booking_orders where id=$1", [mixedOrder]);
  await db.query("update addons set price=0 where id=$1", [addon]);
  const free = await svc.rpc("booking_order_prepare_payment", args(await reserve())); expect(free.error).toBeNull();
  expect(free.data).toMatchObject({ gross_cents: 0, platform_fee_cents: 0, processor_surcharge_cents: 0, processor_fee_predicted_cents: 0, net_to_org_predicted_cents: 0 });
});
it("denies other bookers, unauthenticated RPC calls and quote mutations", async () => {
  const order = await reserve();
  expect((await call(order, randomUUID(), "card", strangerToken)).status).toBe(404);
  const result = await svc.rpc("booking_order_prepare_payment", args(order)); expect(result.error).toBeNull();
  const strangerClient = createClient(env.url, env.anonKey, { global: { headers: { Authorization: `Bearer ${strangerToken}` } }, auth: { persistSession: false } });
  expect((await strangerClient.from("booking_payment_attempts").select("id").eq("id", result.data.id)).data).toEqual([]);
  expect((await strangerClient.from("booking_payment_quote_lines").select("registration_id").eq("attempt_id", result.data.id)).data).toEqual([]);
  expect((await strangerClient.rpc("booking_order_prepare_payment", args(order))).error?.code).toBe("42501");
  await expect(db.query("update booking_payment_attempts set method='gcash' where id=$1", [result.data.id])).rejects.toThrow("payment_terms_immutable");
  await expect(db.query("update booking_payment_quote_lines set gross_cents=gross_cents+1 where attempt_id=$1", [result.data.id])).rejects.toThrow("payment_terms_immutable");
});
it("refuses expired, partial, closed, suspended and unverified orders", async () => {
  const order = await reserve();
  await db.query("update organizations set is_active=false where id=$1", [org]);
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("org_suspended");
  await db.query("update organizations set is_active=true where id=$1", [org]);
  await db.query("update events set status='closed' where id=$1", [event]);
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("registration_closed");
  await db.query("update events set status='open' where id=$1", [event]);
  await db.query("update registrations set status='cancelled' where booking_order_id=$1 and participant_passport_id=$2", [order, guest]);
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("order_entries_changed");
  await db.query("update booking_orders set expires_at=now()-interval '1 second' where id=$1", [order]);
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("hold_expired");
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [actor]);
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("booking_email_unverified");
});
it("uses no rate card for pass-on, but still requires one for absorb", async () => {
  const order = await reserve();
  await db.query("begin");
  try {
    await db.query("delete from processor_rates where provider='paymongo' and method='card' and scope='local'");
    expect((await db.query("select booking_order_prepare_payment($1,$2,'card',$3)", [actor, order, randomUUID()])).rows[0].booking_order_prepare_payment.terms_snapshot.provider_managed_fee).toBe(true);
    await db.query("delete from booking_payment_attempts where booking_order_id=$1", [order]);
    await db.query("update organizations set fee_mode='absorb' where id=$1", [org]);
    await db.query("savepoint missing_rate");
    await expect(db.query("select booking_order_prepare_payment($1,$2,'card',$3)", [actor, order, randomUUID()])).rejects.toThrow("rate_card_missing");
    await db.query("rollback to savepoint missing_rate");
  } finally { await db.query("rollback"); }
  await db.query("update registrations set total_amount=1 where booking_order_id=$1 and participant_passport_id=$2", [order, guest]);
  expect((await svc.rpc("booking_order_prepare_payment", args(order))).error?.message).toBe("order_entries_changed");
});
it("matches integer allocation oracle across percentage/fixed and absorb/pass-on terms", async () => {
  const order = await reserve();
  await db.query("begin");
  try {
    for (const feeMode of ["absorb", "pass_on"]) for (const commissionType of ["fixed", "percent"]) for (const bps of [0, 150, 350]) {
      await db.query("delete from booking_payment_attempts where booking_order_id=$1", [order]);
      await db.query("update organizations set fee_mode=$1,commission_type=$2,commission_rate=0.0333,commission_flat_cents=1234 where id=$3", [feeMode, commissionType, org]);
      await db.query("update processor_rates set percent_bps=$1,fixed_cents=1501 where provider='paymongo' and method='card' and scope='local'", [bps]);
      const result = (await db.query("select booking_order_prepare_payment($1,$2,'card',$3) as value", [actor, order, randomUUID()])).rows[0].value;
      const expected = quoteGroup(result.lines.map((l: { registration_id: string; base_cents: number }) => ({ id: l.registration_id, base_cents: l.base_cents })), result.terms_snapshot as GroupFeeTerms, result.terms_snapshot as GroupRate);
      for (const line of expected.lines) expect(result.lines.find((l: { registration_id: string }) => l.registration_id === line.registration_id)).toMatchObject(line);
      for (const key of ["base_cents", "gross_cents", "platform_fee_cents", "processor_surcharge_cents", "processor_fee_predicted_cents", "net_to_org_predicted_cents"] as const) expect(result[key]).toBe(expected[key]);
    }
  } finally { await db.query("rollback"); }
});
it("allows the booker and own organizer to read quotes while denying another organizer", async () => {
  const order = await reserve(); const result = await svc.rpc("booking_order_prepare_payment", args(order)); expect(result.error).toBeNull();
  const booker = createClient(env.url, env.anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const admin = createClient(env.url, env.anonKey, { global: { headers: { Authorization: `Bearer ${strangerToken}` } }, auth: { persistSession: false } });
  expect((await booker.from("booking_payment_attempts").select("id").eq("id", result.data.id)).data).toHaveLength(1);
  const otherOrg = randomUUID();
  try {
    await db.query("insert into organizations(id,name,slug) values($1::uuid,'Other payment QA',$1::text)", [otherOrg]);
    await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin')", [stranger, otherOrg]);
    expect((await admin.from("booking_payment_attempts").select("id").eq("id", result.data.id)).data).toEqual([]);
    expect((await admin.from("booking_payment_quote_lines").select("registration_id").eq("attempt_id", result.data.id)).data).toEqual([]);
    await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin')", [stranger, org]);
    expect((await admin.from("booking_payment_attempts").select("id").eq("id", result.data.id)).data).toHaveLength(1);
    expect((await admin.from("booking_payment_quote_lines").select("registration_id").eq("attempt_id", result.data.id)).data).toHaveLength(2);
  } finally {
    await db.query("delete from user_roles where user_id=$1 and org_id=any($2::uuid[])", [stranger, [org, otherOrg]]);
    await db.query("delete from organizations where id=$1", [otherOrg]);
  }
});
it("keeps the endpoint disabled by default and validates authentication and method", async () => {
  const order = await reserve();
  delete settings.GROUP_PAYMENT_PREPARATION_ENABLED;
  expect((await call(order)).status).toBe(503);
  settings.GROUP_PAYMENT_PREPARATION_ENABLED = "true";
  expect((await call(order, randomUUID(), "card", "invalid")).status).toBe(401);
  expect((await call(order, randomUUID(), "unsupported")).status).toBe(400);
});

async function cancelCall(order: string, bearer = token) {
  return cancelHandler(new Request("http://localhost/group-order-cancel", { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ order_id: order }) }));
}
it("cancels an unpaid group atomically and is idempotent", async () => {
  const order = await reserve(true);
  const response = await cancelCall(order);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toEqual({ order_id: order, status: "cancelled" });
  expect((await db.query("select status,expires_at from booking_orders where id=$1", [order])).rows[0]).toEqual({ status: "cancelled", expires_at: null });
  expect((await db.query("select status,expires_at from registrations where booking_order_id=$1 order by id", [order])).rows)
    .toEqual([{ status: "cancelled", expires_at: null }, { status: "cancelled", expires_at: null }]);
  expect(await (await cancelCall(order)).json()).toEqual({ order_id: order, status: "cancelled" });
});
it("expires a prepared quote during cancellation but blocks after provider dispatch", async () => {
  const preparedAttempt = await prepared();
  expect((await cancelCall(preparedAttempt.booking_order_id)).status).toBe(200);
  expect((await db.query("select status from booking_payment_attempts where id=$1", [preparedAttempt.id])).rows[0].status).toBe("expired");

  const dispatched = await prepared();
  expect((await groupCall(dispatched.id)).status).toBe(200);
  const response = await cancelCall(dispatched.booking_order_id);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "payment_already_started" });
  expect((await db.query("select status from booking_orders where id=$1", [dispatched.booking_order_id])).rows[0].status).toBe("pending");
});
it("serializes cancellation against the first provider dispatch", async () => {
  const attempt = await prepared();
  const [cancelled, dispatched] = await Promise.all([cancelCall(attempt.booking_order_id), groupCall(attempt.id)]);
  expect([cancelled.status, dispatched.status].sort()).toEqual([200, 409]);
  const order = (await db.query("select status from booking_orders where id=$1", [attempt.booking_order_id])).rows[0];
  const dispatch = await db.query("select state from booking_payment_dispatches where attempt_id=$1", [attempt.id]);
  if (order.status === "cancelled") expect(dispatch.rowCount).toBe(0);
  else {
    expect(order.status).toBe("pending");
    expect(dispatch.rows[0]?.state).toBe("ready");
  }
});
it("denies cancellation to another booker and direct authenticated RPC calls", async () => {
  const order = await reserve();
  expect((await cancelCall(order, strangerToken)).status).toBe(404);
  const strangerClient = createClient(env.url, env.anonKey, { global: { headers: { Authorization: `Bearer ${strangerToken}` } }, auth: { persistSession: false } });
  expect((await strangerClient.rpc("booking_order_cancel", { p_actor: stranger, p_order: order })).error?.code).toBe("42501");
});

async function groupCall(attempt: string, action = "session", bearer = token) {
  return groupHandler(new Request("http://localhost/group-payment", { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ attempt_id: attempt, action }) }));
}
async function prepared(mixedCategories = false) {
  const result = await svc.rpc("booking_order_prepare_payment", args(await reserve(mixedCategories)));
  if (result.error) throw result.error;
  return result.data;
}
function providerCapture(attempt: { id: string; booking_order_id: string; gross_cents: number; terms_snapshot?: { provider_managed_fee?: boolean } }, overrides: Record<string, unknown> = {}) {
  const fee = 5678;
  const amount = attempt.gross_cents + (attempt.terms_snapshot?.provider_managed_fee ? fee : 0);
  return { data: { id: "cs_mocksession", attributes: { metadata: { booking_order_id: attempt.booking_order_id, payment_attempt_id: attempt.id }, payments: [
    { id: "pay_mockcapture", attributes: { status: "paid", amount, currency: "PHP", livemode: false, fee, net_amount: amount - fee, ...overrides } },
  ] } } };
}
it("creates one provider session across concurrent clicks and verifies all distinct QR tickets atomically", async () => {
  const attempt = await prepared();
  const clicks = await Promise.all([groupCall(attempt.id.toUpperCase()), groupCall(attempt.id)]);
  expect(clicks.map((r) => r.status)).toEqual([200, 200]); expect(provider.create).toHaveBeenCalledTimes(1);
  const again = await groupCall(attempt.id); expect(await again.json()).toMatchObject({ action: "ready" });
  expect(provider.create).toHaveBeenCalledTimes(1);
  provider.retrieve.mockResolvedValue(providerCapture(attempt));
  const verified = await Promise.all([groupCall(attempt.id, "verify"), groupCall(attempt.id, "verify")]);
  for (const response of verified) { expect(response.status, await response.clone().text()).toBe(200); expect(await response.json()).toEqual({ status: "paid" }); }
  const regs = (await db.query("select id,ticket_token,status from registrations where booking_order_id=$1 order by id", [attempt.booking_order_id])).rows;
  expect(regs).toHaveLength(2); expect(new Set(regs.map((r) => r.ticket_token)).size).toBe(2);
  for (const row of regs) { expect(row.status).toBe("paid"); expect(await verifyTicketToken(row.ticket_token, "group-test-secret")).toMatchObject({ rid: row.id, eid: event }); }
  const ledger = (await db.query("select sum(gross_cents)::int gross,sum(processor_fee_cents)::int fee,sum(net_to_org_cents)::int net from booking_payment_allocations where org_id=$1", [org])).rows[0];
  expect(ledger).toEqual({ gross: attempt.gross_cents + 5678, fee: 5678, net: attempt.base_cents });
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(2);
  expect((await db.query("select * from booking_order_deliveries where org_id=$1", [org])).rowCount).toBe(1);
});
it("fulfills mixed categories with one payment, category-aware tickets, delivery, and slot release", async () => {
  const attempt = await prepared(true);
  expect((await db.query("select category_id from booking_orders where id=$1", [attempt.booking_order_id])).rows[0].category_id).toBeNull();
  expect((await groupCall(attempt.id)).status).toBe(200);
  provider.retrieve.mockResolvedValue(providerCapture(attempt));
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "paid" });

  const regs = (await db.query("select id,category_id,ticket_token,status from registrations where booking_order_id=$1 order by category_id", [attempt.booking_order_id])).rows;
  expect(regs).toHaveLength(2);
  expect(new Set(regs.map(row => row.category_id))).toEqual(new Set([category, category2]));
  expect(new Set(regs.map(row => row.ticket_token)).size).toBe(2);
  for (const row of regs) {
    expect(row.status).toBe("paid");
    expect(await verifyTicketToken(row.ticket_token, "group-test-secret")).toMatchObject({ rid: row.id, eid: event });
  }
  expect((await db.query("select id,slots_taken from categories where id=any($1::uuid[]) order by id", [[category, category2]])).rows)
    .toEqual([category, category2].sort().map(id => ({ id, slots_taken: 1 })));

  await firstDelivery(attempt.booking_order_id);
  expect((await deliver()).status).toBe(200);
  const deliveredHtml = mail.send.mock.calls[0][2];
  expect(deliveredHtml).toContain("Q");
  expect(deliveredHtml).toContain("Ultra");
  expect((deliveredHtml.match(/alt="Ticket QR for /g) ?? [])).toHaveLength(2);

  await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin')", [stranger, org]);
  refundProvider.create.mockImplementation(async request => refundResource(request));
  const selected = regs.find(row => row.category_id === category2)!;
  const allocation = (await db.query("select net_to_org_cents from booking_payment_allocations where registration_id=$1", [selected.id])).rows[0];
  const response = await refundCall(attempt.booking_order_id, { preview: false, registration_ids: [selected.id], expected_amount: allocation.net_to_org_cents });
  expect(await response.json()).toMatchObject({ status: "succeeded" });
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(1);
  expect((await db.query("select slots_taken from categories where id=$1", [category2])).rows[0].slots_taken).toBe(0);
});
it("allocates a one-cent PayMongo rounding excess without losing a centavo", async () => {
  const attempt = await prepared();
  expect((await groupCall(attempt.id)).status).toBe(200);
  provider.retrieve.mockResolvedValue(providerCapture(attempt, {
    amount: attempt.gross_cents + 5679, net_amount: attempt.gross_cents + 1,
  }));
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "paid" });
  const totals = (await db.query("select sum(gross_cents)::int gross,sum(processor_fee_cents)::int fee,sum(net_to_org_cents)::int net from booking_payment_allocations where org_id=$1", [org])).rows[0];
  expect(totals).toEqual({ gross: attempt.gross_cents + 5679, fee: 5678, net: attempt.base_cents + 1 });
  const lines = (await db.query("select registration_id,net_to_org_cents from booking_payment_allocations where org_id=$1 order by registration_id", [org])).rows;
  expect(lines[0].net_to_org_cents).toBe(attempt.lines.find((line: { registration_id: string }) => line.registration_id === lines[0].registration_id).base_cents + 1);
});
it("quarantines provider-managed gross above the rounding allowance", async () => {
  const attempt = await prepared();
  expect((await groupCall(attempt.id)).status).toBe(200);
  provider.retrieve.mockResolvedValue(providerCapture(attempt, {
    amount: attempt.gross_cents + 5680, net_amount: attempt.gross_cents + 2,
  }));
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "reconciliation_required" });
  expect((await db.query("select count(*)::int n from booking_payment_allocations where org_id=$1", [org])).rows[0].n).toBe(0);
});
it("parks uncertain creation without issuing a second provider request", async () => {
  const attempt = await prepared(); provider.create.mockRejectedValue(new Error("network timeout"));
  expect((await groupCall(attempt.id)).status).toBe(503);
  const retry = await groupCall(attempt.id); expect(await retry.json()).toMatchObject({ action: "pending" });
  expect(provider.create).toHaveBeenCalledTimes(1);
  expect((await svc.rpc("booking_order_prepare_payment", args(attempt.booking_order_id))).error?.message).toBe("payment_attempt_in_progress");
});
it("records capture mismatch for reconciliation without issuing tickets", async () => {
  const attempt = await prepared(); expect((await groupCall(attempt.id)).status).toBe(200);
  provider.retrieve.mockResolvedValue(providerCapture(attempt, { currency: "USD" }));
  const response = await groupCall(attempt.id, "verify"); expect(await response.json()).toEqual({ status: "reconciliation_required" });
  expect((await db.query("select id from registrations where booking_order_id=$1 and status='paid'", [attempt.booking_order_id])).rowCount).toBe(0);
  expect((await db.query("select id from booking_payment_captures where org_id=$1 and state='reconciliation_required'", [org])).rowCount).toBe(1);
});
it("reallocates the entire expired group when capacity is available", async () => {
  const attempt = await prepared(); await groupCall(attempt.id);
  await db.query("update registrations set status='expired',expires_at=null where booking_order_id=$1", [attempt.booking_order_id]);
  await db.query("update booking_orders set expires_at=now()-interval '1 second' where id=$1", [attempt.booking_order_id]);
  provider.retrieve.mockResolvedValue(providerCapture(attempt));
  const response = await groupCall(attempt.id, "verify"); expect(await response.json()).toEqual({ status: "paid" });
});
it("keeps late capture but issues no partial tickets when the whole group no longer fits", async () => {
  const attempt = await prepared(); await groupCall(attempt.id);
  await db.query("update registrations set status='expired',expires_at=null where booking_order_id=$1", [attempt.booking_order_id]);
  await db.query("update categories set slots_total=1 where id=$1", [category]);
  provider.retrieve.mockResolvedValue(providerCapture(attempt));
  const response = await groupCall(attempt.id, "verify"); expect(await response.json()).toEqual({ status: "reconciliation_required" });
  expect((await db.query("select id from registrations where booking_order_id=$1 and ticket_token is not null", [attempt.booking_order_id])).rowCount).toBe(0);
  expect((await db.query("select reason from booking_payment_captures where org_id=$1", [org])).rows[0].reason).toBe("capacity_unavailable");
});
it("records extra captures without duplicating allocations or tickets", async () => {
  const attempt = await prepared(); await groupCall(attempt.id);
  const raw = providerCapture(attempt); provider.retrieve.mockResolvedValue(raw);
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "paid" });
  raw.data.attributes.payments.push({ ...raw.data.attributes.payments[0], id: "pay_extracapture" });
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "reconciliation_required" });
  expect((await db.query("select * from booking_payment_allocations where org_id=$1", [org])).rowCount).toBe(2);
  expect((await db.query("select reason from booking_payment_captures where org_id=$1 and state='reconciliation_required'", [org])).rows[0].reason).toBe("extra_capture");
});
it("quarantines unknown actual fees without issuing tickets or payout allocations", async () => {
  const attempt = await prepared(); await groupCall(attempt.id);
  provider.retrieve.mockResolvedValue(providerCapture(attempt, { fee: undefined, net_amount: undefined }));
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "reconciliation_required" });
  const allocations = (await db.query("select processor_fee_cents,net_to_org_cents from booking_payment_allocations where org_id=$1", [org])).rows;
  expect(allocations).toEqual([]);
});
it("denies another booker and remains disabled by default", async () => {
  const attempt = await prepared(); expect((await groupCall(attempt.id, "session", strangerToken)).status).toBe(404);
  delete settings.GROUP_PAYMENTS_ENABLED; expect((await groupCall(attempt.id)).status).toBe(503);
  expect(provider.create).not.toHaveBeenCalled();
});

async function paidGroup(overrides: Record<string, unknown> = {}) {
  const attempt = await prepared();
  expect((await groupCall(attempt.id)).status).toBe(200);
  provider.retrieve.mockResolvedValue(providerCapture(attempt, overrides));
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "paid" });
  await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin')", [stranger, org]);
  const lines = (await db.query("select * from booking_payment_allocations where org_id=$1 order by registration_id", [org])).rows;
  return { order: attempt.booking_order_id, lines };
}
async function refundCall(order: string, body: Record<string, unknown> = {}, bearer = strangerToken) {
  return refundHandler(new Request("http://localhost/admin-group-refund", { method: "POST", headers: { Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ order_id: order, idempotency_key: randomUUID(), preview: true, ...body }) }));
}
function refundResource(request: { requestId: string; amount: number; paymentId: string }, status = "succeeded", overrides: Record<string, unknown> = {}) {
  const id = `ref_${request.requestId.replaceAll("-", "")}`;
  return { id, status, raw: { data: { id, type: "refund", attributes: { amount: request.amount, payment_id: request.paymentId,
    currency: "PHP", livemode: false, metadata: { refund_request_id: request.requestId }, status, ...overrides } } } };
}
it("refunds one ticket then the remaining order with one provider refund per request and exact slot release", async () => {
  const { order, lines } = await paidGroup();
  refundProvider.create.mockImplementation(async (r) => refundResource(r));
  const key = randomUUID(), selected = [lines[0].registration_id], amount = lines[0].net_to_org_cents;
  const preview = await (await refundCall(order, { registration_ids: selected })).json();
  expect(preview).toMatchObject({ status: "preview", refund_amount: amount, total_paid: lines[0].gross_cents });
  expect(refundProvider.create).not.toHaveBeenCalled();
  const body = { registration_ids: selected, idempotency_key: key, preview: false, expected_amount: amount };
  expect(await (await refundCall(order, body)).json()).toMatchObject({ status: "succeeded" });
  expect(await (await refundCall(order, body)).json()).toMatchObject({ status: "succeeded" });
  expect(refundProvider.create).toHaveBeenCalledTimes(1);
  const regs = (await db.query("select id,status,ticket_token from registrations where booking_order_id=$1 order by id", [order])).rows;
  expect(regs[0]).toMatchObject({ status: "refunded", ticket_token: null });
  expect(regs[1].status).toBe("paid"); expect(regs[1].ticket_token).toBeTruthy();
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(1);
  expect((await refundCall(order, { ...body, registration_ids: [lines[1].registration_id] })).status).toBe(409);
  const allKey = randomUUID(), allBody = { preview: false, idempotency_key: allKey, expected_amount: lines[1].net_to_org_cents };
  expect(await (await refundCall(order, allBody)).json()).toMatchObject({ status: "succeeded" });
  expect(await (await refundCall(order, allBody)).json()).toMatchObject({ status: "succeeded" });
  expect(refundProvider.create).toHaveBeenCalledTimes(2);
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(0);
  expect((await db.query("select * from booking_payment_allocations where org_id=$1 order by registration_id", [org])).rows).toEqual(lines);
});
it("blocks bookers, foreign organizers, direct client RPC and disabled submissions", async () => {
  const { order } = await paidGroup();
  expect((await refundCall(order, {}, token)).status).toBe(403);
  await db.query("delete from user_roles where user_id=$1 and org_id=$2", [stranger, org]);
  expect((await refundCall(order)).status).toBe(403);
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  expect((await client.rpc("booking_refund_apply", { p_request: randomUUID(), p_resource: {} })).error?.code).toBe("42501");
  expect((await client.from("booking_refund_requests").select("*")).error?.code).toBe("42501");
  delete settings.GROUP_REFUNDS_ENABLED; expect((await refundCall(order)).status).toBe(503);
  expect(refundProvider.create).not.toHaveBeenCalled();
});
it("serializes competing requests and preserves unknown outcomes without a second POST", async () => {
  const { order, lines } = await paidGroup();
  refundProvider.create.mockRejectedValue(new Error("timeout"));
  const body = { preview: false, idempotency_key: randomUUID(), registration_ids: [lines[0].registration_id], expected_amount: lines[0].net_to_org_cents };
  const results = await Promise.all([refundCall(order, body), refundCall(order, body)]);
  expect(results.map(r => r.status).sort()).toEqual([200,503]);
  expect(await (await refundCall(order, body)).json()).toMatchObject({ status: "pending" });
  expect(await (await refundCall(order, { ...body, idempotency_key: randomUUID(), registration_ids: [lines[1].registration_id], expected_amount: lines[1].net_to_org_cents })).json()).toEqual({ error: "refund_in_progress" });
  expect(refundProvider.create).toHaveBeenCalledTimes(1);
  expect((await db.query("select status from booking_refund_requests where booking_order_id=$1", [order])).rows[0].status).toBe("unknown");
});
it("freezes pending refunds and reconciles with GET without charging another refund", async () => {
  const { order, lines } = await paidGroup(); let saved: Parameters<typeof refundResource>[0];
  refundProvider.create.mockImplementation(async r => { saved=r; return refundResource(r,"pending"); });
  const body = { preview: false, idempotency_key: randomUUID(), expected_amount: lines.reduce((n,l) => n+l.net_to_org_cents,0) };
  expect(await (await refundCall(order, body)).json()).toMatchObject({ status: "pending" });
  await db.query("update organizations set refund_policy='none',is_active=false where id=$1", [org]);
  refundProvider.get.mockImplementation(async () => refundResource(saved));
  expect(await (await refundCall(order, body)).json()).toMatchObject({ status: "succeeded" });
  expect(refundProvider.create).toHaveBeenCalledTimes(1); expect(refundProvider.get).toHaveBeenCalledTimes(1);
});
it("keeps tickets valid on failed refund and allows a new explicit request", async () => {
  const { order, lines } = await paidGroup();
  const body = { preview: false, expected_amount: lines.reduce((n,l) => n+l.net_to_org_cents,0) };
  refundProvider.create.mockImplementation(async r => refundResource(r,"failed"));
  expect(await (await refundCall(order, body)).json()).toMatchObject({ status: "failed" });
  expect((await db.query("select id from registrations where booking_order_id=$1 and status='paid'", [order])).rowCount).toBe(2);
  refundProvider.create.mockImplementation(async r => refundResource(r));
  expect(await (await refundCall(order, body)).json()).toMatchObject({ status: "succeeded" });
});
it.each([ { amount: 1 }, { payment_id: "pay_wrong" }, { currency: "USD" }, { livemode: true }, { metadata: {} } ])(
  "parks mismatched provider refund evidence %j without revoking tickets", async overrides => {
  const { order, lines } = await paidGroup();
  refundProvider.create.mockImplementation(async r => refundResource(r,"succeeded",overrides));
  expect(await (await refundCall(order, { preview: false, expected_amount: lines.reduce((n,l) => n+l.net_to_org_cents,0) })).json()).toMatchObject({ status: "review_required" });
  expect((await db.query("select id from registrations where booking_order_id=$1 and status='paid'", [order])).rowCount).toBe(2);
  expect((await refundCall(order)).status).toBe(409);
});
it("requires actual fees and matching preview, retains flat fees per ticket, and handles zero locally", async () => {
  const { order, lines } = await paidGroup();
  const net = lines.reduce((n,l) => n+l.net_to_org_cents,0);
  await db.query("update organizations set refund_policy='flat_fee',refund_fee_cents=500 where id=$1", [org]);
  expect(await (await refundCall(order)).json()).toMatchObject({ refund_amount: net-1000 });
  expect(await (await refundCall(order, { preview: false, expected_amount: net })).json()).toEqual({ error: "refund_amount_changed" });
  await db.query("update organizations set refund_fee_cents=1000000 where id=$1", [org]);
  expect(await (await refundCall(order, { preview: false, expected_amount: 0 })).json()).toMatchObject({ status: "succeeded", refund_amount: 0 });
  expect(refundProvider.create).not.toHaveBeenCalled();
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(0);
});
it("quarantines a group capture without actual fees before refund or payout", async () => {
  const attempt = await prepared();
  expect((await groupCall(attempt.id)).status).toBe(200);
  provider.retrieve.mockResolvedValue(providerCapture(attempt, { fee: undefined, net_amount: undefined }));
  expect(await (await groupCall(attempt.id, "verify")).json()).toEqual({ status: "reconciliation_required" });
  expect((await db.query("select count(*)::int n from booking_payment_allocations where org_id=$1", [org])).rows[0].n).toBe(0);
  expect((await db.query("select count(*)::int n from registrations where booking_order_id=$1 and status='paid'", [attempt.booking_order_id])).rows[0].n).toBe(0);
});
it("applies an early signed callback and ignores later pending downgrade", async () => {
  const { applyGroupRefundWebhook } = await import("../functions/_shared/groupRefund");
  const { order, lines } = await paidGroup();
  refundProvider.create.mockImplementation(async r => {
    expect(await applyGroupRefundWebhook(refundResource(r).raw.data)).toBe(true);
    return refundResource(r,"pending");
  });
  expect(await (await refundCall(order, { preview: false, expected_amount: lines.reduce((n,l) => n+l.net_to_org_cents,0) })).json()).toMatchObject({ status: "succeeded" });
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(0);
});
it("rejects small positive refunds and preserves frozen amounts after credential rotation", async () => {
  const { order, lines } = await paidGroup();
  await db.query("update organizations set refund_policy='flat_fee',refund_fee_cents=$1 where id=$2", [lines[0].net_to_org_cents-50,org]);
  expect(await (await refundCall(order,{registration_ids:[lines[0].registration_id]})).json()).toEqual({error:"refund_below_provider_minimum"});
  await db.query("update organizations set refund_policy='full' where id=$1",[org]);
  refundProvider.create.mockImplementation(async r => refundResource(r,"pending"));
  const body={preview:false,idempotency_key:randomUUID(),expected_amount:lines.reduce((n,l)=>n+l.net_to_org_cents,0)};
  const response=await (await refundCall(order,body)).json(); expect(response.status).toBe("pending");
  await expect(db.query("update booking_refund_requests set refund_amount=1 where id=$1",[response.request_id])).rejects.toThrow("refund_terms_immutable");
  await expect(db.query("update booking_refund_lines set refund_amount=1 where request_id=$1",[response.request_id])).rejects.toThrow("refund_terms_immutable");
  settings.PAYMONGO_SECRET_KEY="sk_test_rotated";
  expect(await (await refundCall(order,body)).json()).toEqual({error:"provider_scope_changed"});
  expect(refundProvider.create).toHaveBeenCalledTimes(1); expect(refundProvider.get).not.toHaveBeenCalled();
});

function sessionClient(bearer = strangerToken) {
  return createClient(env.url, env.anonKey, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false } });
}
async function payoutAdmin() {
  await db.query("insert into user_roles(user_id,org_id,role) values($1,null,'super_admin')", [actor]);
  return sessionClient(token);
}
async function statement(client: ReturnType<typeof sessionClient>) {
  const result = await client.rpc("payout_open_statement", { p_event_id: event });
  expect(result.error).toBeNull();
  const row = (await db.query("select * from payout_statements where id=$1", [result.data])).rows[0];
  return row;
}
async function mark(client: ReturnType<typeof sessionClient>, row: {id:string;revision:number}) {
  await db.query("update events set status='completed' where id=$1", [event]);
  const result=await client.rpc("payout_mark_paid",{p_statement_id:row.id,p_reference:"QA bank transfer",p_note:null,p_expected_revision:row.revision});
  expect(result.error).toBeNull(); return result.data;
}
it("reports one shared capture and separate participant amounts with organization isolation", async () => {
  const {order,lines}=await paidGroup(); const admin=sessionClient();
  const payments=await admin.from("admin_payments_v").select("*").eq("org_id",org);
  expect(payments.error).toBeNull(); expect(payments.data).toHaveLength(1);
  expect(payments.data![0]).toMatchObject({registration_id:null,booking_order_id:order,participant_count:2,amount:lines.reduce((n,l)=>n+l.gross_cents,0)});
  const regs=await admin.from("admin_registrations_v").select("id,booking_order_id,payment_amount,payment_status").eq("event_id",event).order("id");
  expect(regs.error).toBeNull(); expect(regs.data).toEqual(lines.map(l=>({id:l.registration_id,booking_order_id:order,payment_amount:l.gross_cents,payment_status:"paid"})));
  const alloc=await admin.from("admin_group_allocations_v").select("*").eq("org_id",org);
  expect(alloc.error).toBeNull(); expect(alloc.data).toHaveLength(2);
  expect((await sessionClient(token).from("admin_group_allocations_v").select("*").eq("org_id",org)).data).toEqual([]);
  const otherOrg=randomUUID();
  try {
    await db.query("insert into organizations(id,name,slug) values($1::uuid,'Foreign report QA',$1::text)",[otherOrg]);
    await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin')",[actor,otherOrg]);
    expect((await sessionClient(token).rpc("admin_group_financial_lines")).data).toEqual([]);
  } finally { await db.query("delete from user_roles where user_id=$1 and org_id=$2",[actor,otherOrg]); await db.query("delete from organizations where id=$1",[otherOrg]); }
  const orgTotals=await admin.from("admin_org_totals_v").select("*").eq("org_id",org).single();
  expect(orgTotals.error).toBeNull(); expect(orgTotals.data).toMatchObject({reg_count:2,paid_count:2,net_to_org:lines.reduce((n,l)=>n+l.net_to_org_cents,0)});
});
it("nets pre-settlement group refunds exactly once and rejects stale statements", async () => {
  const {order,lines}=await paidGroup(); const client=await payoutAdmin();
  const first=await statement(client);
  const net=lines.reduce((n,l)=>n+l.net_to_org_cents,0);
  expect(Number(first.net_owed_cents)).toBe(net);
  refundProvider.create.mockImplementation(async r=>refundResource(r));
  expect(await (await refundCall(order,{preview:false,registration_ids:[lines[0].registration_id],expected_amount:lines[0].net_to_org_cents})).json()).toMatchObject({status:"succeeded"});
  expect(await mark(client,first)).toBe("stale");
  expect((await client.rpc("payout_refresh_statement",{p_statement_id:first.id})).data).toBe("refreshed");
  const refreshed=(await db.query("select * from payout_statements where id=$1",[first.id])).rows[0];
  expect(Number(refreshed.net_owed_cents)).toBe(lines[1].net_to_org_cents);
  expect(Number(refreshed.refunds_in_period_cents)).toBe(lines[0].net_to_org_cents);
  expect(Number(refreshed.refunds_cents)).toBe(0);
  expect(Number(refreshed.gross_cents)-Number(refreshed.commission_cents)-Number(refreshed.processing_cents)-Number(refreshed.refunds_in_period_cents)).toBe(Number(refreshed.net_owed_cents));
  expect(await mark(client,first)).toBe("stale");
  expect(await mark(client,refreshed)).toBe("paid"); expect(await mark(client,refreshed)).toBe("already");
  const next=await statement(client); expect(Number(next.net_owed_cents)).toBe(0); expect(Number(next.refunds_cents)).toBe(0);
});
it("claws back only a group refund made after settlement and never twice",async()=>{
  const {order,lines}=await paidGroup(); const client=await payoutAdmin();
  const first=await statement(client); expect(await mark(client,first)).toBe("paid");
  refundProvider.create.mockImplementation(async r=>refundResource(r));
  const amount=lines[0].net_to_org_cents;
  expect(await (await refundCall(order,{preview:false,registration_ids:[lines[0].registration_id],expected_amount:amount})).json()).toMatchObject({status:"succeeded"});
  const clawback=await statement(client); expect(Number(clawback.net_owed_cents)).toBe(-amount); expect(Number(clawback.refunds_cents)).toBe(amount);
  expect(Number(clawback.refunds_in_period_cents)).toBe(0); expect(Number(clawback.gross_cents)).toBe(0);
  expect(await mark(client,clawback)).toBe("paid");
  const next=await statement(client); expect(Number(next.net_owed_cents)).toBe(0); expect(Number(next.refunds_cents)).toBe(0);
});
it("blocks group payouts while an unknown-fee capture awaits reconciliation",async()=>{
  const attempt=await prepared(); await groupCall(attempt.id);
  provider.retrieve.mockResolvedValue(providerCapture(attempt,{fee:undefined,net_amount:undefined}));
  expect(await (await groupCall(attempt.id,"verify")).json()).toEqual({status:"reconciliation_required"});
  const client=await payoutAdmin();
  expect((await client.rpc("payout_unreconciled_count",{p_event_id:event})).data).toBe(1);
  expect((await client.rpc("payout_open_statement",{p_event_id:event})).error?.message).toBe("group_reconciliation_required");
});
it("blocks settlement while a group refund outcome is pending",async()=>{
  const {order,lines}=await paidGroup(); const client=await payoutAdmin(); const first=await statement(client);
  refundProvider.create.mockImplementation(async r=>refundResource(r,"pending"));
  expect(await (await refundCall(order,{preview:false,expected_amount:lines.reduce((n,l)=>n+l.net_to_org_cents,0)})).json()).toMatchObject({status:"pending"});
  expect(await mark(client,first)).toBe("unreconciled");
  expect((await client.rpc("payout_refresh_statement",{p_statement_id:first.id})).data).toBe("unreconciled");
});
it("combines legacy and group revenue without duplicating a shared payment",async()=>{
  const {lines}=await paidGroup();
  // A distinct participant's legacy payment coexists with the two group entries.
  const reg=randomUUID(),pay=randomUUID();
  try {
    await db.query("insert into registrations(id,org_id,event_id,category_id,user_id,total_amount,status,waiver_version_id) values($1,$2,$3,$4,$5,10000,'paid',$6)",[reg,org,event,category,stranger,waiver]);
    await db.query("insert into payments(id,registration_id,org_id,amount,platform_fee,processor_fee_cents,processor_fee_source,net_to_org,status) values($1,$2,$3,10000,100,200,'actual',9700,'paid')",[pay,reg,org]);
    const client=await payoutAdmin();
    expect((await client.from("admin_payments_v").select("payment_id").eq("org_id",org)).data).toHaveLength(2);
    const agg=await client.rpc("admin_registration_aggregates",{p_event_id:event});expect(agg.error).toBeNull();
    expect(agg.data[0]).toMatchObject({total:3,paid:3,gross_cents:10000+lines.reduce((n,l)=>n+l.gross_cents,0)});
    const opened=await statement(client);expect(Number(opened.net_owed_cents)).toBe(9700+lines.reduce((n,l)=>n+l.net_to_org_cents,0));
  }finally{
    await db.query("delete from payments where id=$1",[pay]); await db.query("delete from registrations where id=$1",[reg]);
  }
});

async function deliver(secret="qa-delivery-secret") {
 return deliveryHandler(new Request("http://localhost/group-ticket-delivery",{method:"POST",headers:{Authorization:`Bearer ${secret}`}}));
}
async function firstDelivery(order:string){
 await db.query("update booking_order_deliveries set created_at='1900-01-01' where booking_order_id=$1",[order]);
}
it("emails all named group tickets once after capture without changing paid entries",async()=>{
 const {order}=await paidGroup();await firstDelivery(order);
 const responses=await Promise.all([deliver(),deliver()]);
 expect(responses.every(r=>r.status===200)).toBe(true);expect(mail.send).toHaveBeenCalledTimes(1);
 const [to,subject,html]=mail.send.mock.calls[0];expect(to).toContain("@example.com");expect(subject).toContain("2 race tickets");
 expect((html.match(/alt="" role="presentation"/g)??[])).toHaveLength(1);
 expect((html.match(/alt="Ticket QR for /g)??[])).toHaveLength(2);
 expect((html.match(/Original booking total/g)??[])).toHaveLength(1);
 const regs=(await db.query("select id,status,ticket_token from registrations where booking_order_id=$1",[order])).rows;
 for(const r of regs){expect(html).toContain(`/ticket/${r.id}`);expect(r.status).toBe("paid");expect(r.ticket_token).toBeTruthy();}
 expect((await db.query("select state,attempts from booking_order_deliveries where booking_order_id=$1",[order])).rows[0]).toEqual({state:"sent",attempts:1});
});
it("retains failed email for retry and excludes refunded tickets",async()=>{
 const {order,lines}=await paidGroup();await firstDelivery(order);
 mail.send.mockResolvedValueOnce({ok:false,error:"timeout"});expect((await deliver()).status).toBe(503);
 expect((await db.query("select status from booking_orders where id=$1",[order])).rows[0].status).toBe("paid");
 const row=(await db.query("select * from booking_order_deliveries where booking_order_id=$1",[order])).rows[0];expect(row.state).toBe("pending");expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
 refundProvider.create.mockImplementation(async r=>refundResource(r));
 await refundCall(order,{preview:false,registration_ids:[lines[0].registration_id],expected_amount:lines[0].net_to_org_cents});
 await db.query("update booking_order_deliveries set next_attempt_at=now() where booking_order_id=$1",[order]);
 expect((await deliver()).status).toBe(200);const [to,subject,html]=mail.send.mock.calls[1];
 expect(to).toContain("@example.com");expect(subject).toContain("race pass");expect(html).toContain("Your race ticket");expect(html).not.toContain("One booking, everyone included.");
 expect(html).not.toContain(`/ticket/${lines[0].registration_id}`);expect(html).toContain(`/ticket/${lines[1].registration_id}`);
});
it("does not email an entirely refunded order and refuses unauthorized or disabled workers",async()=>{
 const {order,lines}=await paidGroup();await firstDelivery(order);
 expect((await deliver("wrong")).status).toBe(401);
 delete settings.GROUP_TICKET_DELIVERY_ENABLED;expect((await deliver()).status).toBe(503);settings.GROUP_TICKET_DELIVERY_ENABLED="true";
 refundProvider.create.mockImplementation(async r=>refundResource(r));
 await refundCall(order,{preview:false,expected_amount:lines.reduce((n,l)=>n+l.net_to_org_cents,0)});
 expect(await (await deliver()).json()).toEqual({sent:0,skipped:1,failed:0});expect(mail.send).not.toHaveBeenCalled();
});
it("recovers expired delivery leases and refuses stale completion and client claims",async()=>{
 const {order}=await paidGroup();await firstDelivery(order);
 const first=await svc.rpc("booking_delivery_claim",{p_limit:1});expect(first.error).toBeNull();expect(first.data[0].booking_order_id).toBe(order);
 await db.query("update booking_order_deliveries set lease_until=now()-interval '1 second' where booking_order_id=$1",[order]);
 const second=await svc.rpc("booking_delivery_claim",{p_limit:1});expect(second.error).toBeNull();expect(second.data[0].lease_token).not.toBe(first.data[0].lease_token);
 expect((await svc.rpc("booking_delivery_finish",{p_order:order,p_lease:first.data[0].lease_token,p_error:null})).data).toBe(false);
 expect((await sessionClient().rpc("booking_delivery_claim",{p_limit:1})).error?.code).toBe("42501");
 expect((await svc.rpc("booking_delivery_finish",{p_order:order,p_lease:second.data[0].lease_token,p_error:null})).data).toBe(true);
});
