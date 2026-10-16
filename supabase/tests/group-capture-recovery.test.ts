import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";
import { prepareGroupLine } from "../functions/_shared/groupReservationValidation";
import { groupReservationInputSchema } from "../functions/_shared/groupRegistration";

const env = loadEnv();
const db = new Client({ connectionString: env.dbUrl });
const svc = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });
const org = randomUUID(), otherOrg = randomUUID(), event = randomUUID(), category = randomUUID(), category2 = randomUUID(), guest = randomUUID(), waiver = randomUUID();
let actor: string, administrator: string, outsider: string, self: string;
let runner: ReturnType<typeof createClient>, admin: ReturnType<typeof createClient>, stranger: ReturnType<typeof createClient>;
async function account() {
  const email = `capture-recovery-${randomUUID()}@example.com`;
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password: "password123" });
  if (login.error) throw login.error;
  return { id: created.data.user.id, client };
}
async function clearOrders() {
  for (const table of ["booking_payment_retry_audit", "payment_reconciliation_checks", "booking_order_deliveries", "booking_payment_allocations", "booking_payment_captures", "booking_payment_dispatches", "booking_payment_attempts", "registrations", "prescreening_applications", "prescreening_batches", "prescreening_uploads", "event_reservations", "booking_orders"]) {
    await db.query(`delete from ${table} where org_id=$1`, [org]);
  }
}
beforeAll(async () => {
  await db.connect();
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  const a = await account(), b = await account(), c = await account();
  actor = a.id; runner = a.client; administrator = b.id; admin = b.client; outsider = c.id; stranger = c.client;
  self = (await db.query("select id from runner_passports where claimed_user_id=$1", [actor])).rows[0].id;
  await db.query("insert into organizations(id,name,slug,fee_mode,commission_type,commission_flat_cents) values($1::uuid,'Capture recovery QA',$1::text,'pass_on','fixed',1000),($2::uuid,'Other tenant',$2::text,'absorb','fixed',0)", [org, otherOrg]);
  await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin'),($3,$4,'admin')", [administrator, org, outsider, otherOrg]);
  await db.query("insert into organizer_waiver_versions(id,org_id,title,body) values($1,$2,'QA waiver','Sample waiver')", [waiver, org]);
  await db.query("insert into events(id,org_id,name,status,waiver_version_id) values($1,$2,'Capture recovery QA','open',$3)", [event, org, waiver]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total,prescreening_enabled,prescreening_requirement) values($1,$2,$3,'70K','70K',470000,20,true,'Prior ultra finish')", [category, org, event]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'50K','50K',100000,20)", [category2, org, event]);
  await db.query("insert into runner_passports(id,created_by_user_id) values($1,$2)", [guest, actor]);
  await db.query("insert into passport_managers(passport_id,user_id) values($1,$2)", [guest, actor]);
  const updated = await svc.from("runner_passports").update({ first_name: "QA", last_name: "Runner", date_of_birth: "1950-01-01", gender: "Female", contact_number: "09171234567", emergency_contact_name: "Helper", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "Unit 1, Sample Street" }).in("id", [self, guest]);
  if (updated.error) throw updated.error;
});
beforeEach(async () => {
  await clearOrders();
  await db.query("update categories set slots_taken=0,slots_total=20,prescreening_enabled=(id=$1),reservation_enabled=false,reservation_slots=0 where event_id=$2", [category, event]);
  await db.query("update events set total_event_slots=null where id=$1", [event]);
});
afterAll(async () => {
  await clearOrders();
  await db.query("delete from events where id=$1", [event]);
  await db.query("delete from organizer_waiver_versions where id=$1", [waiver]);
  await db.query("delete from user_roles where org_id=any($1::uuid[])", [[org, otherOrg]]);
  await db.query("delete from organizations where id=any($1::uuid[])", [[org, otherOrg]]);
  await db.query("delete from runner_passports where id=$1", [guest]);
  for (const id of [actor, administrator, outsider].filter(Boolean)) await svc.auth.admin.deleteUser(id);
  await db.end();
});

async function prepared(count = 1, withScreening = true, passports = [self, guest].slice(0, count), mixed = false) {
  let batch: string | null = null;
  if (withScreening) {
    const participants = [];
    for (const passport of passports) {
      const proof = randomUUID();
      await db.query("insert into prescreening_uploads(id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,object_path,content_type,size_bytes,verified_at) values($1,$2,$3,$4,$5,$6,$7,'image/png',100,now())", [proof, org, event, category, passport, actor, `${org}/${actor}/${proof}`]);
      participants.push({ participant_passport_id: passport, category_id: category, proof_upload_id: proof });
    }
    const submitted = await svc.rpc("prescreening_submit", { p_actor: actor, p_request: { event_id: event, idempotency_key: randomUUID(), checkout_intent: "entry", participants } });
    if (submitted.error) throw submitted.error;
    batch = submitted.data as string;
    const applications = (await db.query("select id from prescreening_applications where batch_id=$1", [batch])).rows;
    for (const app of applications) {
      const approved = await admin.rpc("prescreening_review", { p_application: app.id, p_decision: "approved" });
      if (approved.error) throw approved.error;
    }
  } else {
    await db.query("update categories set prescreening_enabled=false where id=$1", [category]);
  }
  const input = groupReservationInputSchema.parse({ event_id: event, ...(mixed ? {} : { category_id: category }), waiver_version_id: waiver, idempotency_key: randomUUID(), ...(batch ? { prescreening_batch_id: batch } : {}), participants: passports.map((id) => ({ participant_passport_id: id, ...(mixed ? { category_id: id === self ? category : category2 } : {}), addon_ids: [], waiver_accepted: true, waiver_acceptance_method: id === self ? "signed_in_self" : "participant_on_helper_device" })) });
  const rows = await svc.from("runner_passports").select("*").in("id", passports);
  if (rows.error) throw rows.error;
  const lines = input.participants.map((line) => prepareGroupLine(line, rows.data.find((p) => p.id === line.participant_passport_id)!, [], actor, "2026-10-16"));
  const reserved = await svc.rpc("booking_order_reserve", { p_actor: actor, p_request: input, p_lines: lines, p_fields: [] });
  if (reserved.error) throw reserved.error;
  const order = reserved.data.order_id as string;
  const result = await svc.rpc("booking_order_prepare_payment", { p_actor: actor, p_order: order, p_method: "qrph", p_key: randomUUID() });
  if (result.error) throw result.error;
  const attempt = result.data as { id: string; gross_cents: number };
  const session = `cs_${randomUUID()}`;
  await db.query("insert into booking_payment_dispatches(attempt_id,org_id,request_body,livemode,state,session_id,checkout_url) values($1,$2,'{}',false,'ready',$3,$4)", [attempt.id, org, session, `https://checkout.paymongo.com/${session}`]);
  await db.query("update booking_payment_attempts set status='ready' where id=$1", [attempt.id]);
  const capture = { paymentId: `pay_${randomUUID()}`, sessionId: session, amount: attempt.gross_cents + 7372, currency: "PHP", feeCents: 7372, livemode: false, attemptId: attempt.id, orderId: order, paidAt: new Date().toISOString(), invalidReason: null, raw: { source: "test-only" } };
  const registrations = (await db.query("select id from registrations where booking_order_id=$1 order by id", [order])).rows as { id: string }[];
  const tokens = Object.fromEntries(registrations.map((r) => [r.id, `test.ticket.token.${r.id}`]));
  return { ...attempt, order, batch, capture, tokens, registrations };
}
type Prepared = Awaited<ReturnType<typeof prepared>>;
const observe = (p: Prepared) => svc.rpc("booking_payment_capture_observe", { p_attempt: p.id, p_capture: p.capture });
const confirm = (p: Prepared, tokens = p.tokens, capture = p.capture) => svc.rpc("booking_payment_confirm", { p_attempt: p.id, p_capture: capture, p_tokens: tokens });

it.each([1, 2])("fulfills %i approved pre-screened entries without SQLSTATE 42703", async (count) => {
  const p = await prepared(count);
  expect((await observe(p)).data).toBe("received");
  const result = await confirm(p);
  expect(result.error).toBeNull(); expect(result.data).toBe("fulfilled");
  const rows = (await db.query("select status,ticket_token from registrations where booking_order_id=$1", [p.order])).rows;
  expect(rows).toHaveLength(count); expect(rows.every((r) => r.status === "paid" && r.ticket_token)).toBe(true);
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(count);
  const totals = (await db.query("select count(*)::int n,sum(gross_cents)::int gross,sum(processor_fee_cents)::int fee,sum(net_to_org_cents)::int net,sum(platform_fee_cents)::int platform from booking_payment_allocations where capture_id=(select id from booking_payment_captures where attempt_id=$1)", [p.id])).rows[0];
  expect(totals).toMatchObject({ n: count, gross: p.capture.amount, fee: p.capture.feeCents });
  expect(totals.net).toBe(totals.gross - totals.fee - totals.platform);
  expect((await db.query("select status from prescreening_batches where id=$1", [p.batch])).rows[0].status).toBe("completed");
});

it("keeps capture evidence through a failed transaction and retries immutable evidence", async () => {
  const p = await prepared();
  expect((await observe(p)).error).toBeNull();
  const failed = await confirm(p, {});
  expect(failed.error?.message).toBe("ticket_tokens_required");
  expect((await svc.rpc("booking_payment_capture_failure", { p_attempt: p.id, p_payment_id: p.capture.paymentId, p_error_code: "42703" })).error).toBeNull();
  const persisted = (await db.query("select state,capture,attempts,last_error_code,last_attempt_at from booking_payment_captures where attempt_id=$1", [p.id])).rows[0];
  expect(persisted).toMatchObject({ state: "received", capture: p.capture, attempts: 1, last_error_code: "42703" });
  expect(persisted.last_attempt_at).toBeTruthy();
  const forgedReplay = { ...p.capture, amount: 1, feeCents: 0, paidAt: "2099-01-01T00:00:00Z" };
  expect((await svc.rpc("booking_payment_capture_observe", { p_attempt: p.id, p_capture: forgedReplay })).data).toBe("received");
  expect((await confirm(p, p.tokens, forgedReplay)).data).toBe("fulfilled");
  expect((await db.query("select capture from booking_payment_captures where attempt_id=$1", [p.id])).rows[0].capture).toEqual(p.capture);
});

it("serializes concurrent observation and confirmation without extra allocations or deliveries", async () => {
  const p = await prepared(2);
  const observations = await Promise.all([observe(p), observe(p)]);
  expect(observations.map((r) => r.error)).toEqual([null, null]);
  const confirmations = await Promise.all([confirm(p), confirm(p), confirm(p)]);
  expect(confirmations.map((r) => r.data)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
  expect((await db.query("select count(*)::int n from booking_payment_captures where attempt_id=$1", [p.id])).rows[0].n).toBe(1);
  expect((await db.query("select count(*)::int n from booking_order_deliveries where booking_order_id=$1", [p.order])).rows[0].n).toBe(1);
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(2);
  const second = { ...p, capture: { ...p.capture, paymentId: `pay_${randomUUID()}` } };
  expect((await observe(second)).data).toBe("received");
  expect((await confirm(second)).data).toBe("reconciliation_required");
  expect((await db.query("select reason from booking_payment_captures where payment_id=$1", [second.capture.paymentId])).rows[0].reason).toBe("extra_capture");
});

it.each(["late", "released"])("keeps %s pre-screening evidence under review", async (reason) => {
  const p = await prepared();
  if (reason === "late") p.capture.paidAt = new Date(Date.now() + 96 * 3600000).toISOString();
  else await db.query("update prescreening_applications set released_at=now() where batch_id=$1", [p.batch]);
  expect((await observe(p)).data).toBe("received");
  expect((await confirm(p)).data).toBe("reconciliation_required");
  expect((await db.query("select reason from booking_payment_captures where attempt_id=$1", [p.id])).rows[0].reason).toBe("prescreening_payment_window_ended");
  const retry = await admin.rpc("booking_payment_retry", { p_attempt: p.id });
  expect(retry.error?.code).toBe("22023");
  expect((await db.query("select count(*)::int n from booking_payment_retry_audit where attempt_id=$1", [p.id])).rows[0].n).toBe(0);
  expect((await confirm(p)).data).toBe("reconciliation_required");
});

it("scopes progress and retry by tenant, hides runner diagnostics, and audits allowed retries", async () => {
  const p = await prepared();
  await observe(p);
  await svc.rpc("booking_payment_capture_failure", { p_attempt: p.id, p_payment_id: p.capture.paymentId, p_error_code: "42703" });
  expect((await stranger.rpc("booking_payment_progress", { p_orders: [p.order] })).data).toEqual([]);
  const runnerProgress = await runner.rpc("booking_payment_progress", { p_orders: [p.order] });
  expect(runnerProgress.error).toBeNull();
  expect(runnerProgress.data).toEqual([expect.objectContaining({ booking_order_id: p.order, attempt_id: p.id, state: "processing", attempts: null, last_error_code: null, last_attempt_at: null })]);
  expect((await admin.rpc("booking_payment_progress", { p_orders: [p.order] })).data).toEqual([expect.objectContaining({ state: "processing", attempts: 1, last_error_code: "42703" })]);
  for (const client of [runner, stranger]) expect((await client.rpc("booking_payment_retry", { p_attempt: p.id })).error?.code).toBe("42501");
  const retry = await admin.rpc("booking_payment_retry", { p_attempt: p.id });
  expect(retry.error).toBeNull(); expect(retry.data).toBe(true);
  expect((await db.query("select requested_by,org_id from booking_payment_retry_audit where attempt_id=$1", [p.id])).rows).toEqual([{ requested_by: administrator, org_id: org }]);
  expect((await db.query("select attempted_at,outcome from payment_reconciliation_checks where kind='group' and subject_id=$1", [p.id])).rows).toEqual([{ attempted_at: null, outcome: null }]);
  for (const client of [runner, admin, stranger]) {
    expect((await client.from("booking_payment_captures").select("*")).error?.code).toBe("42501");
    expect((await client.from("booking_payment_retry_audit").select("*")).error?.code).toBe("42501");
  }
});

it("recovers received captures despite expired attempts and previous review worker outcomes", async () => {
  const p = await prepared(); await observe(p);
  await db.query("update booking_payment_attempts set status='expired' where id=$1", [p.id]);
  await db.query("insert into payment_reconciliation_checks(kind,subject_id,org_id,session_id,outcome) values('group',$1,$2,$3,'reconciliation_required')", [p.id, org, p.capture.sessionId]);
  const claim = await svc.rpc("payment_reconciliation_claim", { p_limit: 20 });
  expect(claim.error).toBeNull();
  expect(claim.data).toContainEqual(expect.objectContaining({ kind: "group", subject_id: p.id }));
  expect((await confirm(p)).data).toBe("fulfilled");
});

it("blocks new checkout, discount, cancellation, hold release and payout while evidence is unresolved", async () => {
  const p = await prepared(); await observe(p);
  await db.query("update booking_payment_attempts set status='expired' where id=$1", [p.id]);
  expect((await svc.rpc("booking_order_prepare_payment", { p_actor: actor, p_order: p.order, p_method: "qrph", p_key: randomUUID() })).error?.message).toBe("payment_capture_unresolved");
  expect((await svc.rpc("booking_payment_claim_dispatch", { p_actor: actor, p_attempt: p.id, p_request: {}, p_livemode: false })).error?.message).toBe("payment_capture_unresolved");
  expect((await svc.rpc("discount_apply", { p_actor: actor, p_registration: p.registrations[0].id, p_code: null })).error?.message).toBe("discount_payment_locked");
  expect((await svc.rpc("booking_order_cancel", { p_actor: actor, p_order: p.order })).error?.message).toBe("payment_already_started");
  expect((await db.query("select group_payout_blockers($1) n", [event])).rows[0].n).toBe(1);
  await db.query("update booking_orders set expires_at=now()-interval '1 minute' where id=$1", [p.order]);
  await db.query("update registrations set expires_at=now()-interval '1 minute' where booking_order_id=$1", [p.order]);
  // Simulate elapsed wall time in this local fixture. The immutable deadline
  // trigger stays active for every application RPC and all assertions below.
  await db.query("begin");
  try {
    await db.query("set local session_replication_role=replica");
    await db.query("update prescreening_batches set payment_ready_at=now()-interval '73 hours',payment_deadline_at=now()-interval '1 hour' where id=$1", [p.batch]);
    await db.query("commit");
  } catch (error) { await db.query("rollback"); throw error; }
  expect((await svc.rpc("finish_group_checkout_expiry", { p_order: p.order })).data).toBe("provider_unresolved");
  expect((await svc.rpc("prescreening_finish_expiry", { p_batch: p.batch })).data).toBe("payment_unresolved");
  await svc.rpc("expire_stale_registrations");
  expect((await db.query("select status from registrations where booking_order_id=$1", [p.order])).rows[0].status).toBe("pending");
  expect((await db.query("select count(*)::int n from event_capacity_claims($1)", [event])).rows[0].n).toBe(1);
  expect((await db.query("select released_at from prescreening_applications where batch_id=$1", [p.batch])).rows[0].released_at).toBeNull();
});

it("enforces explicit function privileges and rejects payload-shaped diagnostic messages", async () => {
  const p = await prepared(); await observe(p);
  for (const client of [runner, createClient(env.url, env.anonKey, { auth: { persistSession: false } })]) {
    expect((await client.rpc("booking_payment_capture_observe", { p_attempt: p.id, p_capture: p.capture })).error?.code).toBe("42501");
    expect((await client.rpc("booking_payment_capture_failure", { p_attempt: p.id, p_payment_id: p.capture.paymentId, p_error_code: "42703" })).error?.code).toBe("42501");
  }
  const invalid = await svc.rpc("booking_payment_capture_failure", { p_attempt: p.id, p_payment_id: p.capture.paymentId, p_error_code: '{"secret":"provider payload"}' });
  expect(invalid.error?.code).toBe("22023");
  expect((await db.query("select attempts,last_error_code from booking_payment_captures where attempt_id=$1", [p.id])).rows[0]).toEqual({ attempts: 0, last_error_code: null });
  const grants = await db.query("select has_function_privilege('authenticated','public.booking_payment_progress(uuid[])','execute') progress,has_function_privilege('authenticated','public.booking_payment_retry(uuid)','execute') retry,has_function_privilege('service_role','public.booking_payment_capture_observe(uuid,jsonb)','execute') observe,has_function_privilege('anon','public.booking_payment_progress(uuid[])','execute') anon_progress");
  expect(grants.rows[0]).toEqual({ progress: true, retry: true, observe: true, anon_progress: false });
  const columns = await db.query("select has_column_privilege('service_role','public.booking_payment_captures','last_error_code','update') service_update,has_column_privilege('authenticated','public.booking_payment_captures','last_error_code','select') runner_read");
  expect(columns.rows[0]).toEqual({ service_update: true, runner_read: false });
});


it("reviews a late capture when another category and a legacy hold now fill the event limit", async () => {
  const p = await prepared(1, false);
  await db.query("update booking_payment_attempts set status='expired' where id=$1", [p.id]);
  await db.query("update registrations set status='expired',expires_at=null where booking_order_id=$1", [p.order]);
  await db.query("update booking_orders set status='expired',expires_at=null where id=$1", [p.order]);
  // Event capacity is derived from categories. A categoryless legacy place can
  // fill the event while this order's own category still has a nominal slot.
  await db.query("update categories set slots_total=1 where event_id=$1", [event]);
  await db.query("update events set status='coming_soon',slug=$2,discipline='trail',hero_image_url='https://example.test/hero.jpg',description='Legacy reservation fixture',coming_soon_reserve_enabled=true,reservation_fee_cents=500,reservation_deadline_at=now()+interval '10 days' where id=$1", [event, `capture-recovery-${event}`]);
  await db.query("insert into event_reservations(org_id,event_id,user_id,email,idempotency_key,status,reservation_fee_cents,platform_fee_cents,registration_deadline_at,checkout_expires_at) values($1,$2,$3,'legacy@example.test',$4,'paid',500,0,now()+interval '10 days',now()+interval '1 day')", [org, event, administrator, randomUUID()]);
  await db.query("update events set status='open' where id=$1", [event]);
  await db.query("insert into registrations(org_id,event_id,category_id,user_id,total_amount,status,ticket_token,waiver_version_id) values($1,$2,$3,$4,100000,'paid','existing.paid.ticket',$5)", [org, event, category2, outsider, waiver]);
  expect((await observe(p)).data).toBe("received");
  expect((await confirm(p)).data).toBe("reconciliation_required");
  expect((await db.query("select reason from booking_payment_captures where attempt_id=$1", [p.id])).rows[0].reason).toBe("fulfillment_conflict");
  expect((await db.query("select count(*)::int n from registrations where event_id=$1 and status='paid'", [event])).rows[0].n).toBe(1);
});

it("rechecks the general category partition for a late capture without reviving its released claim", async () => {
  const p = await prepared(1, false);
  await db.query("update booking_payment_attempts set status='expired' where id=$1", [p.id]);
  await db.query("update registrations set status='expired',expires_at=null where booking_order_id=$1", [p.order]);
  await db.query("update booking_orders set status='expired',expires_at=null where id=$1", [p.order]);
  await db.query("update categories set reservation_enabled=true,reservation_slots=slots_total,reservation_fee_cents=10000,reservation_sales_close_at=now()+interval '1 day',entry_payment_deadline_at=now()+interval '2 days' where id=$1", [category]);
  expect((await observe(p)).data).toBe("received");
  expect((await confirm(p)).data).toBe("reconciliation_required");
  expect((await db.query("select reason from booking_payment_captures where attempt_id=$1", [p.id])).rows[0].reason).toBe("fulfillment_conflict");
});


it.each([false, true])("preserves the current last-slot holder when the late capture enters review first: %s", async (reviewFirst) => {
  const late = await prepared(1, false);
  await db.query("update booking_payment_attempts set status='expired' where id=$1", [late.id]);
  await db.query("update registrations set status='expired',expires_at=null where booking_order_id=$1", [late.order]);
  await db.query("update booking_orders set status='expired',expires_at=null where id=$1", [late.order]);
  await db.query("update categories set slots_total=1 where id=$1", [category]);
  const current = await prepared(1, false, [guest]);
  expect((await observe(late)).data).toBe("received");
  const claims = (await db.query("select registration_id from event_capacity_claims($1) where category_id=$2", [event, category])).rows;
  expect(claims).toEqual([{ registration_id: current.registrations[0].id }]);
  if (reviewFirst) expect((await confirm(late)).data).toBe("reconciliation_required");
  expect((await observe(current)).data).toBe("received");
  expect((await confirm(current)).data).toBe("fulfilled");
  expect((await confirm(late)).data).toBe("reconciliation_required");
  expect((await db.query("select status,ticket_token from registrations where booking_order_id=$1", [late.order])).rows).toEqual([{ status: "expired", ticket_token: null }]);
  expect((await db.query("select status from registrations where booking_order_id=$1", [current.order])).rows).toEqual([{ status: "paid" }]);
  expect((await db.query("select slots_taken from categories where id=$1", [category])).rows[0].slots_taken).toBe(1);
});

it("rolls back every entry of an expired mixed-category group when only part still fits", async () => {
  const p = await prepared(2, false, [self, guest], true);
  await db.query("update booking_payment_attempts set status='expired' where id=$1", [p.id]);
  await db.query("update registrations set status='expired',expires_at=null where booking_order_id=$1", [p.order]);
  await db.query("update booking_orders set status='expired',expires_at=null where id=$1", [p.order]);
  await db.query("update categories set reservation_enabled=true,reservation_slots=slots_total,reservation_fee_cents=10000,reservation_sales_close_at=now()+interval '1 day',entry_payment_deadline_at=now()+interval '2 days' where id=$1", [category2]);
  expect((await observe(p)).data).toBe("received");
  expect((await confirm(p)).data).toBe("reconciliation_required");
  expect((await db.query("select reason from booking_payment_captures where attempt_id=$1", [p.id])).rows[0].reason).toBe("fulfillment_conflict");
  expect((await db.query("select status,ticket_token from registrations where booking_order_id=$1", [p.order])).rows).toEqual([{ status: "expired", ticket_token: null }, { status: "expired", ticket_token: null }]);
  expect((await db.query("select count(*)::int n from booking_payment_allocations where org_id=$1", [org])).rows[0].n).toBe(0);
  expect((await db.query("select count(*)::int n from booking_order_deliveries where booking_order_id=$1", [p.order])).rows[0].n).toBe(0);
  expect((await db.query("select slots_taken from categories where event_id=$1", [event])).rows).toEqual([{ slots_taken: 0 }, { slots_taken: 0 }]);
});
