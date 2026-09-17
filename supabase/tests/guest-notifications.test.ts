import { expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

it("routes two guest bookings to their helper without collapsing reminders", async () => {
 const db = new Client({ connectionString: loadEnv().dbUrl });
 await db.connect();
 const helper=randomUUID(), org=randomUUID(), event=randomUUID(), category=randomUUID();
 const registrations=[randomUUID(),randomUUID()];
 try {
  await db.query("begin");
  // Exercise future guest-shaped records without opening production checkout.
  // DDL is transaction-local and rolled back; the compatibility gate returns.
  await db.query("alter table public.registrations alter column user_id drop not null");
  await db.query("alter table public.registrations disable trigger registration_passport_bridge");
  await db.query("alter table public.registrations disable trigger z_registration_record_waiver");
  await db.query("insert into auth.users(id,email) values($1,$2)", [helper,`${helper}@example.com`]);
  await db.query("insert into public.organizations(id,name,slug) values($1,'Guest messages',$2)", [org,org]);
  await db.query("insert into public.events(id,org_id,name,status,event_date) values($1,$2,'Guest messages','open',current_date+1)", [event,org]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'Q','QA',10000,10)", [category,org,event]);
  for (let i=0;i<2;i++) {
   const passport=randomUUID();
   await db.query("insert into public.runner_passports(id,created_by_user_id,first_name,last_name) values($1,$2,'Guest',$3)", [passport,helper,String(i)]);
   await db.query("insert into public.registrations(id,org_id,event_id,category_id,user_id,participant_passport_id,booked_by_user_id,status,total_amount,idempotency_key,custom_data) values($1,$2,$3,$4,null,$5,$6,'paid',10000,$7,$8)", [registrations[i],org,event,category,passport,helper,randomUUID(),JSON.stringify({ full_name:`Guest ${i}` })]);
  }
  const paid = await db.query("select user_id,body,data from public.notifications where type='paid' and data->>'event_id'=$1", [event]);
  expect(paid.rows).toHaveLength(2);
  expect(paid.rows.every(row => row.user_id===helper)).toBe(true);
  expect(paid.rows.map(row => row.data.registration_id).sort()).toEqual([...registrations].sort());
  expect(paid.rows.map(row => row.body).join(" ")).toContain("Guest 0");
  await db.query("select public.fn_enqueue_event_reminders()");
  await db.query("select public.fn_enqueue_event_reminders()");
  const reminders=await db.query("select data,user_id from public.notifications where type='event_reminder' and data->>'event_id'=$1", [event]);
  expect(reminders.rows).toHaveLength(2);
  expect(reminders.rows.every(row => row.user_id===helper)).toBe(true);
  expect(reminders.rows.map(row => row.data.registration_id).sort()).toEqual([...registrations].sort());
  await db.query("update public.events set status='cancelled' where id=$1", [event]);
  expect((await db.query("select id from public.notifications where type='event_cancelled' and user_id=$1 and data->>'event_id'=$2", [helper,event])).rowCount).toBe(2);
  // Email exports retain one row per guest and use the verified booking account.
  // The helper can see collection status without gaining release privileges.
  await db.query("insert into public.kit_releases(id,org_id,event_id,registration_id,recipient_name,kit,released_by) values(gen_random_uuid(),$1,$2,$3,'Guest 0','{}',$4)",[org,event,registrations[0],helper]);
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[helper]);
  expect((await db.query("select id from public.kit_releases where registration_id=$1",[registrations[0]])).rowCount).toBe(1);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[randomUUID()]);
  expect((await db.query("select id from public.kit_releases where registration_id=$1",[registrations[0]])).rowCount).toBe(0);
  await db.query("reset role");
  await db.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'admin')", [helper,org]);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[helper]);
  const emails=await db.query("select * from public.admin_registration_emails($1)",[event]);
  expect(emails.rows).toHaveLength(2);
  expect(emails.rows.every(row=>row.email===`${helper}@example.com`)).toBe(true);
 } finally { await db.query("rollback"); await db.end(); }
});
