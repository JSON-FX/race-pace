import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const dbUrl = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

describe("coming soon reservation lifecycle", () => {
  it("replays and converts a paid legacy one-place header without child rows", async () => {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    await db.query("begin");
    try {
      const user = randomUUID();
      const org = randomUUID();
      const event = randomUUID();
      const key = randomUUID();
      const slug = `legacy-place-${randomUUID().slice(0, 8)}`;
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
        [user, `${user}@test.invalid`]);
      await db.query("insert into public.organizations(id,name,slug) values($1,'Legacy place',$2)", [org, slug]);
      await db.query(`insert into public.events(id,org_id,name,slug,status,discipline,hero_image_url,
        description,coming_soon_reserve_enabled,reservation_fee_cents,reservation_deadline_at,total_event_slots)
        values($1,$2,'Legacy place',$3,'coming_soon','trail','https://example.test/hero.jpg',
        'A legacy early place',true,500,now()+interval '10 days',1)`, [event, org, slug]);
      const passport = (await db.query<{ id: string }>(
        "select id from public.runner_passports where claimed_user_id=$1", [user],
      )).rows[0]!.id;
      const header = (await db.query<{ id: string }>(
        `insert into public.event_reservations(org_id,event_id,user_id,email,idempotency_key,
          reservation_fee_cents,platform_fee_cents,registration_deadline_at,checkout_expires_at)
          values($1,$2,$3,$4,$5,500,0,now()+interval '10 days',now()+interval '1 day') returning id`,
        [org, event, user, `${user}@test.invalid`, key],
      )).rows[0]!.id;
      await db.query(`insert into public.reservation_payments(org_id,event_id,reservation_id,provider,
        provider_ref,amount_cents,platform_fee_cents) values($1,$2,$3,'fake','cs_legacy',500,0)`, [org, event, header]);
      await db.query("set local role service_role");
      expect((await db.query<{ reserve_event_passports: string }>(
        "select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [event, user, key, [passport]],
      )).rows[0]!.reserve_event_passports).toBe(header);
      await db.query("reset role");
      expect((await db.query<{ count: string }>(
        "select count(*) from public.event_reservation_places where reservation_id=$1", [header],
      )).rows[0]?.count).toBe("0");
      expect((await db.query<{ confirm_reservation_payment: string }>(
        `select public.confirm_reservation_payment($1,'cs_legacy',$2,515,15,500,'gcash','{}'::jsonb)`,
        [header, `pay_${randomUUID().replaceAll("-", "")}`],
      )).rows[0]?.confirm_reservation_payment).toBe("paid");
      const category = (await db.query<{ id: string }>(
        "insert into public.categories(org_id,event_id,code,label,base_price,slots_total) values($1,$2,'trail','Trail',1000,1) returning id",
        [org, event],
      )).rows[0]!.id;
      await db.query("select set_config('request.jwt.claim.role','service_role',true)");
      await db.query("update public.events set status='open' where id=$1", [event]);
      const registration = (await db.query<{ id: string; event_reservation_id: string }>(
        `insert into public.registrations(org_id,event_id,category_id,user_id,booked_by_user_id,
          participant_passport_id,status,total_amount) values($1,$2,$3,$4,$4,$5,'pending',1000)
          returning id,event_reservation_id`, [org, event, category, user, passport],
      )).rows[0]!;
      expect(registration.event_reservation_id).toBe(header);
      await db.query("update public.registrations set status='paid' where id=$1", [registration.id]);
      expect((await db.query<{ status: string }>(
        "select status from public.event_reservations where id=$1", [header],
      )).rows[0]?.status).toBe("converted");
    } finally {
      await db.query("rollback");
      await db.end();
    }
  });
  it("holds two Passports in one checkout and redeems or expires each place separately", async () => {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    await db.query("begin");
    try {
      const booker = randomUUID();
      const outsider = randomUUID();
      const orgId = randomUUID();
      const eventId = randomUUID();
      const managed = randomUUID();
      const key = randomUUID();
      const slug = `passport-reservation-${randomUUID().slice(0, 8)}`;
      await db.query(`insert into auth.users(id,email,email_confirmed_at) values
        ($1,$3,now()),($2,$4,now())`, [booker, outsider, `${booker}@test.invalid`, `${outsider}@test.invalid`]);
      await db.query(`insert into public.organizations(id,name,slug,reservation_commission_flat_cents)
        values($1,'Passport reservation test',$2,15)`, [orgId, slug]);
      await db.query(`insert into public.events(id,org_id,name,slug,status,discipline,hero_image_url,
        description,coming_soon_reserve_enabled,reservation_fee_cents,reservation_deadline_at,total_event_slots)
        values($1,$2,'Passport reservation test',$3,'coming_soon','trail',
          'https://example.test/hero.jpg','An upcoming event',true,500,now()+interval '10 days',2)`, [eventId, orgId, slug]);
      const self = (await db.query<{ id: string }>(
        "select id from public.runner_passports where claimed_user_id=$1", [booker],
      )).rows[0]!.id;
      await db.query(`insert into public.runner_passports(id,created_by_user_id,first_name,last_name)
        values($1,$2,'Managed','Runner')`, [managed, booker]);
      await db.query("insert into public.passport_managers(passport_id,user_id) values($1,$2)", [managed, booker]);
      expect((await db.query<{ allowed: boolean }>(`select
        has_function_privilege('service_role','public.reserve_event_passports(uuid,uuid,uuid,text,uuid[])','EXECUTE')
        and not has_function_privilege('authenticated','public.reserve_event_passports(uuid,uuid,uuid,text,uuid[])','EXECUTE')
        as allowed`)).rows[0]?.allowed).toBe(true);
      await db.query("set local role service_role");
      await db.query("savepoint inaccessible");
      await expect(db.query("select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [eventId, outsider, randomUUID(), [managed]])).rejects.toMatchObject({ message: "participant_not_accessible" });
      await db.query("rollback to savepoint inaccessible");
      await db.query("savepoint duplicate");
      await expect(db.query("select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [eventId, booker, randomUUID(), [self, self]])).rejects.toMatchObject({ message: "invalid_passports" });
      await db.query("rollback to savepoint duplicate");
      const held = (await db.query<{ reserve_event_passports: string }>(
        "select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [eventId, booker, key, [self, managed]],
      )).rows[0]!.reserve_event_passports;
      expect((await db.query<{ reserve_event_passports: string }>(
        "select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [eventId, booker, key, [managed, self]],
      )).rows[0]!.reserve_event_passports).toBe(held);
      await db.query("savepoint key_conflict");
      await expect(db.query("select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [eventId, booker, key, [self]])).rejects.toMatchObject({ message: "idempotency_conflict" });
      await db.query("rollback to savepoint key_conflict");
      await db.query("savepoint already_reserved");
      await expect(db.query("select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [eventId, booker, randomUUID(), [managed]])).rejects.toMatchObject({ message: "participant_already_reserved" });
      await db.query("rollback to savepoint already_reserved");
      await db.query("savepoint capacity");
      const outsiderSelf = (await db.query<{ id: string }>(
        "select id from public.runner_passports where claimed_user_id=$1", [outsider],
      )).rows[0]!.id;
      await expect(db.query("select public.reserve_event_passports($1,$2,$3,'fake',$4::uuid[])",
        [eventId, outsider, randomUUID(), [outsiderSelf]])).rejects.toMatchObject({ message: "event_capacity_exhausted" });
      await db.query("rollback to savepoint capacity");
      await db.query("reset role");
      const header = (await db.query<{ quantity: number; reservation_fee_cents: number; platform_fee_cents: number }>(
        "select quantity,reservation_fee_cents,platform_fee_cents from public.event_reservations where id=$1", [held],
      )).rows[0];
      expect(header).toMatchObject({ quantity: 2, reservation_fee_cents: 500, platform_fee_cents: 15 });
      expect((await db.query<{ amount_cents: number; platform_fee_cents: number }>(
        "select amount_cents,platform_fee_cents from public.reservation_payments where reservation_id=$1", [held],
      )).rows[0]).toMatchObject({ amount_cents: 1030, platform_fee_cents: 30 });
      const places = await db.query<{ participant_name: string; is_managed: boolean }>(
        "select participant_name,is_managed from public.event_reservation_places where reservation_id=$1 order by is_managed", [held],
      );
      expect(places.rows).toEqual([
        { participant_name: "My Race Passport", is_managed: false },
        { participant_name: "Managed Runner", is_managed: true },
      ]);
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [booker]);
      expect((await db.query<{ count: string }>(
        "select count(*) from public.event_reservation_places where reservation_id=$1", [held],
      )).rows[0]?.count).toBe("2");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [outsider]);
      expect((await db.query<{ count: string }>(
        "select count(*) from public.event_reservation_places where reservation_id=$1", [held],
      )).rows[0]?.count).toBe("0");
      await db.query("reset role");
      await db.query("update public.reservation_payments set provider_ref='group-test' where reservation_id=$1", [held]);
      await db.query("savepoint wrong_group_capture");
      expect((await db.query<{ confirm_reservation_payment: string }>(
        `select public.confirm_reservation_payment($1,'group-test',$2,1059,30,1029,'qrph','{}'::jsonb)`,
        [held, `pay_${randomUUID().replaceAll("-", "")}`],
      )).rows[0]?.confirm_reservation_payment).toBe("review_required");
      await db.query("rollback to savepoint wrong_group_capture");
      expect((await db.query<{ confirm_reservation_payment: string }>(
        `select public.confirm_reservation_payment($1,'group-test',$2,1060,30,1030,'qrph','{}'::jsonb)`,
        [held, `pay_${randomUUID().replaceAll("-", "")}`],
      )).rows[0]?.confirm_reservation_payment).toBe("paid");
      expect((await db.query<{ net_to_org_cents: number }>(
        "select net_to_org_cents from public.reservation_payments where reservation_id=$1", [held],
      )).rows[0]?.net_to_org_cents).toBe(1000);
      const waiver = (await db.query<{ id: string }>(
        "insert into public.organizer_waiver_versions(org_id,title,body) values($1,'Test waiver','Test text') returning id", [orgId],
      )).rows[0]!.id;
      const category = (await db.query<{ id: string }>(
        "insert into public.categories(org_id,event_id,code,label,base_price,slots_total) values($1,$2,'trail','Trail',1000,2) returning id",
        [orgId, eventId],
      )).rows[0]!.id;
      await db.query("select set_config('request.jwt.claim.role','service_role',true)");
      await db.query("update public.events set status='open',waiver_version_id=$2 where id=$1", [eventId, waiver]);
      const order = (await db.query<{ id: string }>(
        `insert into public.booking_orders(org_id,event_id,category_id,booked_by_user_id,idempotency_key,
          status,expires_at,entry_total_cents) values($1,$2,$3,$4,$5,'pending',now()+interval '1 day',1000)
          returning id`, [orgId, eventId, category, booker, randomUUID()],
      )).rows[0]!.id;
      await db.query("insert into public.passport_managers(passport_id,user_id) values($1,$2)", [managed, outsider]);
      await db.query("savepoint other_booker_entry");
      await expect(db.query(`insert into public.registrations(org_id,event_id,category_id,user_id,
        booked_by_user_id,participant_passport_id,status,total_amount,waiver_version_id,waiver_acceptance_method)
        values($1,$2,$3,null,$4,$5,'pending',1000,$6,'participant_on_helper_device')`,
      [orgId, eventId, category, outsider, managed, waiver])).rejects.toMatchObject({ message: "participant_already_reserved" });
      await db.query("rollback to savepoint other_booker_entry");
      const managedEntry = (await db.query<{ id: string; event_reservation_id: string }>(
        `insert into public.registrations(org_id,event_id,category_id,user_id,booked_by_user_id,
          participant_passport_id,booking_order_id,status,total_amount,waiver_version_id,waiver_acceptance_method)
          values($1,$2,$3,null,$4,$5,$7,'pending',1000,$6,'participant_on_helper_device')
          returning id,event_reservation_id`, [orgId, eventId, category, booker, managed, waiver, order],
      )).rows[0]!;
      expect(managedEntry.event_reservation_id).toBe(held);
      const attempt = (await db.query<{ id: string }>(
        `insert into public.booking_payment_attempts(org_id,booking_order_id,booked_by_user_id,
          idempotency_key,method,status,terms_snapshot,base_cents,platform_fee_cents,
          processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
          values($1,$2,$3,$4,'card','ready','{"provider_managed_fee":false}'::jsonb,
            1000,0,0,1000,20,980) returning id`, [orgId, order, booker, randomUUID()],
      )).rows[0]!.id;
      await db.query(`insert into public.booking_payment_quote_lines(attempt_id,org_id,registration_id,
        base_cents,platform_fee_cents,processor_surcharge_cents,gross_cents,
        processor_fee_predicted_cents,net_to_org_predicted_cents)
        values($1,$2,$3,1000,0,0,1000,20,980)`, [attempt, orgId, managedEntry.id]);
      await db.query(`insert into public.booking_payment_dispatches(attempt_id,org_id,request_body,
        livemode,state,session_id,checkout_url)
        values($1,$2,'{}'::jsonb,false,'ready','cs_groupreservationtest',
          'https://checkout.paymongo.com/test')`, [attempt, orgId]);
      const capture = {
        paymentId: `pay_${randomUUID().replaceAll("-", "")}`,
        sessionId: "cs_groupreservationtest", attemptId: attempt, orderId: order,
        currency: "PHP", livemode: false, amount: 1000, feeCents: 20,
      };
      const tokens = { [managedEntry.id]: "signed-test-token-1234567890" };
      await db.query("savepoint missing_group_paid_at");
      expect((await db.query<{ booking_payment_confirm: string }>(
        "select public.booking_payment_confirm($1,$2::jsonb,$3::jsonb)",
        [attempt, JSON.stringify(capture), JSON.stringify(tokens)],
      )).rows[0]?.booking_payment_confirm).toBe("reconciliation_required");
      expect((await db.query<{ reason: string }>(
        "select reason from public.booking_payment_captures where payment_id=$1", [capture.paymentId],
      )).rows[0]?.reason).toBe("reservation_capture_time_missing");
      await db.query("rollback to savepoint missing_group_paid_at");
      await db.query("savepoint late_group_paid_at");
      expect((await db.query<{ booking_payment_confirm: string }>(
        "select public.booking_payment_confirm($1,$2::jsonb,$3::jsonb)",
        [attempt, JSON.stringify({ ...capture, paidAt: new Date(Date.now() + 30 * 86400000).toISOString() }), JSON.stringify(tokens)],
      )).rows[0]?.booking_payment_confirm).toBe("reconciliation_required");
      expect((await db.query<{ reason: string }>(
        "select reason from public.booking_payment_captures where payment_id=$1", [capture.paymentId],
      )).rows[0]?.reason).toBe("reservation_deadline_passed");
      await db.query("rollback to savepoint late_group_paid_at");
      expect((await db.query<{ booking_payment_confirm: string }>(
        "select public.booking_payment_confirm($1,$2::jsonb,$3::jsonb)",
        [attempt, JSON.stringify({ ...capture, paidAt: new Date().toISOString() }), JSON.stringify(tokens)],
      )).rows[0]?.booking_payment_confirm).toBe("fulfilled");
      expect((await db.query<{ status: string }>(
        "select status from public.event_reservations where id=$1", [held],
      )).rows[0]?.status).toBe("paid");
      expect((await db.query<{ status: string }>(
        "select status from public.event_reservation_places where reservation_id=$1 and participant_passport_id=$2",
        [held, managed],
      )).rows[0]?.status).toBe("converted");
      await db.query("update public.event_reservations set registration_deadline_at=now()-interval '1 minute' where id=$1", [held]);
      expect((await db.query<{ expire_event_reservation: string }>(
        "select public.expire_event_reservation($1)", [held],
      )).rows[0]?.expire_event_reservation).toBe("expired");
      expect((await db.query<{ status: string }>(
        "select status from public.event_reservation_places where reservation_id=$1 and participant_passport_id=$2",
        [held, self],
      )).rows[0]?.status).toBe("expired");
      expect((await db.query<{ status: string }>(
        "select status from public.event_reservations where id=$1", [held],
      )).rows[0]?.status).toBe("converted");
    } finally {
      await db.query("rollback");
      await db.end();
    }
  });
  it("serializes two simultaneous holds against the event's one place", async () => {
    const firstDb = new Client({ connectionString: dbUrl });
    const secondDb = new Client({ connectionString: dbUrl });
    await Promise.all([firstDb.connect(), secondDb.connect()]);
    const orgId = randomUUID();
    const eventId = randomUUID();
    const runnerIds = [randomUUID(), randomUUID()];
    const slug = `reservation-race-${randomUUID().slice(0, 8)}`;
    try {
      await firstDb.query("begin");
      await firstDb.query("insert into auth.users(id,email,email_confirmed_at) values($1,$3,now()),($2,$4,now())",
        [runnerIds[0], runnerIds[1], `${runnerIds[0]}@test.invalid`, `${runnerIds[1]}@test.invalid`]);
      await firstDb.query("insert into public.organizations(id,name,slug) values($1,'Capacity test',$2)", [orgId, slug]);
      await firstDb.query(`insert into public.events(id,org_id,name,slug,status,discipline,hero_image_url,description,
        coming_soon_reserve_enabled,reservation_fee_cents,reservation_deadline_at,total_event_slots)
        values($1,$2,'Capacity test',$3,'coming_soon','trail','https://example.test/hero.jpg',
        'An upcoming trail event',true,500,now()+interval '10 days',1)`, [eventId, orgId, slug]);
      await firstDb.query("commit");

      await firstDb.query("begin");
      await secondDb.query("begin");
      await firstDb.query("set local role service_role");
      await secondDb.query("set local role service_role");
      await firstDb.query("select public.reserve_event_place($1,$2,$3,'fake')",
        [eventId, runnerIds[0], randomUUID()]);
      // This call waits on the event row held by firstDb. Its own count must
      // run after the first reservation commits, under a fresh snapshot.
      const competing = secondDb.query("select public.reserve_event_place($1,$2,$3,'fake')",
        [eventId, runnerIds[1], randomUUID()]).then(() => null, (error: Error) => error);
      await firstDb.query("commit");
      expect(await competing).toMatchObject({ message: "event_capacity_exhausted" });
      await secondDb.query("rollback");
      const count = await firstDb.query<{ count: string }>(
        "select count(*) from public.event_reservations where event_id=$1 and status='pending'", [eventId]);
      expect(count.rows[0]!.count).toBe("1");
    } finally {
      await Promise.all([firstDb.query("rollback").catch(() => null), secondDb.query("rollback").catch(() => null)]);
      await firstDb.query("begin");
      await firstDb.query("delete from public.reservation_payments where event_id=$1", [eventId]);
      await firstDb.query("delete from public.event_reservation_places where event_id=$1", [eventId]);
      await firstDb.query("delete from public.event_reservations where event_id=$1", [eventId]);
      await firstDb.query("delete from public.events where id=$1", [eventId]);
      await firstDb.query("delete from public.organizations where id=$1", [orgId]);
      await firstDb.query("delete from auth.users where id=any($1::uuid[])", [runnerIds]);
      await firstDb.query("commit");
      await Promise.all([firstDb.end(), secondDb.end()]);
    }
  });

  it("holds one event place, itemizes the separate charge, converts on entry, and settles its own payout", async () => {
    const db = new Client({ connectionString: dbUrl });
    await db.connect();
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claim.role','service_role',true)");
      const orgId = randomUUID();
      const eventId = randomUUID();
      const first = randomUUID();
      const second = randomUUID();
      const slug = `coming-soon-${randomUUID().slice(0, 8)}`;
      await db.query(`insert into auth.users(id,email,email_confirmed_at) values
        ($1,$3,now()),($2,$4,now())`, [first, second, `${first}@test.invalid`, `${second}@test.invalid`]);
      await db.query(`insert into public.organizations(id,name,slug,reservation_commission_flat_cents)
        values ($1,'Reservation test',$2,15)`, [orgId, slug]);
      await db.query(`insert into public.events(
        id,org_id,name,slug,status,discipline,hero_image_url,description,
        coming_soon_notify_enabled,coming_soon_reserve_enabled,reservation_fee_cents,
        reservation_deadline_at,total_event_slots
      ) values ($1,$2,'Test trail',$3,'coming_soon','trail','https://example.test/hero.jpg',
        'An upcoming trail event',true,true,500,now()+interval '10 days',1)`, [eventId, orgId, slug]);
      const held = await db.query<{ reserve_event_place: string }>(
        `select public.reserve_event_place($1,$2,$3,'fake')`, [eventId, first, randomUUID()],
      );
      const reservationId = held.rows[0]!.reserve_event_place;
      await db.query("savepoint capacity_check");
      await expect(db.query(`select public.reserve_event_place($1,$2,$3,'fake')`,
        [eventId, second, randomUUID()])).rejects.toMatchObject({ message: "event_capacity_exhausted" });
      await db.query("rollback to savepoint capacity_check");
      const charge = await db.query<{ reservation_fee_cents: number; platform_fee_cents: number }>(
        "select reservation_fee_cents,platform_fee_cents from public.event_reservations where id=$1", [reservationId],
      );
      expect(charge.rows[0]).toMatchObject({ reservation_fee_cents: 500, platform_fee_cents: 15 });
      await db.query("update public.reservation_payments set provider_ref=$2 where reservation_id=$1", [reservationId, `cs_${randomUUID()}`]);
      await db.query("savepoint invalid_capture");
      const invalid = await db.query<{ confirm_reservation_payment: string }>(
        `select public.confirm_reservation_payment($1,(select provider_ref from public.reservation_payments where reservation_id=$1),$2,535,-1,536,'gcash','{}'::jsonb)`,
        [reservationId, `pay_${randomUUID().replaceAll("-", "")}`],
      );
      expect(invalid.rows[0]?.confirm_reservation_payment).toBe("review_required");
      await db.query("rollback to savepoint invalid_capture");
      const confirmed = await db.query<{ confirm_reservation_payment: string }>(
        `select public.confirm_reservation_payment($1,(select provider_ref from public.reservation_payments where reservation_id=$1),$2,535,20,515,'gcash','{}'::jsonb)`,
        [reservationId, `pay_${randomUUID().replaceAll("-", "")}`],
      );
      expect(confirmed.rows[0]?.confirm_reservation_payment).toBe("paid");
      const money = await db.query<{ amount_cents: number; processor_fee_cents: number; platform_fee_cents: number; net_to_org_cents: number }>(
        "select amount_cents,processor_fee_cents,platform_fee_cents,net_to_org_cents from public.reservation_payments where reservation_id=$1", [reservationId],
      );
      expect(money.rows[0]).toMatchObject({ amount_cents: 535, processor_fee_cents: 20, platform_fee_cents: 15, net_to_org_cents: 500 });
      await db.query("set local role service_role");
      expect((await db.query<{ subscribe_coming_soon: string }>(
        "select public.subscribe_coming_soon($1,$2,$3)", [eventId, second, `${second}@test.invalid`],
      )).rows[0]?.subscribe_coming_soon).toBe("created");
      await db.query("reset role");
      await db.query("savepoint no_category");
      await expect(db.query("update public.events set status='open' where id=$1", [eventId]))
        .rejects.toMatchObject({ message: "event_categories_below_total_capacity" });
      await db.query("rollback to savepoint no_category");
      const category = await db.query<{ id: string }>(
        "insert into public.categories(org_id,event_id,code,label,base_price,slots_total) values($1,$2,'trail','Trail',1000,1) returning id",
        [orgId, eventId],
      );
      await db.query("savepoint locked_terms");
      await expect(db.query("update public.events set coming_soon_reserve_enabled=false where id=$1", [eventId]))
        .rejects.toMatchObject({ message: "active_reservations_lock_settings" });
      await db.query("rollback to savepoint locked_terms");
      await db.query("update public.events set status='open',reservation_deadline_at=now()-interval '1 minute' where id=$1", [eventId]);
      const extended = await db.query<{ reservation_deadline_at: Date }>(
        "select registration_deadline_at as reservation_deadline_at from public.event_reservations where id=$1", [reservationId],
      );
      expect(extended.rows[0]!.reservation_deadline_at.getTime()).toBeGreaterThan(Date.now());
      const jobs = await db.query<{ type: string }>(
        "select type from public.transactional_email_jobs where event_id=$1 order by type", [eventId],
      );
      expect(jobs.rows.map((row) => row.type)).toEqual(["coming_soon_opened", "reservation_paid"]);
      const passport = await db.query<{ id: string }>(
        "select id from public.runner_passports where claimed_user_id=$1", [first],
      );
      const entry = await db.query<{ id: string }>(`insert into public.registrations(
        org_id,event_id,category_id,user_id,booked_by_user_id,participant_passport_id,status,total_amount,event_reservation_id
      ) values($1,$2,$3,$4,$4,$5,'pending',1000,$6) returning id`,
      [orgId, eventId, category.rows[0]!.id, first, passport.rows[0]!.id, reservationId]);
      await db.query("insert into public.payments(org_id,registration_id,provider,amount,net_to_org) values($1,$2,'fake',1000,1000)",
        [orgId, entry.rows[0]!.id]);
      const entryPaid = await db.query<{ confirm_reserved_registration_tx: string }>(
        `select public.confirm_reserved_registration_tx($1,'fake',0,1000,'signed-test-ticket','{}'::jsonb,0,null,'none',now())`,
        [entry.rows[0]!.id],
      );
      expect(entryPaid.rows[0]?.confirm_reserved_registration_tx).toBe("paid");
      expect((await db.query<{ status: string }>("select status from public.event_reservations where id=$1", [reservationId]))
        .rows[0]?.status).toBe("converted");
      await db.query("update public.events set status='completed' where id=$1", [eventId]);
      await db.query("insert into public.user_roles(user_id,role) values($1,'super_admin')", [second]);
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [second]);
      const payout = await db.query<{ reservation_payout_open: string }>(
        "select public.reservation_payout_open($1)", [eventId],
      );
      expect((await db.query<{ reservation_payout_mark_paid: string }>(
        "select public.reservation_payout_mark_paid($1,1,'test-transfer','')", [payout.rows[0]!.reservation_payout_open],
      )).rows[0]?.reservation_payout_mark_paid).toBe("paid");
      expect((await db.query<{ net_to_org_cents: string }>(
        "select net_to_org_cents from public.reservation_payout_statements where id=$1", [payout.rows[0]!.reservation_payout_open],
      )).rows[0]?.net_to_org_cents).toBe("500");
    } finally {
      await db.query("rollback");
      await db.end();
    }
  });
});
