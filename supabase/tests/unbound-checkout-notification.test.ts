import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

const db = new Client({ connectionString: loadEnv().dbUrl });
beforeAll(() => db.connect());
afterAll(() => db.end());

it("alerts platform staff once when an expired hold has no bound PayMongo session", async () => {
  const user = randomUUID(), org = randomUUID(), event = randomUUID();
  const category = randomUUID(), registration = randomUUID();
  await db.query("begin");
  try {
    await db.query(
      "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) " +
        "values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'x',now(),now(),now())",
      [user, `unbound-alert-${user}@example.com`],
    );
    await db.query("insert into public.user_roles(user_id,role) values($1,'super_admin')", [user]);
    await db.query("insert into public.organizations(id,name,slug) values($1,'Unbound QA',$2)", [org, `unbound-${org}`]);
    await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Unbound QA','open')", [event, org]);
    await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'QA','QA',10000,1)", [category, org, event]);
    await db.query(
      "insert into public.registrations(id,org_id,event_id,category_id,user_id,status,total_amount,expires_at) " +
        "values($1,$2,$3,$4,$5,'pending',10000,now()-interval '1 minute')",
      [registration, org, event, category, user],
    );
    await db.query(
      "insert into public.payments(org_id,registration_id,provider,amount,status,checkout_fee_mode,checkout_request) " +
        "values($1,$2,'paymongo',10000,'pending','absorb','{}'::jsonb)",
      [org, registration],
    );
    await db.query("set local role service_role");
    expect((await db.query("select * from public.paymongo_expiry_candidates(20) where registration_id=$1", [registration])).rowCount).toBe(1);
    await db.query("select public.record_paymongo_expiry_attempt($1,null,'missing_session_ref','{}'::jsonb)", [registration]);
    await db.query("select public.record_paymongo_expiry_attempt($1,null,'missing_session_ref','{}'::jsonb)", [registration]);

    const notifications = await db.query<{ type: string; reason: string; count: number }>(
      "select type::text,data->>'reason' as reason,count(*)::integer as count from public.notifications " +
        "where user_id=$1 and dedup_key like 'checkout-unbound:%' group by type,data->>'reason'",
      [user],
    );
    expect(notifications.rows).toEqual([{ type: "payment_review", reason: "missing_session_ref", count: 1 }]);
    const held = await db.query<{ registration_status: string; payment_status: string; attempts: number }>(
      "select r.status as registration_status,p.status as payment_status,a.attempts " +
        "from public.registrations r join public.payments p on p.registration_id=r.id " +
        "join public.provider_session_expiry_attempts a on a.registration_id=r.id where r.id=$1",
      [registration],
    );
    expect(held.rows[0]).toMatchObject({ registration_status: "pending", payment_status: "pending", attempts: 2 });
  } finally { await db.query("rollback"); }
});
