import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

const db = new Client({ connectionString: loadEnv().dbUrl });
beforeAll(() => db.connect());
afterAll(() => db.end());

it("denies direct runner deletion of an ordered line while preserving single-entry cancellation", async () => {
  const groupUser = randomUUID(), singleUser = randomUUID(), org = randomUUID();
  const event = randomUUID(), category = randomUUID(), order = randomUUID();
  const groupRegistration = randomUUID(), singleRegistration = randomUUID(), providerRegistration = randomUUID();
  await db.query("begin");
  try {
    for (const user of [groupUser, singleUser]) {
      await db.query(
        "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) " +
          "values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'x',now(),now(),now())",
        [user, `order-delete-${user}@example.com`],
      );
    }
    await db.query("insert into public.organizations(id,name,slug) values($1,'Order delete QA',$2)", [org, `order-delete-${org}`]);
    await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Order delete QA','open')", [event, org]);
    await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'QA','QA',10000,10)", [category, org, event]);
    await db.query("insert into public.booking_orders(id,org_id,event_id,category_id,booked_by_user_id,idempotency_key,status) values($1,$2,$3,$4,$5,$6,'pending')", [order, org, event, category, groupUser, randomUUID()]);
    await db.query("insert into public.registrations(id,org_id,event_id,category_id,user_id,booked_by_user_id,booking_order_id,status,total_amount) values($1,$2,$3,$4,$5,$5,$6,'pending',10000)", [groupRegistration, org, event, category, groupUser, order]);
    await db.query("insert into public.registrations(id,org_id,event_id,category_id,user_id,status,total_amount) values($1,$2,$3,$4,$5,'pending',10000)", [singleRegistration, org, event, category, singleUser]);

    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [groupUser]);
    const groupDelete = await db.query("delete from public.registrations where id=$1 returning id", [groupRegistration]);
    expect(groupDelete.rowCount).toBe(0);
    const crossUserDelete = await db.query("delete from public.registrations where id=$1 returning id", [singleRegistration]);
    expect(crossUserDelete.rowCount).toBe(0);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [singleUser]);
    const singleDelete = await db.query("delete from public.registrations where id=$1 returning id", [singleRegistration]);
    expect(singleDelete.rowCount).toBe(1);

    await db.query("reset role");
    await db.query("insert into public.registrations(id,org_id,event_id,category_id,user_id,status,total_amount) values($1,$2,$3,$4,$5,'pending',10000)", [providerRegistration, org, event, category, singleUser]);
    await db.query("insert into public.payments(org_id,registration_id,provider,provider_ref,amount,status) values($1,$2,'paymongo',$3,10000,'pending')", [org, providerRegistration, `cs_${randomUUID().replaceAll("-", "")}`]);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [singleUser]);
    const providerDelete = await db.query("delete from public.registrations where id=$1 returning id", [providerRegistration]);
    expect(providerDelete.rowCount).toBe(0);
    await db.query("reset role");
    const remaining = await db.query("select id from public.registrations where id=$1", [groupRegistration]);
    expect(remaining.rowCount).toBe(1);
    const grants = await db.query<{ anon_execute: boolean; authenticated_execute: boolean }>(
      "select has_function_privilege('anon','public.registration_payment_clear_for_delete(uuid)','execute') as anon_execute," +
        "has_function_privilege('authenticated','public.registration_payment_clear_for_delete(uuid)','execute') as authenticated_execute",
    );
    expect(grants.rows[0]).toEqual({ anon_execute: false, authenticated_execute: true });
  } finally { await db.query("rollback"); }
});
