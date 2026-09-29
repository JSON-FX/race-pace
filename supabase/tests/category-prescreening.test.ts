import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { loadEnv } from "../../test/env";

const { dbUrl } = loadEnv();

async function fixture(db: Client) {
  const org = randomUUID(), otherOrg = randomUUID(), booker = randomUUID(), outsider = randomUUID();
  const event = randomUUID(), category = randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now())",
    [booker, `${booker}@test.invalid`, outsider, `${outsider}@test.invalid`]);
  await db.query("insert into public.organizations(id,name,slug) values($1,'Screening',$2),($3,'Other',$4)",
    [org, org, otherOrg, otherOrg]);
  await db.query("insert into public.events(id,org_id,name,slug,status,inclusions) values($1,$2,'Screening',$3,'draft',array['Bib','Medal'])", [event, org, event]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'70k','70K',350000,100)", [category, org, event]);
  const passport = (await db.query("select id from public.runner_passports where claimed_user_id=$1", [booker])).rows[0].id as string;
  return { org, otherOrg, booker, outsider, event, category, passport };
}

async function transaction(run: (db: Client) => Promise<void>) {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  await db.query("begin");
  try { await run(db); } finally { await db.query("rollback"); await db.end(); }
}

async function rejected(db: Client, sql: string, args: unknown[], code: string) {
  await db.query("savepoint expected_failure");
  await expect(db.query(sql, args)).rejects.toMatchObject({ code });
  await db.query("rollback to savepoint expected_failure");
}

describe("category pre-screening foundation", () => {
  it("retires unused proofs without deleting submitted proof or changing held capacity", () => transaction(async db => {
    const unused = await reviewFixture(db);
    const used = await reviewFixture(db);
    await submit(db, used.booker, used.request);
    await db.query("update public.prescreening_uploads set created_at=now()-interval '8 days' where id=any($1::uuid[])", [[unused.upload, used.upload]]);
    const paths = (await db.query("select public.prescreening_collect_unused_proofs(200) as path")).rows.map(r => r.path);
    expect(paths).toContain(`${unused.org}/${unused.booker}/${unused.upload}`);
    expect(paths).not.toContain(`${used.org}/${used.booker}/${used.upload}`);
    expect((await db.query("select id from public.prescreening_uploads where id=$1", [unused.upload])).rows).toEqual([]);
    expect((await db.query("select id from public.prescreening_uploads where id=$1", [used.upload])).rows).toHaveLength(1);
    // A failed Storage delete remains queued; an old form cannot claim its proof.
    expect((await db.query("select public.prescreening_collect_unused_proofs(200) as path")).rows.map(r => r.path)).toContain(paths[0]);
    await rejected(db, "select public.prescreening_submit($1,$2::jsonb)", [unused.booker, JSON.stringify(unused.request)], "23514");
    expect((await db.query("select * from public.event_capacity_claims($1)", [unused.event])).rows).toHaveLength(0);
    expect((await db.query("select * from public.event_capacity_claims($1)", [used.event])).rows).toHaveLength(2);
    await db.query("set local role authenticated");
    await rejected(db, "select * from public.prescreening_proof_cleanup", [], "42501");
    await db.query("reset role");
  }));

  it("rotates unresolved reservation expiry candidates so later holds are serviced", () => transaction(async db => {
    // Isolate this transaction's candidate page from fixtures left by other suites.
    await db.query("update public.event_reservations set maintenance_checked_at=now()+interval '1 day'");
    const f = await fixture(db), second = await fixture(db), firstId = randomUUID(), secondId = randomUUID();
    for (const [data, id] of [[f, firstId], [second, secondId]] as const) {
      await db.query("select set_config('request.jwt.claim.role','service_role',true)");
      await db.query("update public.events set status='open' where id=$1", [data.event]);
      await db.query(`insert into public.event_reservations(id,org_id,event_id,user_id,email,idempotency_key,reservation_fee_cents,platform_fee_cents,registration_deadline_at,checkout_expires_at,reservation_request,reservation_total_fee_cents,reservation_total_platform_fee_cents)
        values($1,$2,$3,$4,'queue@test.invalid',$5,10000,0,now()+interval '1 day',now()-interval '1 hour','{}',10000,0)`,
        [id,data.org,data.event,data.booker,randomUUID()]);
    }
    const first = (await db.query("select public.coming_soon_expiry_candidates(1) as id")).rows[0].id;
    const next = (await db.query("select public.coming_soon_expiry_candidates(1) as id")).rows[0].id;
    expect(new Set([first,next])).toEqual(new Set([firstId,secondId]));
    expect((await db.query("select status from public.event_reservations where id=any($1::uuid[])", [[firstId,secondId]])).rows)
      .toEqual([{status:"pending"},{status:"pending"}]);
  }));

  it("defaults admission settings off and constrains allocation and enabled requirements", () => transaction(async db => {
    const f = await fixture(db);
    expect((await db.query("select reservation_enabled,prescreening_enabled,reservation_slots from public.categories where id=$1", [f.category])).rows[0])
      .toEqual({ reservation_enabled: false, prescreening_enabled: false, reservation_slots: 0 });
    await rejected(db,"update public.categories set reservation_slots=101 where id=$1",[f.category],"23514");
    await rejected(db,"update public.categories set reservation_enabled=true where id=$1",[f.category],"23514");
    await rejected(db,"update public.categories set prescreening_enabled=true,prescreening_requirement=' ' where id=$1",[f.category],"23514");
    await db.query("update public.categories set reservation_enabled=true,reservation_slots=20,reservation_fee_cents=50000,reservation_sales_close_at=now()+interval '10 days',entry_payment_deadline_at=now()+interval '20 days',prescreening_enabled=true,prescreening_requirement='Complete 50K' where id=$1",[f.category]);
  }));

  it("copies legacy inclusions in order without changing category identity or capacity", () => transaction(async db => {
    const f = await fixture(db);
    // Execute the migration's exact data-copy statement against an existing race.
    const migration = readFileSync(new URL("../migrations/20260929100000_category_prescreening_foundation.sql", import.meta.url), "utf8");
    const backfill = migration.match(/update public\.categories c set inclusions=[\s\S]*?;/)![0];
    await db.query(backfill);
    expect((await db.query("select id,slots_total,inclusions from public.categories where id=$1", [f.category])).rows[0])
      .toEqual({ id: f.category, slots_total: 100, inclusions: ["Bib", "Medal"] });
  }));

  it("isolates upload tickets by booker and disallows tenant mismatches or browser writes", () => transaction(async db => {
    const f = await fixture(db), upload = randomUUID();
    const insert = "insert into public.prescreening_uploads(id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,object_path,size_bytes,content_type,verified_at) values($1,$2,$3,$4,$5,$6,$7,$8,'image/png',now())";
    const args = [upload, f.org, f.event, f.category, f.passport, f.booker, `${f.org}/${f.booker}/${upload}`, 10000000];
    await rejected(db, insert, [...args.slice(0,7),10000001], "23514");
    await rejected(db, insert, [upload,f.otherOrg,...args.slice(2,6),`${f.otherOrg}/${f.booker}/${upload}`,10000000], "23503");
    await db.query(insert,args);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[f.booker]);
    expect((await db.query("select count(*) from public.prescreening_uploads")).rows[0].count).toBe("1");
    await rejected(db,"update public.prescreening_uploads set verified_at=null where id=$1",[upload],"42501");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[f.outsider]);
    expect((await db.query("select count(*) from public.prescreening_uploads")).rows[0].count).toBe("0");
    await db.query("reset role");
    expect((await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='prescreening-proofs'")).rows[0])
      .toEqual({ public: false, file_size_limit: "10000000", allowed_mime_types: ["image/jpeg","image/png","image/webp"] });
  }));
});

describe("shared category capacity accounting", () => {
  it("exposes only published aggregate availability and counts pre-screening holds", () => transaction(async db => {
    const draft = await fixture(db);
    await db.query("set local role anon");
    expect((await db.query("select * from public.category_availability($1)", [draft.event])).rows).toEqual([]);
    await db.query("reset role");

    const f = await reviewFixture(db);
    const before = (await db.query("select * from public.category_availability($1) where category_id=$2", [f.event, f.category])).rows[0];
    expect(before).toMatchObject({ total_available: 100, general_available: 80, reservation_available: 20 });
    await submit(db, f.booker, f.request);
    await db.query("set local role anon");
    const held = (await db.query("select * from public.category_availability($1) where category_id=$2", [f.event, f.category])).rows[0];
    expect(held).toMatchObject({ total_available: 99, general_available: 79, reservation_available: 20 });
    await db.query("reset role");
    await db.query("update public.categories set reservation_sales_close_at=now()-interval '1 second' where id=$1", [f.category]);
    const released = (await db.query("select * from public.category_availability($1) where category_id=$2", [f.event, f.category])).rows[0];
    expect(released).toMatchObject({ total_available: 99, general_available: 99, reservation_available: 0 });
  }));

  it("keeps review holds without a deadline and transfers an approved hold without double counting", () => transaction(async db => {
    const f = await fixture(db), batch = randomUUID(), app = randomUUID();
    await db.query("insert into public.prescreening_batches(id,org_id,event_id,booked_by_user_id,idempotency_key,checkout_intent,request_snapshot) values($1,$2,$3,$4,$5,'entry','{}')", [batch,f.org,f.event,f.booker,randomUUID()]);
    await db.query(`insert into public.prescreening_applications(id,batch_id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,participant_name,is_managed,screening_required,decision,created_at)
      values($1,$2,$3,$4,$5,$6,$7,'Runner',false,false,'not_required',now()-interval '1 year')`,[app,batch,f.org,f.event,f.category,f.passport,f.booker]);
    expect((await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(1);
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query("update public.events set status='open' where id=$1",[f.event]);
    await db.query("select public.prescreening_refresh_ready($1)",[batch]);
    await db.query("insert into public.registrations(org_id,event_id,category_id,user_id,booked_by_user_id,participant_passport_id,status,total_amount,prescreening_application_id) values($1,$2,$3,$4,$4,$5,'pending',350000,$6)",[f.org,f.event,f.category,f.booker,f.passport,app]);
    const claims=(await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows;
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({category_id:f.category,application_id:app,pool:"general"});
    expect(claims[0].registration_id).toBeTruthy();
  }));

  it("protects reserved allocation while sales are open and releases unsold allocation at cutoff", () => transaction(async db => {
    const f=await fixture(db);
    await db.query("update public.categories set slots_total=100,reservation_enabled=true,reservation_slots=20,reservation_fee_cents=50000,reservation_sales_close_at=now()+interval '10 days',entry_payment_deadline_at=now()+interval '20 days' where id=$1",[f.category]);
    await db.query("select public.assert_category_capacity($1,'general',80)",[f.category]);
    await rejected(db,"select public.assert_category_capacity($1,'general',81)",[f.category],"23514");
    await db.query("select public.assert_category_capacity($1,'reservation',20)",[f.category]);
    await rejected(db,"select public.assert_category_capacity($1,'reservation',21)",[f.category],"23514");
    await db.query("update public.categories set reservation_sales_close_at=now()-interval '1 second' where id=$1",[f.category]);
    await db.query("select public.assert_category_capacity($1,'general',100)",[f.category]);
    await rejected(db,"select public.assert_category_capacity($1,'general',101)",[f.category],"23514");
  }));
});

async function reviewFixture(db: Client) {
  const f=await fixture(db), managed=randomUUID(), easyCategory=randomUUID(), upload=randomUUID(), admin=randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[admin,`${admin}@test.invalid`]);
  await db.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'admin')",[admin,f.org]);
  await db.query("insert into public.runner_passports(id,created_by_user_id,first_name,last_name) values($1,$2,'Managed','Runner')",[managed,f.booker]);
  await db.query("insert into public.passport_managers(passport_id,user_id) values($1,$2)",[managed,f.booker]);
  await db.query("update public.categories set prescreening_enabled=true,prescreening_requirement='Complete 50K',reservation_enabled=true,reservation_slots=20,reservation_fee_cents=50000,reservation_sales_close_at=now()+interval '10 days',entry_payment_deadline_at=now()+interval '20 days' where id=$1",[f.category]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'21k','21K',150000,100)",[easyCategory,f.org,f.event]);
  await db.query("select set_config('request.jwt.claim.role','service_role',true)");
  await db.query("update public.events set status='open' where id=$1",[f.event]);
  await db.query("insert into public.prescreening_uploads(id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,object_path,size_bytes,content_type,verified_at) values($1,$2,$3,$4,$5,$6,$7,10000000,'image/png',now())",
    [upload,f.org,f.event,f.category,f.passport,f.booker,`${f.org}/${f.booker}/${upload}`]);
  const request={event_id:f.event,idempotency_key:randomUUID(),checkout_intent:"entry",participants:[
    {participant_passport_id:f.passport,category_id:f.category,proof_upload_id:upload,explanation:"Completed the 50K race."},
    {participant_passport_id:managed,category_id:easyCategory},
  ]};
  return {...f,managed,easyCategory,upload,admin,request};
}

async function submit(db: Client, actor: string, request: unknown): Promise<string> {
  return (await db.query("select public.prescreening_submit($1,$2::jsonb) as id",[actor,JSON.stringify(request)])).rows[0].id;
}

async function asUser(db: Client, user: string) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
}

describe("pre-screening submission and decisions", () => {
  it("queues one booker confirmation only after all holds succeed, never on replay or failed submission", () => transaction(async db => {
    const f = await reviewFixture(db);
    await db.query("update public.categories set slots_total=0 where id=$1", [f.easyCategory]);
    await rejected(db, "select public.prescreening_submit($1,$2)", [f.booker, JSON.stringify(f.request)], "23514");
    expect((await db.query("select count(*) from public.transactional_email_jobs where event_id=$1 and type='prescreening_submitted'", [f.event])).rows[0].count).toBe("0");
    await db.query("update public.categories set slots_total=100 where id=$1", [f.easyCategory]);
    const batch = await submit(db, f.booker, f.request);
    expect(await submit(db, f.booker, f.request)).toBe(batch);
    const jobs = (await db.query("select user_id,payload from public.transactional_email_jobs where event_id=$1 and type='prescreening_submitted'", [f.event])).rows;
    expect(jobs).toEqual([{ user_id: f.booker, payload: { batch_id: batch } }]);
    expect((await db.query("select count(*) from public.event_capacity_claims($1)", [f.event])).rows[0].count).toBe("2");
    expect((await db.query("select payment_deadline_at from public.prescreening_batches where id=$1", [batch])).rows[0].payment_deadline_at).toBeNull();
    await asUser(db, f.booker);
    expect((await db.query("select type from public.prescreening_email_status($1)", [batch])).rows).toEqual([{ type: "prescreening_submitted" }]);
    await asUser(db, f.outsider);
    await rejected(db, "select * from public.prescreening_email_status($1)", [batch], "42501");
  }));

  it("does not send an awaiting-approval email for a group needing no review", () => transaction(async db => {
    const f = await reviewFixture(db);
    const batch = await submit(db, f.booker, { ...f.request, participants: [{ participant_passport_id: f.managed, category_id: f.easyCategory }] });
    expect((await db.query("select type from public.transactional_email_jobs where payload->>'batch_id'=$1", [batch])).rows).toEqual([{ type: "prescreening_ready" }]);
  }));

  it("holds both mixed-category participants for free, then starts one immutable 72-hour window", () => transaction(async db => {
    const f=await reviewFixture(db),batch=await submit(db,f.booker,f.request);
    expect(await submit(db,f.booker,f.request)).toBe(batch);
    expect((await db.query("select decision from public.prescreening_applications where batch_id=$1 order by decision",[batch])).rows)
      .toEqual([{decision:"not_required"},{decision:"pending"}]);
    expect((await db.query("select count(*) from public.event_capacity_claims($1)",[f.event])).rows[0].count).toBe("2");
    expect((await db.query("select status,payment_deadline_at from public.prescreening_batches where id=$1",[batch])).rows[0])
      .toEqual({status:"reviewing",payment_deadline_at:null});
    expect((await db.query("select count(*) from public.registrations where event_id=$1",[f.event])).rows[0].count).toBe("0");
    expect((await db.query("select count(*) from public.event_reservations where event_id=$1",[f.event])).rows[0].count).toBe("0");
    const app=(await db.query("select id from public.prescreening_applications where batch_id=$1 and decision='pending'",[batch])).rows[0].id;
    await asUser(db,f.outsider);
    await rejected(db,"select public.prescreening_review($1,'approved')",[app],"42501");
    await asUser(db,f.admin);
    await db.query("select public.prescreening_review($1,'approved')",[app]);
    await db.query("select public.prescreening_review($1,'approved')",[app]);
    const ready=(await db.query("select status,payment_deadline_at-payment_ready_at as duration from public.prescreening_batches where id=$1",[batch])).rows[0];
    expect(ready.status).toBe("ready");
    expect(ready.duration.days).toBe(3);
    await db.query("reset role");
    await rejected(db,"update public.prescreening_batches set payment_ready_at=now()+interval '1 hour',payment_deadline_at=now()+interval '73 hours' where id=$1",[batch],"23514");
    expect((await db.query("select count(*) from public.transactional_email_jobs where dedup_key=$1",[`prescreening_ready:${batch}`])).rows[0].count).toBe("1");
  }));

  it("rolls back the entire group if any category is full or proof is unverified", () => transaction(async db => {
    const f=await reviewFixture(db);
    await db.query("update public.categories set slots_total=0 where id=$1",[f.easyCategory]);
    await rejected(db,"select public.prescreening_submit($1,$2)",[f.booker,JSON.stringify(f.request)],"23514");
    expect((await db.query("select count(*) from public.prescreening_batches where event_id=$1",[f.event])).rows[0].count).toBe("0");
    await db.query("update public.categories set slots_total=100 where id=$1",[f.easyCategory]);
    await db.query("update public.prescreening_uploads set verified_at=null where id=$1",[f.upload]);
    await rejected(db,"select public.prescreening_submit($1,$2)",[f.booker,JSON.stringify(f.request)],"23514");
    expect((await db.query("select count(*) from public.event_capacity_claims($1)",[f.event])).rows[0].count).toBe("0");
  }));

  it("requires a rejection reason, releases only that Passport, and makes the remaining group payable", () => transaction(async db => {
    const f=await reviewFixture(db),batch=await submit(db,f.booker,f.request);
    const app=(await db.query("select id from public.prescreening_applications where batch_id=$1 and decision='pending'",[batch])).rows[0].id;
    await asUser(db,f.admin);
    await rejected(db,"select public.prescreening_review($1,'rejected',' ')",[app],"22023");
    await db.query("select public.prescreening_review($1,'rejected','Please choose a shorter category.')",[app]);
    await db.query("reset role");
    const held=(await db.query("select participant_passport_id from public.event_capacity_claims($1)",[f.event])).rows;
    expect(held).toEqual([{participant_passport_id:f.managed}]);
    expect((await db.query("select status from public.prescreening_batches where id=$1",[batch])).rows[0].status).toBe("ready");
    const alternative={...f.request,idempotency_key:randomUUID(),participants:[{participant_passport_id:f.passport,category_id:f.easyCategory}]};
    expect(await submit(db,f.booker,alternative)).not.toBe(batch);
    expect((await db.query("select count(*) from public.event_capacity_claims($1)",[f.event])).rows[0].count).toBe("2");
  }));

  it("preserves a request across sales cutoff and refuses approval without a full payment window", () => transaction(async db => {
    const f=await reviewFixture(db);
    const request={...f.request,checkout_intent:"reservation",participants:[f.request.participants[0]]};
    const batch=await submit(db,f.booker,request);
    await db.query("update public.categories set reservation_sales_close_at=now()-interval '1 hour',entry_payment_deadline_at=now()+interval '1 day' where id=$1",[f.category]);
    const app=(await db.query("select id from public.prescreening_applications where batch_id=$1",[batch])).rows[0].id;
    await asUser(db,f.admin);
    await rejected(db,"select public.prescreening_review($1,'approved')",[app],"23514");
    expect((await db.query("select decision from public.prescreening_applications where id=$1",[app])).rows[0].decision).toBe("pending");
    await db.query("reset role");
    await db.query("update public.categories set entry_payment_deadline_at=now()+interval '10 days' where id=$1",[f.category]);
    await asUser(db,f.admin);
    await db.query("select public.prescreening_review($1,'approved')",[app]);
    expect((await db.query("select status from public.prescreening_batches where id=$1",[batch])).rows[0].status).toBe("ready");
  }));
});

describe("atomic category editor", () => {
  it("derives total capacity, preserves unseen categories, and rolls back an invalid multi-row save", () => transaction(async db => {
    const f=await reviewFixture(db);
    await asUser(db,f.admin);
    const row={id:f.category,code:"70k",label:"70K",base_price:350000,slots_total:170,inclusions:["Bib","Medal"]};
    await db.query("select public.save_event_categories($1,$2,$3)",[f.event,[f.category],JSON.stringify([row])]);
    expect((await db.query("select total_event_slots from public.events where id=$1",[f.event])).rows[0].total_event_slots).toBe(270);
    expect((await db.query("select id from public.categories where id=$1",[f.easyCategory])).rows).toHaveLength(1);
    await db.query("update public.events set total_event_slots=999 where id=$1",[f.event]);
    expect((await db.query("select total_event_slots from public.events where id=$1",[f.event])).rows[0].total_event_slots).toBe(270);
    await rejected(db,"select public.save_event_categories($1,$2,$3)",[f.event,[f.category],JSON.stringify([
      {...row,slots_total:180},{code:"invalid",label:"Invalid",base_price:100,slots_total:1,reservation_enabled:true}
    ])],"23514");
    expect((await db.query("select slots_total from public.categories where id=$1",[f.category])).rows[0].slots_total).toBe(170);
    await asUser(db,f.outsider);
    await rejected(db,"select public.save_event_categories($1,$2,$3)",[f.event,[f.category],"[]"],"42501");
  }));

  it("prevents removing capacity held by a review request", () => transaction(async db => {
    const f=await reviewFixture(db);
    await submit(db,f.booker,f.request);
    await rejected(db,"update public.categories set slots_total=0 where id=$1",[f.easyCategory],"23514");
    await rejected(db,"delete from public.categories where id=$1",[f.easyCategory],"23514");
  }));
});

describe("category reservation payment admission", () => {
  it("ends a direct mixed-category checkout by the earliest participant entry deadline", () => transaction(async db => {
    const f=await reviewFixture(db);
    await db.query("update categories set prescreening_enabled=false,reservation_sales_close_at=now()+interval '30 minutes',entry_payment_deadline_at=now()+interval '1 hour' where id=$1",[f.category]);
    await db.query("update categories set reservation_enabled=true,reservation_slots=20,reservation_fee_cents=30000,reservation_sales_close_at=now()+interval '10 days',entry_payment_deadline_at=now()+interval '20 days' where id=$1",[f.easyCategory]);
    const request={event_id:f.event,idempotency_key:randomUUID(),participants:f.request.participants.map(({participant_passport_id,category_id})=>({participant_passport_id,category_id}))};
    const id=(await db.query("select reserve_category_passports($1,$2,'fake') id",[f.booker,request])).rows[0].id;
    const row=(await db.query("select r.checkout_expires_at,c.entry_payment_deadline_at from event_reservations r cross join categories c where r.id=$1 and c.id=$2",[id,f.category])).rows[0];
    expect(row.checkout_expires_at).toEqual(row.entry_payment_deadline_at);
    await db.query("update reservation_payments set provider='paymongo',provider_ref='cs_deadline' where reservation_id=$1",[id]);
    const latePaidAt=new Date(row.entry_payment_deadline_at.getTime()+1000).toISOString();
    const late=(await db.query("select confirm_reservation_payment($1,'cs_deadline',$2,80000,0,80000,'gcash',$3) result",[id,`pay_${randomUUID()}`,{racepace_provider_paid_at:latePaidAt}])).rows[0].result;
    expect(late).toBe("review_required");
  }));
  it("blocks reservation payment during review, then snapshots each category's fee in one checkout", () => transaction(async db => {
    const f=await reviewFixture(db);
    await db.query("update public.categories set reservation_enabled=true,reservation_slots=30,reservation_fee_cents=30000,reservation_sales_close_at=now()+interval '10 days',entry_payment_deadline_at=now()+interval '20 days' where id=$1",[f.easyCategory]);
    const request={...f.request,checkout_intent:"reservation"};
    const batch=await submit(db,f.booker,request);
    const checkout={event_id:f.event,idempotency_key:randomUUID(),prescreening_batch_id:batch,participants:request.participants.map(({participant_passport_id,category_id})=>({participant_passport_id,category_id}))};
    await rejected(db,"select public.reserve_category_passports($1,$2,'fake')",[f.booker,JSON.stringify(checkout)],"23514");
    const app=(await db.query("select id from public.prescreening_applications where batch_id=$1 and decision='pending'",[batch])).rows[0].id;
    await asUser(db,f.admin);await db.query("select public.prescreening_review($1,'approved')",[app]);await db.query("reset role");
    const reserve=async ()=>(await db.query("select public.reserve_category_passports($1,$2,'fake') as id",[f.booker,JSON.stringify(checkout)])).rows[0].id as string;
    const id=await reserve();expect(await reserve()).toBe(id);
    expect((await db.query("select reservation_total_fee_cents,quantity from public.event_reservations where id=$1",[id])).rows[0])
      .toEqual({reservation_total_fee_cents:80000,quantity:2});
    expect((await db.query("select amount_cents from public.reservation_payments where reservation_id=$1",[id])).rows[0].amount_cents).toBe(80000);
    expect((await db.query("select count(*) from public.event_capacity_claims($1)",[f.event])).rows[0].count).toBe("2");
    await db.query("update public.categories set reservation_fee_cents=90000 where id=$1",[f.category]);
    expect(await reserve()).toBe(id);
    await db.query("update public.reservation_payments set provider_ref='cs_screened' where reservation_id=$1",[id]);
    expect((await db.query("select public.confirm_reservation_payment($1,'cs_screened',$2,80000,0,80000,'fake','{}') as result",[id,`pay_${randomUUID()}`])).rows[0].result).toBe("paid");
    expect((await db.query("select net_to_org_cents from public.reservation_payments where reservation_id=$1",[id])).rows[0].net_to_org_cents).toBe(80000);
  }));

  it("blocks a direct registration for either mixed-group member while review is pending", () => transaction(async db => {
    const f=await reviewFixture(db);await submit(db,f.booker,f.request);
    const waiver=(await db.query("insert into public.organizer_waiver_versions(org_id,title,body) values($1,'Test','Test waiver') returning id",[f.org])).rows[0].id;
    await db.query("update public.events set waiver_version_id=$2 where id=$1",[f.event,waiver]);
    for(const [passport,category] of [[f.passport,f.category],[f.managed,f.easyCategory]]) {
      await rejected(db,"insert into public.registrations(org_id,event_id,category_id,booked_by_user_id,participant_passport_id,user_id,waiver_version_id,waiver_acceptance_method,status,total_amount) values($1,$2,$3,$4,$5,$6,$7,$8,'pending',100)",[f.org,f.event,category,f.booker,passport,passport===f.passport?f.booker:null,waiver,passport===f.passport?"signed_in_self":"participant_on_helper_device"],"23514");
    }
  }));
});


describe("screening cancellation and expiry", () => {
  it("cancels all free holds once, with booker authorization", () => transaction(async db => {
    const f=await reviewFixture(db), batch=await submit(db,f.booker,f.request);
    await asUser(db,f.outsider);
    await rejected(db,"select public.prescreening_cancel($1)",[batch],"42501");
    await asUser(db,f.booker);
    await db.query("select public.prescreening_cancel($1)",[batch]);
    await db.query("select public.prescreening_cancel($1)",[batch]);
    await db.query("reset role");
    expect((await db.query("select count(*) from public.event_capacity_claims($1)",[f.event])).rows[0].count).toBe("0");
    expect((await db.query("select status from public.prescreening_batches where id=$1",[batch])).rows[0].status).toBe("cancelled");
  }));
  it("never expires a reviewing batch and releases an unpaid ready batch only after its fixed deadline", () => transaction(async db => {
    const f=await reviewFixture(db), batch=await submit(db,f.booker,f.request);
    expect((await db.query("select public.prescreening_finish_expiry($1) as result",[batch])).rows[0].result).toBe("reviewing");
    // Seed a past fixed window, without changing a timer that was already started.
    await db.query("update public.prescreening_batches set status='ready',payment_ready_at=now()-interval '4 days',payment_deadline_at=now()-interval '1 day' where id=$1",[batch]);
    expect((await db.query("select public.prescreening_finish_expiry($1) as result",[batch])).rows[0].result).toBe("expired");
    expect((await db.query("select count(*) from public.event_capacity_claims($1)",[f.event])).rows[0].count).toBe("0");
  }));
});

describe("screening release safeguards", () => {
  it("releases a rejected runner even if the remaining group needs a deadline extension", () => transaction(async db => {
    const f = await reviewFixture(db), batch = await submit(db, f.booker, f.request);
    await db.query("update events set registration_closes_at=now()+interval '1 day' where id=$1", [f.event]);
    const app = (await db.query("select id from prescreening_applications where batch_id=$1 and decision='pending'", [batch])).rows[0].id;
    await asUser(db, f.admin);
    await db.query("select prescreening_review($1,'rejected','The proof does not meet the requirement.')", [app]);
    await db.query("reset role");
    expect((await db.query("select participant_passport_id from event_capacity_claims($1)", [f.event])).rows).toEqual([{ participant_passport_id: f.managed }]);
    expect((await db.query("select status,payment_deadline_at from prescreening_batches where id=$1", [batch])).rows[0]).toEqual({ status: "reviewing", payment_deadline_at: null });
    await db.query("update events set registration_closes_at=now()+interval '10 days' where id=$1", [f.event]);
    await db.query("select prescreening_refresh_ready($1)", [batch]);
    expect((await db.query("select status from prescreening_batches where id=$1", [batch])).rows[0].status).toBe("ready");
  }));

  it("preserves paid entries when screening is enabled on an existing 170-slot category", () => transaction(async db => {
    const f = await fixture(db);
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query("update categories set slots_total=170,inclusions=array['Bib','Medal','Shirt','Meal','Water','Timing','Aid','Certificate'] where id=$1", [f.category]);
    await db.query("update events set status='open' where id=$1", [f.event]);
    const entry = (await db.query("insert into registrations(org_id,event_id,category_id,user_id,participant_passport_id,booked_by_user_id,status,total_amount,ticket_token) values($1,$2,$3,$4,$5,$4,'paid',170000,'existing-ticket') returning id", [f.org,f.event,f.category,f.booker,f.passport])).rows[0].id;
    await db.query("update categories set prescreening_enabled=true,prescreening_requirement='Complete 50K' where id=$1", [f.category]);
    await db.query("update registrations set custom_data=custom_data||'{\"shirt_size\":\"M\"}' where id=$1", [entry]);
    expect((await db.query("select status,total_amount,ticket_token,prescreening_application_id from registrations where id=$1", [entry])).rows[0]).toEqual({ status: "paid", total_amount: 170000, ticket_token: "existing-ticket", prescreening_application_id: null });
    expect((await db.query("select total_event_slots from events where id=$1", [f.event])).rows[0].total_event_slots).toBe(170);
    expect((await db.query("select cardinality(inclusions) n from categories where id=$1", [f.category])).rows[0].n).toBe(8);
  }));

  it("serializes two simultaneous submissions for the last category slot", async () => {
    const setup = new Client({ connectionString: dbUrl });
    const second = new Client({ connectionString: dbUrl });
    await setup.connect(); await second.connect();
    const f = await fixture(setup);
    try {
      await setup.query("select set_config('request.jwt.claim.role','service_role',false)");
      await setup.query("update categories set slots_total=1 where id=$1", [f.category]);
      await setup.query("update events set status='open' where id=$1", [f.event]);
      const outsiderPassport = (await setup.query("select id from runner_passports where claimed_user_id=$1", [f.outsider])).rows[0].id;
      const request = (passport: string) => ({ event_id: f.event, idempotency_key: randomUUID(), checkout_intent: "entry", participants: [{ participant_passport_id: passport, category_id: f.category }] });
      const results = await Promise.allSettled([submit(setup, f.booker, request(f.passport)), submit(second, f.outsider, request(outsiderPassport))]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      expect((await setup.query("select count(*) from event_capacity_claims($1)", [f.event])).rows[0].count).toBe("1");
    } finally {
      await setup.query("delete from transactional_email_jobs where event_id=$1", [f.event]);
      await setup.query("delete from prescreening_applications where event_id=$1", [f.event]);
      await setup.query("delete from prescreening_batches where event_id=$1", [f.event]);
      await setup.query("delete from events where id=$1", [f.event]);
      await setup.query("delete from organizations where id=any($1::uuid[])", [[f.org,f.otherOrg]]);
      await setup.query("delete from auth.users where id=any($1::uuid[])", [[f.booker,f.outsider]]);
      await setup.end(); await second.end();
    }
  });
});

describe("reservation checkout retries", () => {
  it("preserves reservation payment terms when sales are disabled during review", () => transaction(async db => {
    const f=await reviewFixture(db);
    const batch=await submit(db,f.booker,{...f.request,checkout_intent:'reservation',participants:[f.request.participants[0]]});
    await db.query("update categories set reservation_enabled=false where id=$1",[f.category]);
    await rejected(db,"update categories set reservation_fee_cents=null,entry_payment_deadline_at=null where id=$1",[f.category],"23514");
    const app=(await db.query("select id from prescreening_applications where batch_id=$1",[batch])).rows[0].id;
    await asUser(db,f.admin); await db.query("select prescreening_review($1,'approved')",[app]); await db.query("reset role");
    expect((await db.query("select status from prescreening_batches where id=$1",[batch])).rows[0].status).toBe('ready');
  }));

  it("prevents an event edit from cutting short an approved group's entry payment window", () => transaction(async db => {
    const f=await reviewFixture(db), batch=await submit(db,f.booker,f.request);
    const app=(await db.query("select id from prescreening_applications where batch_id=$1 and decision='pending'",[batch])).rows[0].id;
    await asUser(db,f.admin); await db.query("select prescreening_review($1,'approved')",[app]); await db.query("reset role");
    await rejected(db,"update events set registration_closes_at=now()+interval '1 day' where id=$1",[f.event],"23514");
    await db.query("update events set registration_closes_at=now()+interval '4 days' where id=$1",[f.event]);
    await db.query("update events set registration_closes_at=null where id=$1",[f.event]);
  }));

  it("freezes checkout under the expiry lock and rejects stale, foreign or expired dispatches", () => transaction(async db => {
    const f=await reviewFixture(db);
    await db.query("update categories set prescreening_enabled=false where id=$1",[f.category]);
    const request={event_id:f.event,idempotency_key:randomUUID(),participants:[{participant_passport_id:f.passport,category_id:f.category}]};
    const id=(await db.query("select reserve_category_passports($1,$2,'paymongo') id",[f.booker,request])).rows[0].id;
    const body={idempotencyKey:`reservation:${id}`,paymentMethodTypes:['gcash']};
    const prepare="select reservation_prepare_checkout($1,$2,$3,$4) body";
    await rejected(db,prepare,[f.outsider,id,0,body],"42501");
    await rejected(db,prepare,[f.booker,id,1,body],"23514");
    expect((await db.query(prepare,[f.booker,id,0,body])).rows[0].body).toEqual(body);
    expect((await db.query(prepare,[f.booker,id,0,{paymentMethodTypes:['card']}])).rows[0].body).toEqual(body);
    await db.query("update event_reservations set checkout_expires_at=now()-interval '1 second' where id=$1",[id]);
    expect((await db.query("select expire_event_reservation($1) result",[id])).rows[0].result).toBe('provider_unresolved');
    expect((await db.query("select count(*) from event_capacity_claims($1)",[f.event])).rows[0].count).toBe('1');
    await rejected(db,prepare,[f.booker,id,0,body],"23514");
    await asUser(db,f.booker);
    await rejected(db,prepare,[f.booker,id,0,body],"42501");
  }));

  it("cannot dispatch while expiry owns the event lock or after expiry releases the slot", async () => {
    const setup=new Client({connectionString:dbUrl}), dispatch=new Client({connectionString:dbUrl});
    await setup.connect(); await dispatch.connect();
    const f=await fixture(setup);
    try {
      await setup.query("select set_config('request.jwt.claim.role','service_role',false)");
      await setup.query("update categories set reservation_enabled=true,reservation_slots=20,reservation_fee_cents=50000,reservation_sales_close_at=now()+interval '1 day',entry_payment_deadline_at=now()+interval '10 days' where id=$1",[f.category]);
      await setup.query("update events set status='open' where id=$1",[f.event]);
      const request={event_id:f.event,idempotency_key:randomUUID(),participants:[{participant_passport_id:f.passport,category_id:f.category}]};
      const id=(await setup.query("select reserve_category_passports($1,$2,'paymongo') id",[f.booker,request])).rows[0].id;
      await setup.query("begin");
      await setup.query("select id from events where id=$1 for update",[f.event]);
      await dispatch.query("set lock_timeout='150ms'");
      await expect(dispatch.query("select reservation_prepare_checkout($1,$2,0,'{}')",[f.booker,id])).rejects.toMatchObject({code:'55P03'});
      await setup.query("update event_reservations set checkout_expires_at=now()-interval '1 second' where id=$1",[id]);
      expect((await setup.query("select expire_event_reservation($1) result",[id])).rows[0].result).toBe('expired');
      await setup.query("commit");
      await expect(dispatch.query("select reservation_prepare_checkout($1,$2,0,'{}')",[f.booker,id])).rejects.toMatchObject({code:'23514'});
      expect((await setup.query("select checkout_request from reservation_payments where reservation_id=$1",[id])).rows[0].checkout_request).toBeNull();
      expect((await setup.query("select count(*) from event_capacity_claims($1)",[f.event])).rows[0].count).toBe('0');
    } finally {
      await setup.query("rollback");
      await setup.query("delete from reservation_payments where event_id=$1",[f.event]);
      await setup.query("delete from event_reservation_places where event_id=$1",[f.event]);
      await setup.query("delete from event_reservations where event_id=$1",[f.event]);
      await setup.query("delete from events where id=$1",[f.event]);
      await setup.query("delete from organizations where id=any($1::uuid[])",[[f.org,f.otherOrg]]);
      await setup.query("delete from auth.users where id=any($1::uuid[])",[[f.booker,f.outsider]]);
      await setup.end(); await dispatch.end();
    }
  });

  it("replaces only a verified terminal session, retaining deadline, fee snapshots and all holds", () => transaction(async db => {
    const f=await reviewFixture(db);
    const request={...f.request,checkout_intent:"reservation",participants:[f.request.participants[0]]};
    const batch=await submit(db,f.booker,request);
    const app=(await db.query("select id from prescreening_applications where batch_id=$1",[batch])).rows[0].id;
    await asUser(db,f.admin); await db.query("select prescreening_review($1,'approved')",[app]); await db.query("reset role");
    const checkout={event_id:f.event,idempotency_key:randomUUID(),prescreening_batch_id:batch,participants:[{participant_passport_id:f.passport,category_id:f.category}]};
    const id=(await db.query("select reserve_category_passports($1,$2,'paymongo') id",[f.booker,checkout])).rows[0].id;
    const before=(await db.query("select checkout_expires_at,reservation_total_fee_cents from event_reservations where id=$1",[id])).rows[0];
    await db.query("update reservation_payments set provider_ref='cs_original',checkout_url='https://checkout.paymongo.com/original',checkout_request=$2 where reservation_id=$1",[id,{idempotencyKey:`reservation:${id}`}]);
    const retry=async (generation:number,session:string|null,evidence:unknown)=>(await db.query("select reservation_retry_checkout($1,$2,$3,$4) ok",[id,generation,session,evidence])).rows[0].ok;
    expect(await retry(0,'cs_original',{})).toBe(false);
    expect(await retry(0,'cs_other',{source:'paymongo_get',status:'expired'})).toBe(false);
    expect(await retry(0,'cs_original',{source:'paymongo_get',status:'active'})).toBe(false);
    expect(await retry(0,'cs_original',{source:'paymongo_get',status:'expired'})).toBe(true);
    expect(await retry(0,'cs_original',{source:'paymongo_get',status:'expired'})).toBe(false);
    expect((await db.query("select checkout_expires_at,reservation_total_fee_cents from event_reservations where id=$1",[id])).rows[0]).toEqual(before);
    expect((await db.query("select payment_deadline_at from prescreening_batches where id=$1",[batch])).rows[0].payment_deadline_at).toEqual(before.checkout_expires_at);
    expect((await db.query("select provider_ref,checkout_request,checkout_generation,checkout_requested_at from reservation_payments where reservation_id=$1",[id])).rows[0])
      .toEqual({provider_ref:null,checkout_request:null,checkout_generation:1,checkout_requested_at:null});
    expect((await db.query("select provider_ref from reservation_checkout_history where reservation_id=$1",[id])).rows).toEqual([{provider_ref:'cs_original'}]);
    expect((await db.query("select count(*) from event_capacity_claims($1)",[f.event])).rows[0].count).toBe('1');
    await asUser(db,f.booker);
    await rejected(db,"select reservation_retry_checkout($1,1,null,'{}')",[id],"42501");
    await rejected(db,"select * from reservation_checkout_history",[],"42501");
    await db.query("reset role");
    await db.query("update reservation_payments set provider_ref='cs_replacement',checkout_request='{}' where reservation_id=$1",[id]);
    // A delayed old-session capture must be durable but cannot fulfill the replacement.
    const capture=await db.query("select confirm_reservation_payment($1,'cs_original',$2,50000,0,50000,'gcash',$3) result",[id,`pay_${randomUUID()}`,{racepace_provider_paid_at:new Date().toISOString()}]);
    expect(capture.rows[0].result).toBe('review_required');
    expect(await retry(1,'cs_replacement',{source:'paymongo_get',status:'expired'})).toBe(false);
    expect((await db.query("select count(*) from event_capacity_claims($1)",[f.event])).rows[0].count).toBe('1');
  }));
});
