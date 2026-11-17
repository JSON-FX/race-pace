import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../test/env";

const { dbUrl, url, anonKey, serviceKey } = loadEnv();

async function transaction(run: (db: Client) => Promise<void>) {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  await db.query("begin");
  try { await run(db); } finally { await db.query("rollback"); await db.end(); }
}

async function reject(db: Client, sql: string, params: unknown[], message: string) {
  await db.query("savepoint rejected_operation");
  await expect(db.query(sql, params)).rejects.toThrow(message);
  await db.query("rollback to savepoint rejected_operation");
}

async function actAs(db: Client, id: string) {
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}

async function fixture(db: Client, screened = false, existingRunner?: string) {
  await db.query("select set_config('request.jwt.claim.role','service_role',true)");
  const org = randomUUID(), event = randomUUID(), category = randomUUID();
  const runner = existingRunner ?? randomUUID(), second = randomUUID(), admin = randomUUID(), editor = randomUUID(), outsider = randomUUID();
  for (const user of [runner, second, admin, editor, outsider]) {
    if (user === existingRunner) continue;
    await db.query("insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at) values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),now(),now())", [user, user + "@test.invalid"]);
  }
  await db.query("insert into public.organizations(id,name,slug) values($1::uuid,'Pay Later QA',$1::text)", [org]);
  await db.query("insert into public.user_roles(user_id,org_id,role) values($1,$3,'admin'),($2,$3,'editor')", [admin, editor, org]);
  const waiver = (await db.query("insert into public.organizer_waiver_versions(org_id,title,body) values($1,'Race waiver','Synthetic test waiver') returning id", [org])).rows[0].id as string;
  await db.query("insert into public.events(id,org_id,name,slug,status,event_date,registration_closes_at,waiver_version_id) values($1::uuid,$2,'Pay Later QA',$1::text,'open',current_date+60,now()+interval '20 days',$3)", [event, org, waiver]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total,prescreening_enabled,prescreening_requirement) values($1,$2,$3,'50k','50K',180000,1,$4,$5)", [category, org, event, screened, screened ? "Previous race proof" : null]);
  await db.query(`update public.runner_passports set first_name='Juan',last_name='Dela Cruz',date_of_birth='1990-01-01',gender='Male',
    contact_number='09171234567',emergency_contact_name='Contact',emergency_contact_number='09171234567',emergency_contact_relationship='Sibling',
    shipping_barangay_code='012801001',shipping_zip_code='0123',shipping_address_line='Test address' where claimed_user_id=any($1::uuid[])`, [[runner, second]]);
  const passport = (await db.query("select id from public.runner_passports where claimed_user_id=$1", [runner])).rows[0].id as string;
  const secondPassport = (await db.query("select id from public.runner_passports where claimed_user_id=$1", [second])).rows[0].id as string;
  await actAs(db, admin);
  const grant = (await db.query("select (public.pay_later_grant($1,$2)).*", [event, runner])).rows[0];
  await db.query("reset role");
  const request = { event_id: event, category_id: category, participant_passport_id: passport, pay_later_grant_id: grant.id,
    idempotency_key: randomUUID(), waiver_version_id: waiver, waiver_accepted: true, addon_ids: [], custom_data: { full_name: "Juan Dela Cruz" } };
  return { org, event, category, runner, second, admin, editor, outsider, passport, secondPassport, waiver, grant, request };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function reserve(db: Client, f: Fixture, request: Record<string, unknown> = f.request, provider = "paymongo") {
  return (await db.query("select public.pay_later_reserve($1,$2::jsonb,$3,$4) as result",
    [f.runner, JSON.stringify(request), provider, "https://example.test/pay/callback?rid=__PAY_LATER_REGISTRATION_ID__"])).rows[0].result;
}

async function approve(db: Client, f: Fixture) {
  const upload = randomUUID();
  await db.query("insert into public.prescreening_uploads(id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,object_path,size_bytes,content_type,verified_at) values($1,$2,$3,$4,$5,$6,$7,100,'image/png',now())",
    [upload, f.org, f.event, f.category, f.passport, f.runner, f.org + "/" + f.runner + "/" + upload]);
  const req = { event_id: f.event, idempotency_key: randomUUID(), checkout_intent: "entry", participants: [
    { category_id: f.category, participant_passport_id: f.passport, proof_upload_id: upload },
  ] };
  const batch = (await db.query("select public.prescreening_submit($1,$2) as id", [f.runner, req])).rows[0].id;
  const application = (await db.query("select id from public.prescreening_applications where batch_id=$1", [batch])).rows[0].id;
  await actAs(db, f.admin);
  await db.query("select public.prescreening_review($1,'approved',null)", [application]);
  await db.query("reset role");
  return { batch, application };
}

async function movePastDue(db: Client, registration: string, grant: string) {
  // Simulate the clock by changing only this fixture. Replica mode is local to
  // the connection and immediately restored before exercising application SQL.
  await db.query("set local session_replication_role=replica");
  await db.query("update public.pay_later_grants set due_date=current_date-1,due_at=current_date::timestamp at time zone 'Asia/Manila' where id=$1", [grant]);
  await db.query("update public.registrations set created_at=now()-interval '40 days',pay_later_due_at=(select due_at from public.pay_later_grants where id=$2),expires_at=(select due_at from public.pay_later_grants where id=$2) where id=$1", [registration, grant]);
  await db.query("set local session_replication_role=origin");
}

const confirmation = "select public.confirm_pay_later_registration_tx($1,'gcash',18000,162000,'test-ticket-token','{}',0,null,'none',$2) as result";

describe("Pay Later grants and atomic reservation", () => {
  it("isolates grants from editors/other users and requires exact email outside an org", () => transaction(async db => {
    const f = await fixture(db);
    await actAs(db, f.editor);
    await reject(db, "select public.pay_later_grant($1,$2)", [f.event,f.second], "forbidden");
    await reject(db, "select * from public.pay_later_list_grants($1)", [f.event], "forbidden");
    expect((await db.query("select id from public.pay_later_grants")).rows).toEqual([]);
    await actAs(db, f.admin);
    expect((await db.query("select * from public.pay_later_search_runners($1,'Juan')", [f.event])).rows).toEqual([]);
    expect((await db.query("select * from public.pay_later_search_runners($1,$2)", [f.event,f.second+"@test.invalid"])).rows).toHaveLength(1);
    expect((await db.query("select * from public.pay_later_search_runners($1,'%')", [f.event])).rows).toEqual([]);
    await actAs(db, f.runner);
    expect((await db.query("select id from public.pay_later_grants")).rows).toEqual([{ id: f.grant.id }]);
    await reject(db, "select public.pay_later_reserve($1,$2,'fake','https://example.test')", [f.runner,f.request], "permission denied");
    await actAs(db, f.outsider);
    expect((await db.query("select id from public.pay_later_grants")).rows).toEqual([]);
  }));

  it("sets the Philippine cutoff, preserves duplicate grants and holds no slots until reservation", () => transaction(async db => {
    const f = await fixture(db);
    expect((await db.query("select due_date=(select event_date-28 from public.events where id=event_id) as default_due, due_at=((due_date+1)::timestamp at time zone 'Asia/Manila') as cutoff from public.pay_later_grants where id=$1", [f.grant.id])).rows[0]).toEqual({ default_due: true, cutoff: true });
    expect((await db.query("select * from public.event_capacity_claims($1)", [f.event])).rows).toHaveLength(0);
    await actAs(db, f.admin);
    const repeat = (await db.query("select (public.pay_later_grant($1,$2,current_date+10)).*", [f.event,f.runner])).rows[0];
    expect(repeat.due_at).toEqual(f.grant.due_at);
    await reject(db,"select public.pay_later_grant($1,$2,current_date)",[f.event,f.second],"invalid_pay_later_due_date");
    await reject(db,"select public.pay_later_grant($1,$2,current_date+60)",[f.event,f.second],"invalid_pay_later_due_date");
    await db.query("reset role");
    expect((await db.query("select * from public.transactional_email_jobs where event_id=$1 and type='pay_later_granted'", [f.event])).rows).toHaveLength(1);
    const result = await reserve(db,f);
    expect(result).toMatchObject({payment_plan:"pay_later",checkout_url:null});
    expect(await reserve(db,f)).toEqual(result);
    const rows = (await db.query("select r.*,p.discount_checkout_state,p.provider_ref,p.checkout_request from public.registrations r join public.payments p on p.registration_id=r.id where r.id=$1",[result.registration_id])).rows;
    expect(rows[0]).toMatchObject({status:"pending",ticket_token:null,discount_checkout_state:"prepared",provider_ref:null,total_amount:180000});
    expect(rows[0].expires_at).toEqual(f.grant.due_at);
    expect(rows[0].checkout_request.returnUrl).toContain(result.registration_id);
    expect((await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(1);
    expect((await db.query("select type from public.transactional_email_jobs where registration_id=$1 order by type",[result.registration_id])).rows.map(r=>r.type))
      .toEqual(["pay_later_reminder_1d","pay_later_reminder_7d","pay_later_reserved"]);
    await reject(db,"update public.registrations set pay_later_due_at=pay_later_due_at+interval '1 day' where id=$1",[result.registration_id],"pay_later_identity_immutable");
  }));

  it("transfers an approved screening hold once and survives event admission-deadline edits", () => transaction(async db => {
    const f = await fixture(db,true);
    await reject(db,"select public.pay_later_reserve($1,$2,'fake','https://example.test')",[f.runner,f.request],"prescreening_approval_required");
    const review = await approve(db,f);
    expect((await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(1);
    const result = await reserve(db,f,{...f.request,prescreening_batch_id:review.batch});
    expect((await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(1);
    const batch = (await db.query("select status,pay_later_registration_id from public.prescreening_batches where id=$1",[review.batch])).rows[0];
    expect(batch).toEqual({status:"completed",pay_later_registration_id:result.registration_id});
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query("update public.events set registration_closes_at=now()-interval '1 hour' where id=$1",[f.event]);
    expect((await db.query("select expires_at from public.registrations where id=$1",[result.registration_id])).rows[0].expires_at).toEqual(f.grant.due_at);
    expect((await db.query("select public.prescreening_finish_expiry($1) as status",[review.batch])).rows[0].status).toBe("completed");
    const dispatched=(await db.query("select public.discount_claim_single($1,$2) as result",[f.runner,result.registration_id])).rows[0].result;
    expect(dispatched.action).toBe("dispatch");
  }));

  it("rolls back invalid add-ons and never gives a grant to a different runner or Passport", () => transaction(async db => {
    const f=await fixture(db);
    await reject(db,"select public.pay_later_reserve($1,$2,'fake','https://example.test')",[f.second,f.request],"pay_later_unavailable");
    await reject(db,"select public.pay_later_reserve($1,$2,'fake','https://example.test')",[f.runner,{...f.request,participant_passport_id:f.secondPassport}],"pay_later_self_only");
    await reject(db,"select public.pay_later_reserve($1,$2,'fake','https://example.test')",[f.runner,{...f.request,addon_ids:[randomUUID()]}],"invalid_addons");
    expect((await db.query("select registration_id from public.pay_later_grants where id=$1",[f.grant.id])).rows[0].registration_id).toBeNull();
    expect((await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(0);
  }));

  it("requires an active scoped approval and never reuses an unrelated batch", () => transaction(async db => {
    const f = await fixture(db, true);
    const review = await approve(db, f);
    await reject(db, "select public.pay_later_reserve($1,$2,'fake','https://example.test')",
      [f.runner, { ...f.request, prescreening_batch_id: randomUUID() }], "prescreening_approval_required");
    for (const decision of ["pending", "rejected"]) {
      await db.query("update public.prescreening_applications set decision=$2,reviewed_by_user_id=case when $2='pending' then null else $3::uuid end,reviewed_at=case when $2='pending' then null else now() end,rejection_reason=case when $2='rejected' then 'Test rejection' else null end,released_at=case when $2='rejected' then now() else null end where id=$1", [review.application, decision, f.admin]);
      await reject(db, "select public.pay_later_reserve($1,$2,'fake','https://example.test')",
        [f.runner, { ...f.request, prescreening_batch_id: review.batch }], "prescreening_approval_required");
    }
    await db.query("update public.prescreening_applications set decision='approved',released_at=null where id=$1", [review.application]);
    await db.query("update public.prescreening_batches set payment_deadline_at=now()-interval '1 minute' where id=$1", [review.batch]);
    await reject(db, "select public.pay_later_reserve($1,$2,'fake','https://example.test')",
      [f.runner, { ...f.request, prescreening_batch_id: review.batch }], "prescreening_approval_required");
  }));

  it("rejects another event's grant and expired eligibility without blocking ordinary checkout", () => transaction(async db => {
    const f = await fixture(db);
    const other = randomUUID();
    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Other','open')", [other, f.org]);
    await reject(db, "select public.pay_later_reserve($1,$2,'fake','https://example.test')",
      [f.runner, { ...f.request, event_id: other }], "pay_later_unavailable");
    await db.query("update public.pay_later_grants set due_date=current_date-1,due_at=current_date::timestamp at time zone 'Asia/Manila' where id=$1", [f.grant.id]);
    await reject(db, "select public.pay_later_reserve($1,$2,'fake','https://example.test')", [f.runner, f.request], "pay_later_unavailable");
    await db.query("insert into public.registrations(org_id,event_id,category_id,user_id,total_amount,status,expires_at,waiver_version_id,waiver_accepted_at,waiver_acceptance_method) values($1,$2,$3,$4,180000,'pending',now()+interval '1 hour',$5,now(),'signed_in_self')", [f.org,f.event,f.category,f.runner,f.waiver]);
    expect((await db.query("select pay_later_grant_id from public.registrations where event_id=$1", [f.event])).rows).toEqual([{pay_later_grant_id:null}]);
  }));

  it("skips missed reminder windows and keeps screening notifications with their own worker", () => transaction(async db => {
    const f=await fixture(db);
    await db.query("update public.pay_later_grants set due_date=(now() at time zone 'Asia/Manila')::date+2,due_at=((now() at time zone 'Asia/Manila')::date+3)::timestamp at time zone 'Asia/Manila' where id=$1", [f.grant.id]);
    const result=await reserve(db,f);
    expect((await db.query("select type from public.transactional_email_jobs where registration_id=$1 order by type",[result.registration_id])).rows.map(r=>r.type))
      .toEqual(["pay_later_reminder_1d","pay_later_reserved"]);
    await db.query("insert into public.transactional_email_jobs(type,user_id,event_id,dedup_key,payload) values('prescreening_ready',$1,$2,$3,'{}')",[f.runner,f.event,randomUUID()]);
    const claimed=(await db.query("select type from public.transactional_email_claim(50)")).rows.map(r=>r.type);
    expect(claimed).toContain("pay_later_granted");
    expect(claimed).toContain("pay_later_reserved");
    expect(claimed).not.toContain("prescreening_ready");
  }));

  it("preserves frozen fees and atomically snapshots only this event's add-ons", () => transaction(async db => {
    const f=await fixture(db), addon=randomUUID();
    await db.query("update public.organizations set fee_mode='pass_on',commission_type='fixed',commission_flat_cents=12000 where id=$1",[f.org]);
    await db.query("insert into public.addons(id,org_id,event_id,name,price) values($1,$2,$3,'Transport',25000)",[addon,f.org,f.event]);
    const result=await reserve(db,f,{...f.request,addon_ids:[addon]});
    const payment=(await db.query("select amount,checkout_platform_fee,checkout_provider_managed_fee,checkout_request from public.payments where registration_id=$1",[result.registration_id])).rows[0];
    expect(payment).toMatchObject({amount:217000,checkout_platform_fee:12000,checkout_provider_managed_fee:true});
    expect(payment.checkout_request.lineItems).toEqual([{name:"50K",amount:180000},{name:"Add-ons",amount:25000},{name:"Taxes and fees",amount:12000}]);
    expect((await db.query("select price from public.registration_addons where registration_id=$1",[result.registration_id])).rows).toEqual([{price:25000}]);
  }));
});

describe("Pay Later settlement and expiry", () => {
  it("settles timely capture once and issues the ordinary paid ticket", () => transaction(async db => {
    const f=await fixture(db), result=await reserve(db,f);
    const paid=(await db.query(confirmation,[result.registration_id,new Date()])).rows[0].result;
    expect(paid).toBe("paid");
    expect((await db.query(confirmation,[result.registration_id,new Date()])).rows[0].result).toBe("already");
    expect((await db.query("select status,ticket_token from public.registrations where id=$1",[result.registration_id])).rows[0])
      .toEqual({status:"paid",ticket_token:"test-ticket-token"});
    expect((await db.query("select slots_taken from public.categories where id=$1",[f.category])).rows[0].slots_taken).toBe(1);
  }));

  it("expires undispatched payments and never revives a released ticket", () => transaction(async db => {
    const f=await fixture(db), result=await reserve(db,f);
    await movePastDue(db,result.registration_id,f.grant.id);
    expect((await db.query("select public.discount_expire_prepared($1) as result",[result.registration_id])).rows[0].result).toBe("expired");
    expect((await db.query(confirmation,[result.registration_id,new Date(f.grant.due_at)])).rows[0].result).toBe("reservation_deadline_passed");
    expect((await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(0);
    expect((await db.query("select type from public.transactional_email_jobs where registration_id=$1 and type in ('pay_later_expired','payment_failed')",[result.registration_id])).rows)
      .toEqual([{type:"pay_later_expired"}]);
    await reject(db,"update public.registrations set status='paid' where id=$1",[result.registration_id],"pay_later_entry_terminal");
  }));

  it("keeps uncertain provider sessions held and accepts delayed notifications only for timely captures", () => transaction(async db => {
    const f=await fixture(db), result=await reserve(db,f);
    await db.query("select public.discount_claim_single($1,$2)",[f.runner,result.registration_id]);
    await movePastDue(db,result.registration_id,f.grant.id);
    expect((await db.query("select public.discount_expire_prepared($1) as result",[result.registration_id])).rows[0].result).toBe("provider_unresolved");
    expect((await db.query(confirmation,[result.registration_id,new Date()])).rows[0].result).toBe("reservation_deadline_passed");
    expect((await db.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(1);
    const due=(await db.query("select pay_later_due_at from public.registrations where id=$1",[result.registration_id])).rows[0].pay_later_due_at;
    expect((await db.query(confirmation,[result.registration_id,due])).rows[0].result).toBe("reservation_deadline_passed");
    expect((await db.query(confirmation,[result.registration_id,new Date(due.getTime()-1000)])).rows[0].result).toBe("paid");
  }));

  it("rejects the old unguarded settlement RPC for Pay Later and skips generic expiry reminders", () => transaction(async db => {
    const f=await fixture(db), result=await reserve(db,f);
    expect((await db.query("select public.confirm_payment_tx($1,'gcash',18000,162000,'token','{}') as result",[result.registration_id])).rows[0].result).toBe("reservation_deadline_passed");
    await db.query("select public.transactional_email_enqueue_expiring_payments()");
    expect((await db.query("select type from public.transactional_email_jobs where registration_id=$1 and type='payment_expiring'",[result.registration_id])).rows).toEqual([]);
  }));
});

 it("settles a fully discounted screened Pay Later entry through the guarded complimentary path", () => transaction(async db => {
   const f=await fixture(db,true), review=await approve(db,f);
   const result=await reserve(db,f,{...f.request,prescreening_batch_id:review.batch});
   await db.query("insert into public.discount_codes(org_id,code,kind,discount_type,value,coverage,created_by) values($1,'FREE','regular','percent',10000,'subtotal',$2)",[f.org,f.admin]);
   await db.query("select public.discount_apply($1,$2,'FREE')",[f.runner,result.registration_id]);
   const paid=(await db.query("select public.discount_confirm_free($1,$2,null,$3) as result",[f.runner,result.registration_id,{[result.registration_id]:"signed-complimentary-ticket-token"}])).rows[0].result;
   expect(paid).toBe("paid");
   expect((await db.query("select status,pay_later_grant_id from public.registrations where id=$1",[result.registration_id])).rows[0]).toEqual({status:"paid",pay_later_grant_id:f.grant.id});
 }));

it("serializes two runners claiming the final place and leaves no losing payment or email", async () => {
  const setup = new Client({connectionString:dbUrl});
  const left = new Client({connectionString:dbUrl});
  const right = new Client({connectionString:dbUrl});
  await Promise.all([setup.connect(),left.connect(),right.connect()]);
  let f: Fixture | undefined;
  try {
    await setup.query("begin");
    f=await fixture(setup);
    await actAs(setup,f.admin);
    const secondGrant=(await setup.query("select (public.pay_later_grant($1,$2)).*",[f.event,f.second])).rows[0];
    await setup.query("reset role");
    await setup.query("commit");
    const second={...f,runner:f.second,request:{...f.request,pay_later_grant_id:secondGrant.id,participant_passport_id:f.secondPassport,idempotency_key:randomUUID()}};
    const results=await Promise.allSettled([reserve(left,f),reserve(right,second)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const rejected=results.find(r=>r.status==="rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("category_capacity_exhausted");
    expect((await setup.query("select * from public.event_capacity_claims($1)",[f.event])).rows).toHaveLength(1);
    expect((await setup.query("select p.id from public.payments p join public.registrations r on r.id=p.registration_id where r.event_id=$1",[f.event])).rows).toHaveLength(1);
    expect((await setup.query("select id from public.transactional_email_jobs where event_id=$1 and type='pay_later_reserved'",[f.event])).rows).toHaveLength(1);
  } finally {
    await setup.query("rollback");
    if(f) {
      await setup.query("begin");
      await setup.query("update public.pay_later_grants set registration_id=null where event_id=$1",[f.event]);
      await setup.query("delete from public.registrations where event_id=$1",[f.event]);
      await setup.query("delete from public.pay_later_grants where event_id=$1",[f.event]);
      await setup.query("delete from public.events where id=$1",[f.event]);
      await setup.query("delete from public.organizer_waiver_versions where org_id=$1",[f.org]);
      await setup.query("delete from public.organizations where id=$1",[f.org]);
      await setup.query("delete from auth.users where id=any($1::uuid[])",[[f.runner,f.second,f.admin,f.editor,f.outsider]]);
      await setup.query("commit");
    }
    await Promise.all([setup.end(),left.end(),right.end()]);
  }
});

it("never issues a ticket or admits an unpaid Pay Later runner", () => transaction(async db => {
  const f=await fixture(db), result=await reserve(db,f);
  expect((await db.query("select ticket_token from public.registrations where id=$1",[result.registration_id])).rows[0].ticket_token).toBeNull();
  expect((await db.query("select public.checkin_record_tx($1,$2,$3) as result",[result.registration_id,f.event,f.admin])).rows[0].result).toEqual({error:"not_paid"});
  expect((await db.query("select id from public.checkins where registration_id=$1",[result.registration_id])).rows).toEqual([]);
}));

it("reserves through authenticated checkout and permits payment after admission closes", async () => {
  const db=new Client({connectionString:dbUrl});
  await db.connect();
  let f: Fixture | undefined;
  try {
    const service=createClient(url,serviceKey,{auth:{persistSession:false}});
    const runner=createClient(url,anonKey,{auth:{persistSession:false}});
    const email=`pay-later-${randomUUID()}@test.invalid`, password="test-password-123";
    const created=await service.auth.admin.createUser({email,password,email_confirm:true});
    if(created.error) throw created.error;
    await db.query("begin");
    f=await fixture(db,false,created.data.user.id);
    await db.query("commit");
    const signedIn=await runner.auth.signInWithPassword({email,password});
    if(signedIn.error) throw signedIn.error;
    const headers={Authorization:`Bearer ${signedIn.data.session!.access_token}`,apikey:anonKey,"Content-Type":"application/json"};
    const checkout=await fetch(url+"/functions/v1/registrations-checkout",{method:"POST",headers,body:JSON.stringify({...f.request,return_url:"https://example.test/callback"})});
    const reserved=await checkout.json();
    expect({status:checkout.status,body:reserved}).toMatchObject({status:200,body:{payment_plan:"pay_later",checkout_url:null,status:"pending"}});
    const repeated=await fetch(url+"/functions/v1/registrations-checkout",{method:"POST",headers,body:JSON.stringify(f.request)});
    expect({status:repeated.status,body:await repeated.json()}).toMatchObject({status:409,body:{error:"already_registered",payment_plan:"pay_later",registration_id:reserved.registration_id}});
    await db.query("select set_config('request.jwt.claim.role','service_role',false)");
    await db.query("update public.events set registration_closes_at=now()-interval '1 hour' where id=$1",[f.event]);
    const payment=await fetch(url+"/functions/v1/payment-session",{method:"POST",headers,body:JSON.stringify({registration_id:reserved.registration_id,method:"gcash",return_url:"https://example.test/callback"})});
    const paymentBody=await payment.json();
    expect({status:payment.status,body:paymentBody}).toMatchObject({status:200,body:{checkout_url:expect.stringContaining("fake-checkout")}});
    expect((await db.query("select ticket_token from public.registrations where id=$1",[reserved.registration_id])).rows[0].ticket_token).toBeNull();
  } finally {
    await db.query("rollback");
    if(f) {
      await db.query("begin");
      await db.query("update public.pay_later_grants set registration_id=null where event_id=$1",[f.event]);
      await db.query("delete from public.registrations where event_id=$1",[f.event]);
      await db.query("delete from public.pay_later_grants where event_id=$1",[f.event]);
      await db.query("delete from public.events where id=$1",[f.event]);
      await db.query("delete from public.organizer_waiver_versions where org_id=$1",[f.org]);
      await db.query("delete from public.organizations where id=$1",[f.org]);
      await db.query("delete from auth.users where id=any($1::uuid[])",[[f.runner,f.second,f.admin,f.editor,f.outsider]]);
      await db.query("commit");
    }
    await db.end();
  }
});
