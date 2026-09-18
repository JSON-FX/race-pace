import { expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

it("keeps one live entry per Passport even when the participant's account changes", async () => {
 const db = new Client({ connectionString: loadEnv().dbUrl });
 await db.connect();
 const a=randomUUID(), b=randomUUID(), org=randomUUID(), event=randomUUID(), category=randomUUID(), original=randomUUID();
 try {
  await db.query("begin");
  // Model an eventual verified claim without implementing a claim API. All
  // identity changes are rolled back; no sample account is repurposed.
  await db.query("insert into auth.users(id,email) values($1,$2),($3,$4)", [a, `${a}@example.com`, b, `${b}@example.com`]);
  const passport = (await db.query("select id from public.runner_passports where claimed_user_id=$1", [a])).rows[0].id;
  await db.query("insert into public.organizations(id,name,slug) values($1::uuid,'Participant boundary QA',$2)", [org,org]);
  await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Participant boundary','draft')", [event, org]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','QA',10000,10)", [category, org, event]);
  const insert = "insert into public.registrations(id,org_id,event_id,category_id,user_id,total_amount,idempotency_key) values($1,$2,$3,$4,$5,10000,$6)";
  await db.query(insert, [original,org,event,category,a,randomUUID()]);
  await db.query("update public.runner_passports set claimed_user_id=null where claimed_user_id=$1", [b]);
  await db.query("update public.runner_passports set claimed_user_id=$1 where id=$2", [b,passport]);
  await db.query("savepoint duplicate_attempt");
  await expect(db.query(insert, [randomUUID(),org,event,category,b,randomUUID()])).rejects.toMatchObject({ code: "23505", constraint: "registrations_one_live_per_event" });
  await db.query("rollback to savepoint duplicate_attempt");
  await db.query("update public.registrations set status='expired',expires_at=null where id=$1", [original]);
  await db.query(insert, [randomUUID(),org,event,category,b,randomUUID()]);
  const result = await db.query("select public.confirm_payment_tx($1,'test',0,10000,'token','{}'::jsonb) as status", [original]);
  expect(result.rows[0].status).toBe("conflict");
  expect((await db.query("select status from public.registrations where id=$1", [original])).rows[0].status).toBe("expired");
  expect((await db.query("select slots_taken from public.categories where id=$1", [category])).rows[0].slots_taken).toBe(0);
 } finally { await db.query("rollback"); await db.end(); }
});
