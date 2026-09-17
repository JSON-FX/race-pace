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
    [user, `expiry-${user}@example.com`],
  );
  await db.query("insert into public.organizations(id,name,slug) values($1,'Expiry QA',$2)", [org, `expiry-${org}`]);
  await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Expiry QA','open')", [event, org]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'QA','QA',10000,10)", [category, org, event]);
  await db.query(
    "insert into public.registrations(id,org_id,event_id,category_id,user_id,status,total_amount,expires_at) " +
      "values($1,$2,$3,$4,$5,'pending',10000,now()-interval '1 minute')",
    [registration, org, event, category, user],
  );
  await db.query(
    "insert into public.payments(org_id,registration_id,provider,provider_ref,amount,status,checkout_fee_mode,checkout_request) " +
      "values($1,$2,'paymongo',$3,10000,'pending','absorb',$4::jsonb)",
    [org, registration, session, JSON.stringify({ registrationId: registration, amount: 10000 })],
  );
  await db.query("set local role service_role");
  return { event, registration, session };
}

async function state(registration: string) {
  const row = await db.query<{ registration_status: string; payment_status: string }>(
    "select r.status as registration_status,p.status as payment_status " +
      "from public.registrations r join public.payments p on p.registration_id=r.id where r.id=$1",
    [registration],
  );
  return row.rows[0];
}

it("keeps PayMongo reservations pending until provider expiry is confirmed", async () => {
  const f = await fixture();
  try {
    const candidates = await db.query<{ registration_id: string; session_id: string }>(
      "select * from public.paymongo_expiry_candidates(20)",
    );
    expect(candidates.rows).toContainEqual({ registration_id: f.registration, session_id: f.session });
    await db.query("select public.expire_stale_registrations()");
    expect(await state(f.registration)).toMatchObject({ registration_status: "pending", payment_status: "pending" });

    const mismatch = await db.query<{ result: string }>(
      "select public.finish_paymongo_checkout_expiry($1,$2,'{}'::jsonb) as result",
      [f.registration, "cs_other"],
    );
    expect(mismatch.rows[0]!.result).toBe("mismatch");
    expect(await state(f.registration)).toMatchObject({ registration_status: "pending", payment_status: "pending" });

    const done = await db.query<{ result: string }>(
      "select public.finish_paymongo_checkout_expiry($1,$2,$3::jsonb) as result",
      [f.registration, f.session, JSON.stringify({ source: "provider_expire_api" })],
    );
    expect(done.rows[0]!.result).toBe("expired");
    expect(await state(f.registration)).toMatchObject({ registration_status: "expired", payment_status: "failed" });
    const attempt = await db.query<{ outcome: string; attempts: number }>(
      "select outcome,attempts from public.provider_session_expiry_attempts where registration_id=$1",
      [f.registration],
    );
    expect(attempt.rows[0]).toMatchObject({ outcome: "expired", attempts: 1 });
  } finally { await db.query("rollback"); }
});

it("does not expire a session with an observed capture", async () => {
  const f = await fixture();
  try {
    await db.query(
      "select public.single_capture_observe($1,$2,$3,10000,250,9750,false,null,'{}'::jsonb)",
      [f.registration, `pay_${randomUUID().replaceAll("-", "")}`, f.session],
    );
    const result = await db.query<{ result: string }>(
      "select public.finish_paymongo_checkout_expiry($1,$2,'{}'::jsonb) as result",
      [f.registration, f.session],
    );
    expect(result.rows[0]!.result).toBe("capture_pending");
    expect(await state(f.registration)).toMatchObject({ registration_status: "pending", payment_status: "pending" });
  } finally { await db.query("rollback"); }
});

it("keeps an uncertain checkout and closed event pending for provider review", async () => {
  const f = await fixture();
  try {
    await db.query("update public.payments set provider_ref=null where registration_id=$1", [f.registration]);
    await db.query("update public.events set status='closed' where id=$1", [f.event]);
    expect(await state(f.registration)).toMatchObject({ registration_status: "pending", payment_status: "pending" });
    const candidates = await db.query<{ registration_id: string; session_id: string | null }>(
      "select * from public.paymongo_expiry_candidates(20)",
    );
    expect(candidates.rows).toContainEqual({ registration_id: f.registration, session_id: null });
    const result = await db.query<{ result: string }>(
      "select public.finish_paymongo_checkout_expiry($1,$2,'{}'::jsonb) as result",
      [f.registration, f.session],
    );
    expect(result.rows[0]!.result).toBe("mismatch");
  } finally { await db.query("rollback"); }
});
