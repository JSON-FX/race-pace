import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { formatPersonName } from "../../packages/shared/src/passport";
import { loadEnv } from "../../test/env";

const { dbUrl } = loadEnv();

async function transaction(run: (db: Client) => Promise<void>) {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  await db.query("begin");
  try { await run(db); } finally { await db.query("rollback"); await db.end(); }
}

async function fixture(db: Client) {
  const user = randomUUID(), org = randomUUID(), event = randomUUID(), category = randomUUID();
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
    [user, `${user}@test.invalid`, { full_name: "GOOGLE RUNNER" }]);
  await db.query("insert into public.organizations(id,name,slug) values($1,'Name QA',$2)", [org, org]);
  await db.query("insert into public.events(id,org_id,name) values($1,$2,'Name QA')", [event, org]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'10k','10K',0,100)", [category, org, event]);
  const passport = (await db.query("select id from public.runner_passports where claimed_user_id=$1", [user])).rows[0].id as string;
  return { user, org, event, category, passport };
}

async function labels(db: Client, f: Awaited<ReturnType<typeof fixture>>) {
  const reservation = randomUUID(), batch = randomUUID();
  await db.query(`insert into public.event_reservations(id,org_id,event_id,user_id,email,idempotency_key,status,
    reservation_fee_cents,platform_fee_cents,registration_deadline_at,checkout_expires_at)
    values($1,$2,$3,$4,'EMAIL@example.com',$1,'expired',10000,0,now(),now())`, [reservation, f.org, f.event, f.user]);
  await db.query(`insert into public.event_reservation_places(org_id,event_id,reservation_id,participant_passport_id,participant_name,is_managed,status)
    values($1,$2,$3,$4,'BERNADETTE CUTAMORA',false,'expired')`, [f.org, f.event, reservation, f.passport]);
  await db.query(`insert into public.prescreening_batches(id,org_id,event_id,booked_by_user_id,idempotency_key,checkout_intent,request_snapshot)
    values($1,$2,$3,$4,$1,'entry','{}')`, [batch, f.org, f.event, f.user]);
  await db.query(`insert into public.prescreening_applications(batch_id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,
    participant_name,is_managed,screening_required,decision) values($1,$2,$3,$4,$5,$6,'ERNESTO TAGUD',false,false,'not_required')`,
    [batch, f.org, f.event, f.category, f.passport, f.user]);
}

describe("runner name casing at storage boundaries", () => {
  it("matches the client formatter for punctuation, Unicode, whitespace and suffixes", () => transaction(async db => {
    const names = ["SHEEN KIERBY JOVEN BORNEA", "BERNADETTE CUTAMORA", "ANTONIO JR. JAMAGO", "ANA-MARIE O’NEILL III",
      "JOSE\u0301 D'ANGELO IV.", "j. p. DE LA CRUZ", "李 小龍", "  aNa\tMARIE\ncruz  ", "", " ", "HENRY VIII", "O'III", "İPEK", "ßETA", "ÑANDÚ MUÑOZ", "\ufeffANA MARIE\ufeff", "\u00a0ANA\u00a0MARIE\u00a0"];
    for (const name of names) {
      const expected = formatPersonName(name);
      const result = await db.query("select public.person_name_title_case($1) as name, public.person_name_title_case(public.person_name_title_case($1)) as again", [name]);
      expect(result.rows[0], name).toEqual({ name: expected, again: expected });
    }
    expect((await db.query("select public.person_name_title_case(null) as name")).rows[0].name).toBeNull();
  }));

  it("enforces authenticated profile/Passport writes and preserves ownership and unrelated fields", () => transaction(async db => {
    const f = await fixture(db);
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [f.user]);
    await db.query("insert into public.profiles(id,full_name,bib_name) values($1,'ERNESTO TAGUD','MY BIB')", [f.user]);
    expect((await db.query("select full_name,bib_name from public.profiles where id=$1", [f.user])).rows[0])
      .toEqual({ full_name: "Ernesto Tagud", bib_name: "MY BIB" });
    await db.query("update public.profiles set full_name='BERNADETTE CUTAMORA' where id=$1", [f.user]);
    expect((await db.query("select full_name from public.profiles where id=$1", [f.user])).rows[0].full_name).toBe("Bernadette Cutamora");
    await db.query("update public.runner_passports set first_name='ANA-MARIE',last_name='O’NEILL III',team_name='TEAM ABC' where id=$1", [f.passport]);
    expect((await db.query("select first_name,last_name,team_name from public.runner_passports where id=$1", [f.passport])).rows[0])
      .toEqual({ first_name: "Ana-Marie", last_name: "O’Neill III", team_name: "TEAM ABC" });
    expect((await db.query("select full_name,bib_name from public.profiles where id=$1", [f.user])).rows[0])
      .toEqual({ full_name: "Ana-Marie O’Neill III", bib_name: "MY BIB" });
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [randomUUID()]);
    expect((await db.query("update public.runner_passports set first_name='FORGED' where id=$1 returning id", [f.passport])).rows).toEqual([]);
  }));

  it("normalizes registration snapshots and stored participant labels on insert and update", () => transaction(async db => {
    const f = await fixture(db);
    const untouched = { bib_name: "ALL CAPS", team_name: "TEAM ABC", participant_email: "EMAIL@example.com", waiver_acceptance: { accepting_name: "ALL CAPS" }, other: [1, "KEEP"] };
    const row = (await db.query(`insert into public.registrations(org_id,event_id,category_id,user_id,total_amount,custom_data)
      values($1,$2,$3,$4,12345,$5) returning id,custom_data,total_amount`, [f.org, f.event, f.category, f.user,
      { ...untouched, full_name: "SHEEN KIERBY JOVEN BORNEA", first_name: "SHEEN KIERBY JOVEN", last_name: "BORNEA" }])).rows[0];
    expect(row.custom_data).toEqual({ ...untouched, full_name: "Sheen Kierby Joven Bornea", first_name: "Sheen Kierby Joven", last_name: "Bornea" });
    expect(row.total_amount).toBe(12345);
    const updated = (await db.query("update public.registrations set custom_data=$2 where id=$1 returning custom_data", [row.id, { full_name: "ERNESTO TAGUD", first_name: null, last_name: 42, ...untouched }])).rows[0];
    expect(updated.custom_data).toEqual({ full_name: "Ernesto Tagud", first_name: null, last_name: 42, ...untouched });
    await labels(db, f);
    expect((await db.query("select participant_name from public.event_reservation_places where participant_passport_id=$1", [f.passport])).rows[0].participant_name).toBe("Bernadette Cutamora");
    expect((await db.query("update public.prescreening_applications set participant_name='ANA-MARIE O’NEILL III' where participant_passport_id=$1 returning participant_name", [f.passport])).rows[0].participant_name).toBe("Ana-Marie O’Neill III");
  }));

  it("repairs existing rows repeatably without erasing legacy names or changing other profile/snapshot data", () => transaction(async db => {
    const f = await fixture(db), legacy = await fixture(db);
    for (const table of ["profiles", "runner_passports", "event_reservation_places", "prescreening_applications"]) {
      await db.query(`alter table public.${table} disable trigger normalize_runner_names`);
    }
    await db.query("alter table public.registrations disable trigger zzz_normalize_runner_names");
    await db.query("alter table public.runner_passports disable trigger passport_sync_self_profile");
    await db.query("insert into public.profiles(id,full_name,bib_name,date_of_birth) values($1,'BERNADETTE CUTAMORA','KEEP BIB','1980-01-01'),($2,'ERNESTO TAGUD','LEGACY BIB','1970-01-01')", [f.user, legacy.user]);
    await db.query("update public.runner_passports set first_name='BERNADETTE',last_name='CUTAMORA',legacy_full_name='OLD NAME',team_name='TEAM ABC' where id=$1", [f.passport]);
    await db.query("update public.runner_passports set legacy_full_name='ERNESTO TAGUD' where id=$1", [legacy.passport]);
    const registration = (await db.query(`insert into public.registrations(org_id,event_id,category_id,user_id,total_amount,custom_data)
      values($1,$2,$3,$4,45678,$5) returning id`, [f.org, f.event, f.category, f.user,
      { full_name: "BERNADETTE CUTAMORA", bib_name: "KEEP BIB", waiver_acceptance: { accepting_name: "ALL CAPS" } }])).rows[0].id;
    await labels(db, f);
    for (const table of ["profiles", "runner_passports", "event_reservation_places", "prescreening_applications"]) {
      await db.query(`alter table public.${table} enable trigger normalize_runner_names`);
    }
    await db.query("alter table public.registrations enable trigger zzz_normalize_runner_names");
    await db.query("alter table public.runner_passports enable trigger passport_sync_self_profile");
    const before = (await db.query("select custom_data-'full_name' as evidence,waiver_acceptance,total_amount from public.registrations where id=$1", [registration])).rows[0];
    const migration = readFileSync(new URL("../migrations/20261102143802_runner_name_title_case.sql", import.meta.url), "utf8");
    const repair = migration.slice(migration.indexOf("alter table public.runner_passports disable trigger passport_sync_self_profile;"));
    for (let i = 0; i < 2; i++) await db.query(repair);
    expect((await db.query("select full_name,bib_name,date_of_birth::text from public.profiles where id=$1", [f.user])).rows[0])
      .toEqual({ full_name: "Bernadette Cutamora", bib_name: "KEEP BIB", date_of_birth: "1980-01-01" });
    expect((await db.query("select full_name,bib_name,date_of_birth::text from public.profiles where id=$1", [legacy.user])).rows[0])
      .toEqual({ full_name: "Ernesto Tagud", bib_name: "LEGACY BIB", date_of_birth: "1970-01-01" });
    expect((await db.query("select first_name,last_name,legacy_full_name from public.runner_passports where id=$1", [legacy.passport])).rows[0])
      .toEqual({ first_name: null, last_name: null, legacy_full_name: "Ernesto Tagud" });
    expect((await db.query("select custom_data-'full_name' as evidence,waiver_acceptance,total_amount from public.registrations where id=$1", [registration])).rows[0]).toEqual(before);
    expect((await db.query("select custom_data->>'full_name' as name from public.registrations where id=$1", [registration])).rows[0].name).toBe("Bernadette Cutamora");
    expect((await db.query("select participant_name from public.event_reservation_places where participant_passport_id=$1", [f.passport])).rows[0].participant_name).toBe("Bernadette Cutamora");
    expect((await db.query("select participant_name from public.prescreening_applications where participant_passport_id=$1", [f.passport])).rows[0].participant_name).toBe("Ernesto Tagud");
    expect((await db.query("select raw_user_meta_data->>'full_name' as name from auth.users where id=$1", [f.user])).rows[0].name).toBe("GOOGLE RUNNER");
    expect((await db.query("select tgenabled from pg_trigger where tgrelid='public.runner_passports'::regclass and tgname='passport_sync_self_profile'")).rows[0].tgenabled).toBe("O");
  }));
});
