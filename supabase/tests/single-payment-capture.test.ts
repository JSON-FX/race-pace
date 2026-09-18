import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

const db = new Client({ connectionString: loadEnv().dbUrl });
beforeAll(() => db.connect());
afterAll(() => db.end());

async function fixture() {
  const user = randomUUID(), org = randomUUID(), event = randomUUID();
  const category = randomUUID(), registration = randomUUID();
  const session = `cs_${randomUUID().replaceAll("-", "")}`;
  await db.query("begin");
  await db.query(
    "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) " +
      "values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'x',now(),now(),now())",
    [user, `capture-${user}@example.com`],
  );
  await db.query("insert into public.organizations(id,name,slug) values($1,'Capture QA',$2)", [org, `capture-${org}`]);
  await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Capture QA','draft')", [event, org]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'QA','QA',10000,10)", [category, org, event]);
  await db.query(
    "insert into public.registrations(id,org_id,event_id,category_id,user_id,status,total_amount) values($1,$2,$3,$4,$5,'pending',10000)",
    [registration, org, event, category, user],
  );
  await db.query(
    "insert into public.payments(org_id,registration_id,provider,provider_ref,amount,status,checkout_fee_mode,checkout_request) " +
      "values($1,$2,'paymongo',$3,10000,'pending','absorb',$4::jsonb)",
    [org, registration, session, JSON.stringify({ registrationId: registration, amount: 10000 })],
  );
  await db.query("insert into public.user_roles(user_id,role) values($1,'super_admin')", [user]);
  await db.query("set local role service_role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
  return { event, registration, session };
}

async function observe(registration: string, session: string, paymentId: string, amount = 10000) {
  const r = await db.query<{ state: string }>(
    "select public.single_capture_observe($1,$2,$3,$4,250,$5,false,null,$6::jsonb) as state",
    [registration, paymentId, session, amount, amount - 250, JSON.stringify({ test: true })],
  );
  return r.rows[0]!.state;
}

it("stores a capture once, counts its replay, and holds payout until settlement", async () => {
  const f = await fixture();
  try {
    const paymentId = `pay_${randomUUID().replaceAll("-", "")}`;
    expect(await observe(f.registration, f.session, paymentId)).toBe("observed");
    expect(await observe(f.registration, f.session, paymentId)).toBe("observed");
    const before = await db.query<{ delivery_count: number; state: string }>(
      "select delivery_count,state from public.single_payment_captures where provider_payment_id=$1", [paymentId],
    );
    expect(before.rows[0]).toMatchObject({ delivery_count: 2, state: "observed" });
    const blockers = await db.query<{ count: number }>("select public.single_capture_blockers($1) as count", [f.event]);
    expect(blockers.rows[0]!.count).toBe(1);

    const raw = { session: { data: { attributes: { payments: [{ id: paymentId, attributes: { status: "paid" } }] } } } };
    await db.query("update public.payments set status='paid',raw=$2::jsonb where registration_id=$1", [f.registration, JSON.stringify(raw)]);
    const settled = await db.query<{ state: string }>("select public.single_capture_settle($1,$2) as state", [f.registration, paymentId]);
    expect(settled.rows[0]!.state).toBe("settled");
    const after = await db.query<{ count: number }>("select public.single_capture_blockers($1) as count", [f.event]);
    expect(after.rows[0]!.count).toBe(0);
  } finally { await db.query("rollback"); }
});

it("keeps an extra paid payment visible and blocks the organizer payout", async () => {
  const f = await fixture();
  try {
    const first = `pay_${randomUUID().replaceAll("-", "")}`;
    const extra = `pay_${randomUUID().replaceAll("-", "")}`;
    expect(await observe(f.registration, f.session, first)).toBe("observed");
    expect(await observe(f.registration, f.session, extra)).toBe("reconciliation_required");
    const row = await db.query<{ state: string; reason: string }>(
      "select state,reason from public.single_payment_captures where provider_payment_id=$1", [extra],
    );
    expect(row.rows[0]).toMatchObject({ state: "reconciliation_required", reason: "extra_capture" });
    const blockers = await db.query<{ count: number }>("select public.single_capture_blockers($1) as count", [f.event]);
    expect(blockers.rows[0]!.count).toBe(2);
    await db.query("savepoint payout_probe");
    await expect(db.query("select public.payout_open_statement($1)", [f.event]))
      .rejects.toThrow("single_capture_reconciliation_required");
    await db.query("rollback to savepoint payout_probe");
  } finally { await db.query("rollback"); }
});

it("records a fixed-price mismatch without fulfilling the registration", async () => {
  const f = await fixture();
  try {
    const id = `pay_${randomUUID().replaceAll("-", "")}`;
    expect(await observe(f.registration, f.session, id, 10100)).toBe("reconciliation_required");
    const row = await db.query<{ reason: string }>(
      "select reason from public.single_payment_captures where provider_payment_id=$1", [id],
    );
    expect(row.rows[0]!.reason).toBe("fixed_price_mismatch");
  } finally { await db.query("rollback"); }
});

it("retains a paid capture with incomplete provider metadata for manual review", async () => {
  const f = await fixture();
  try {
    const id = `pay_${randomUUID().replaceAll("-", "")}`;
    const result = await db.query<{ state: string }>(
      "select public.single_capture_observe($1,$2,$3,null,null,null,null,'capture_metadata_invalid',$4::jsonb) as state",
      [f.registration, id, f.session, JSON.stringify({ payment: { id } })],
    );
    expect(result.rows[0]!.state).toBe("reconciliation_required");
    const stored = await db.query<{ reason: string; amount_cents: number | null }>(
      "select reason,amount_cents from public.single_payment_captures where provider_payment_id=$1", [id],
    );
    expect(stored.rows[0]).toMatchObject({ reason: "capture_metadata_invalid", amount_cents: null });
    const blockers = await db.query<{ count: number }>("select public.single_capture_blockers($1) as count", [f.event]);
    expect(blockers.rows[0]!.count).toBe(1);
  } finally { await db.query("rollback"); }
});

it("blocks a paid new checkout that never recorded its capture", async () => {
  const f = await fixture();
  try {
    await db.query("update public.payments set status='paid' where registration_id=$1", [f.registration]);
    const blockers = await db.query<{ count: number }>("select public.single_capture_blockers($1) as count", [f.event]);
    expect(blockers.rows[0]!.count).toBe(1);
  } finally { await db.query("rollback"); }
});
