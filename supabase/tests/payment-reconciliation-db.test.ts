import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";
const db = new Client({ connectionString: loadEnv().dbUrl });
beforeAll(() => db.connect()); afterAll(() => db.end()); afterEach(() => db.query("rollback"));
async function fixture() {
  await db.query("begin");
  const org = randomUUID(), user = randomUUID(), event = randomUUID(), category = randomUUID(), registration = randomUUID(), reservation = randomUUID(), reservationEvent = randomUUID();
  await db.query("insert into auth.users(id,email) values($1,$2)", [user, `${user}@example.test`]);
  await db.query("insert into organizations(id,name,slug) values($1::uuid,'Reconciliation test',$1::text)", [org]);
  await db.query("insert into events(id,org_id,name,status) values($1,$2,'Reconciliation','draft')", [event, org]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','Q',10000,100)", [category, org, event]);
  await db.query("insert into registrations(id,org_id,event_id,category_id,user_id,status,total_amount) values($1,$2,$3,$4,$5,'pending',10000)", [registration, org, event, category, user]);
  await db.query("insert into payments(org_id,registration_id,provider,provider_ref,amount,status) values($1,$2,'paymongo','cs_single',10000,'pending')", [org, registration]);
  await db.query("insert into events(id,org_id,name,slug,status,discipline,hero_image_url,description,coming_soon_reserve_enabled,reservation_fee_cents,reservation_deadline_at,total_event_slots) values($1::uuid,$2,'Reservation reconciliation',$1::text,'coming_soon','trail','https://example.test/hero.jpg','Test',true,500,now()+interval '10 days',10)", [reservationEvent,org]);
  await db.query(`insert into event_reservations(id,org_id,event_id,user_id,email,idempotency_key,reservation_fee_cents,platform_fee_cents,registration_deadline_at,checkout_expires_at)
    values($1,$2,$3,$4,$5,$6,500,0,now()+interval '10 days',now()+interval '1 day')`, [reservation, org, reservationEvent, user, `${user}@example.test`, randomUUID()]);
  await db.query("insert into reservation_payments(org_id,event_id,reservation_id,provider,provider_ref,amount_cents,platform_fee_cents) values($1,$2,$3,'paymongo','cs_reservation',500,0)", [org, reservationEvent, reservation]);
  const order = randomUUID(), group = randomUUID();
  await db.query("insert into booking_orders(id,org_id,event_id,category_id,booked_by_user_id,idempotency_key) values($1,$2,$3,$4,$5,$6)", [order,org,event,category,user,randomUUID()]);
  await db.query(`insert into booking_payment_attempts(id,org_id,booking_order_id,booked_by_user_id,idempotency_key,method,status,terms_snapshot,base_cents,platform_fee_cents,processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
    values($1,$2,$3,$4,$5,'gcash','ready','{}',10000,0,0,10000,250,9750)`, [group,org,order,user,randomUUID()]);
  await db.query("insert into booking_payment_dispatches(attempt_id,org_id,request_body,livemode,state,session_id,checkout_url) values($1,$2,'{}',false,'ready','cs_group','https://checkout.example.test')", [group,org]);
  return { org, registration, reservation, user, group };
}
it("claims before expiry, excludes concurrent claims, and retries fairly with a new lease", async () => {
  const f = await fixture();
  try {
    await db.query("set local role service_role");
    const first = (await db.query("select * from payment_reconciliation_claim(1)")).rows[0];
    const second = (await db.query("select * from payment_reconciliation_claim(1)")).rows[0];
    const third = (await db.query("select * from payment_reconciliation_claim(1)")).rows[0];
    expect(new Set([first.subject_id, second.subject_id, third.subject_id])).toEqual(new Set([f.registration, f.reservation, f.group]));
    expect((await db.query("select * from payment_reconciliation_claim(20)")).rowCount).toBe(0);
    expect((await db.query("select payment_reconciliation_finish($1,$2,$3,'pending') done", [first.kind, first.subject_id, first.lease])).rows[0].done).toBe(true);
    expect((await db.query("select payment_reconciliation_finish($1,$2,$3,'paid') done", [first.kind, first.subject_id, first.lease])).rows[0].done).toBe(false);
    await db.query("update payment_reconciliation_checks set attempted_at=now()-interval '5 minutes'");
    const retry = (await db.query("select * from payment_reconciliation_claim(20)")).rows;
    expect(retry).toHaveLength(3); expect(retry.find(x => x.subject_id === first.subject_id).lease).not.toBe(first.lease);
  } finally { await db.query("rollback"); }
});
it("excludes settled/reviewed work and denies runner access", async () => {
  const f = await fixture();
  try {
    const jobs = (await db.query("select * from payment_reconciliation_claim(20)")).rows;
    for (const row of jobs) await db.query("select payment_reconciliation_finish($1,$2,$3,'review_required')", [row.kind,row.subject_id,row.lease]);
    await db.query("update payment_reconciliation_checks set attempted_at=now()-interval '5 minutes'");
    expect((await db.query("select * from payment_reconciliation_claim(20)")).rowCount).toBe(0);
    expect((await db.query("select has_function_privilege('authenticated','payment_reconciliation_claim(integer)','EXECUTE') allowed")).rows[0].allowed).toBe(false);
    expect((await db.query("select has_table_privilege('authenticated','payment_reconciliation_checks','SELECT') allowed")).rows[0].allowed).toBe(false);
    await db.query("update payments set status='paid' where registration_id=$1", [f.registration]);
    expect((await db.query("select * from payment_reconciliation_pending_v where subject_id=$1", [f.registration])).rowCount).toBe(0);
  } finally { await db.query("rollback"); }
});
it("alerts platform operators for disabled delivery and a stalled worker without duplicate alerts", async () => {
  const f = await fixture();
  try {
    await db.query("insert into user_roles(user_id,role) values($1,'super_admin')", [f.user]);
    await db.query("select payment_reconciliation_heartbeat('payment_webhook_disabled_or_missing')");
    await db.query("select payment_reconciliation_alerts()");
    expect((await db.query("select * from notifications where user_id=$1 and data->>'reason'='payment_webhook_disabled_or_missing'", [f.user])).rowCount).toBe(1);
    await db.query("update payment_reconciliation_health set completed_at=now()-interval '16 minutes'");
    await db.query("select payment_reconciliation_alerts()");
    expect((await db.query("select * from notifications where user_id=$1 and data->>'reason'='payment_reconciliation_stalled'", [f.user])).rowCount).toBe(1);
  } finally { await db.query("rollback"); }
});
