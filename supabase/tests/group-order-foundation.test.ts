import { expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

it("scopes internal orders and enforces pending capacity atomically", async () => {
 const db=new Client({connectionString:loadEnv().dbUrl});await db.connect();
 const org=randomUUID(),event=randomUUID(),cat=randomUUID(),user=randomUUID(),order=randomUUID();
 try {
  await db.query('begin');
  await db.query("insert into auth.users(id,email) values($1,$2)",[user,`${user}@example.com`]);
  await db.query("insert into organizations(id,name,slug) values($1,'Group QA',$2)",[org,org]);
  await db.query("insert into events(id,org_id,name,status,event_date) values($1,$2,'Group QA','draft',current_date+1)",[event,org]);
  await db.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','QA',100000,1)",[cat,org,event]);
  await db.query("insert into booking_orders(id,org_id,event_id,category_id,booked_by_user_id,idempotency_key) values($1,$2,$3,$4,$5,$6)",[order,org,event,cat,user,randomUUID()]);
  await db.query('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
  expect((await db.query('select id from booking_orders where id=$1',[order])).rowCount).toBe(1);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[randomUUID()]);
  expect((await db.query('select id from booking_orders where id=$1',[order])).rowCount).toBe(0);
  expect((await db.query("select has_table_privilege('authenticated','booking_orders','INSERT') as allowed")).rows[0].allowed).toBe(false);
  await db.query('reset role');
  // Identity/waiver checks have their own suites. Isolate capacity and scope here;
  // both disabled trigger states are transaction-local and restored by rollback.
  await db.query('alter table registrations disable trigger registration_passport_bridge');
  await db.query('alter table registrations disable trigger z_registration_record_waiver');
  const passports=[randomUUID(),randomUUID()];
  for(const id of passports) await db.query("insert into runner_passports(id,created_by_user_id) values($1,$2)",[id,user]);
  const insert=`insert into registrations(id,org_id,event_id,category_id,user_id,participant_passport_id,booked_by_user_id,booking_order_id,status,total_amount,idempotency_key,expires_at) values($1,$2,$3,$4,null,$5,$6,$7,'pending',100000,$8,$9)`;
  const args=(id:string,passport:string,expiry:string)=>[id,org,event,cat,passport,user,order,randomUUID(),expiry];
  const first=randomUUID(),expiry=new Date(Date.now()+3600000).toISOString();
  await db.query(insert,args(first,passports[0],expiry));
  await db.query('savepoint full_capacity');
  await expect(db.query(insert,args(randomUUID(),passports[1],expiry))).rejects.toThrow('category_capacity_exhausted');
  await db.query('rollback to savepoint full_capacity');
  expect((await db.query('select count(*)::int as n from registrations where booking_order_id=$1',[order])).rows[0].n).toBe(1);
  await db.query("update registrations set expires_at=now()-interval '1 second' where id=$1",[first]);
  await db.query(insert,args(randomUUID(),passports[1],expiry));
  await db.query('savepoint late_capture');
  await expect(db.query("update registrations set status='paid' where id=$1",[first])).rejects.toThrow('category_capacity_exhausted');
  await db.query('rollback to savepoint late_capture');
  await db.query('savepoint wrong_order');
  await expect(db.query('update booking_orders set category_id=$1 where id=$2',[randomUUID(),order])).rejects.toThrow('order_scope_mismatch');
  await db.query('rollback to savepoint wrong_order');
  await db.query('delete from registrations where booking_order_id=$1',[order]);
  await db.query('savepoint entire_group');
  const two=insert+",($10,$11,$12,$13,null,$14,$15,$16,'pending',100000,$17,$18)";
  await expect(db.query(two,[...args(randomUUID(),passports[0],expiry),...args(randomUUID(),passports[1],expiry)])).rejects.toThrow('category_capacity_exhausted');
  await db.query('rollback to savepoint entire_group');
  expect((await db.query('select id from registrations where booking_order_id=$1',[order])).rowCount).toBe(0);
 } finally {await db.query('rollback');await db.end();}
});

it("serializes concurrent single-checkout admissions for the last slot", async () => {
 const a=new Client({connectionString:loadEnv().dbUrl}), b=new Client({connectionString:loadEnv().dbUrl});
 await a.connect();await b.connect();
 const org=randomUUID(),event=randomUUID(),cat=randomUUID(),users=[randomUUID(),randomUUID()];
 try {
  for(const id of users) await a.query('insert into auth.users(id,email) values($1,$2)',[id,`${id}@example.com`]);
  await a.query("insert into organizations(id,name,slug) values($1,'Concurrent group QA',$2)",[org,org]);
  await a.query("insert into events(id,org_id,name,status,event_date) values($1,$2,'Concurrent QA','draft',current_date+1)",[event,org]);
  await a.query("insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','QA',100000,1)",[cat,org,event]);
  const sql="insert into registrations(org_id,event_id,category_id,user_id,total_amount,idempotency_key) values($1,$2,$3,$4,100000,$5)";
  await a.query('begin');
  await a.query(sql,[org,event,cat,users[0],randomUUID()]);
  const competing=b.query(sql,[org,event,cat,users[1],randomUUID()]).then(()=>null,e=>e.message);
  await a.query('commit');
  expect(await competing).toContain('category_capacity_exhausted');
  expect((await a.query('select count(*)::int as n from registrations where category_id=$1',[cat])).rows[0].n).toBe(1);
 } finally {
  await a.query('rollback');
  await a.query('delete from registrations where event_id=$1',[event]);
  await a.query('delete from categories where id=$1',[cat]);
  await a.query('delete from events where id=$1',[event]);
  await a.query('delete from organizations where id=$1',[org]);
  await a.query('delete from runner_passports where claimed_user_id=any($1::uuid[])',[users]);
  await a.query('delete from auth.users where id=any($1::uuid[])',[users]);
  await a.end();await b.end();
 }
});
