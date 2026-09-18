import { expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

it("reports captured gross and audits it without changing entry base", async () => {
 const db = new Client({connectionString:loadEnv().dbUrl}); await db.connect();
 const helper=randomUUID(),org=randomUUID(),event=randomUUID(),category=randomUUID(),passport=randomUUID(),reg=randomUUID();
 try {
  await db.query("begin");
  // Transaction-only fixture setup. Rollback restores both trigger states.
  await db.query("alter table public.registrations disable trigger registration_passport_bridge");
  await db.query("alter table public.registrations disable trigger z_registration_record_waiver");
  await db.query("insert into auth.users(id,email) values($1,$2)",[helper,`${helper}@example.com`]);
  await db.query("insert into organizations(id,name,slug) values($1,'Reporting QA',$2)",[org,org]);
  await db.query("insert into events(id,org_id,name,status,event_date) values($1,$2,'Reporting QA','draft',current_date+1)",[event,org]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','QA',100000,10)",[category,org,event]);
  await db.query("insert into runner_passports(id,created_by_user_id,first_name,last_name) values($1,$2,'Guest','Runner')",[passport,helper]);
  await db.query("insert into registrations(id,org_id,event_id,category_id,user_id,participant_passport_id,booked_by_user_id,status,total_amount,idempotency_key,custom_data) values($1,$2,$3,$4,null,$5,$6,'pending',100000,$7,'{\"full_name\":\"Guest Runner\"}')",[reg,org,event,category,passport,helper,randomUUID()]);
  await db.query("insert into payments(org_id,registration_id,amount) values($1,$2,106599)",[org,reg]);
  const args=[reg,'gcash',5000,98934,'qa-token','{}',2665,1599,'actual'];
  expect((await db.query("select confirm_payment_tx($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",args)).rows[0].result).toBe('paid');
  expect((await db.query("select total_amount,payment_amount,full_name from admin_registrations_v where id=$1",[reg])).rows[0]).toEqual({total_amount:100000,payment_amount:106599,full_name:'Guest Runner'});
  const audit=await db.query("select detail from registration_audit where registration_id=$1 and action='paid'",[reg]);
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0].detail).toMatchObject({amount:106599,amount_basis:'captured_gross'});
  expect((await db.query("select confirm_payment_tx($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",args)).rows[0].result).toBe('already');
  expect((await db.query("select id from registration_audit where registration_id=$1 and action='paid'",[reg])).rowCount).toBe(1);
 } finally {await db.query('rollback');await db.end();}
});
