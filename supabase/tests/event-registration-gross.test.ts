import { expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

it("reports original captured event sales through refunds while preserving tenant and admin scope", async () => {
  const db = new Client({ connectionString: loadEnv().dbUrl });
  await db.connect();
  const admin = randomUUID(), runner = randomUUID();
  const org = randomUUID(), otherOrg = randomUUID();
  const event = randomUUID(), otherEvent = randomUUID(), foreignEvent = randomUUID();
  try {
    await db.query("begin");
    // Identity/waiver behavior has its own suites. Rollback restores these triggers.
    await db.query("alter table public.registrations disable trigger registration_passport_bridge");
    await db.query("alter table public.registrations disable trigger z_registration_record_waiver");
    for (const user of [admin, runner]) {
      await db.query("insert into auth.users(id,email) values($1,$2)", [user, `${user}@example.com`]);
    }
    for (const id of [org, otherOrg]) {
      await db.query("insert into organizations(id,name,slug) values($1,'Gross QA',$2)", [id, id]);
    }
    await db.query("insert into user_roles(user_id,org_id,role) values($1,$2,'admin')", [admin, org]);
    const categories = new Map<string, string>();
    for (const [id, tenant] of [[event, org], [otherEvent, org], [foreignEvent, otherOrg]]) {
      const category = randomUUID();
      categories.set(id, category);
      await db.query("insert into events(id,org_id,name,status,event_date) values($1,$2,'Gross QA','draft',current_date+1)", [id, tenant]);
      await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','QA',100000,20)", [category, tenant, id]);
    }
    async function entry(id: string, tenant: string, status: string, amount: number, refunded = 0) {
      const passport = randomUUID(), registration = randomUUID();
      await db.query("insert into runner_passports(id,created_by_user_id,first_name,last_name) values($1,$2,'Gross','Runner')", [passport, runner]);
      await db.query(`insert into registrations(id,org_id,event_id,category_id,user_id,participant_passport_id,
        booked_by_user_id,status,total_amount,idempotency_key)
        values($1,$2,$3,$4,null,$5,$6,'pending',100000,$7)`,
      [registration, tenant, id, categories.get(id), passport, runner, randomUUID()]);
      await db.query(`insert into payments(org_id,registration_id,amount,status,refunded_amount,platform_fee,net_to_org)
        values($1,$2,$3,$4,$5,5000,$3-5000-$5)`, [tenant, registration, amount, status, refunded]);
    }
    await entry(event, org, "paid", 106599);
    await entry(event, org, "partially_refunded", 206599, 40000);
    // Full refund returns less than the charge. Adding retained + refunds loses fees.
    await entry(event, org, "refunded", 306599, 301599);
    await entry(event, org, "pending", 906599);
    await entry(event, org, "failed", 806599);
    await entry(otherEvent, org, "paid", 706599);
    await entry(foreignEvent, otherOrg, "paid", 606599);

    const privilege = await db.query(`select
      has_function_privilege('authenticated','public.admin_event_registration_gross(uuid)','EXECUTE') as authenticated,
      has_function_privilege('anon','public.admin_event_registration_gross(uuid)','EXECUTE') as anon,
      prosecdef as definer from pg_proc where oid='public.admin_event_registration_gross(uuid)'::regprocedure`);
    expect(privilege.rows[0]).toEqual({ authenticated: true, anon: false, definer: false });
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]);
    async function gross(id: string) {
      return Number((await db.query("select gross_cents from public.admin_event_registration_gross($1)", [id])).rows[0].gross_cents);
    }
    expect(await gross(event)).toBe(619797);
    expect(await gross(otherEvent)).toBe(706599);
    expect(await gross(foreignEvent)).toBe(0);
    expect(await gross(randomUUID())).toBe(0);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [runner]);
    expect(await gross(event)).toBe(0);
  } finally {
    await db.query("rollback");
    await db.end();
  }
});
