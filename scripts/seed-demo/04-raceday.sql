-- Race day and settlement: check-ins, payout statements, and a populated
-- account to look at the runner site from.

begin;

alter table checkins disable trigger trg_checkins_notify;

-- ── Check-ins ───────────────────────────────────────────────────────────────
-- Only races that have actually started. `event_date <= current_date` is the
-- same window eventState() calls "ongoing" plus everything already finished, so
-- a race that is still upcoming never shows a roster with people on it.
--
-- 93% is deliberate, not a rounding artefact: a real start line always has
-- no-shows, and a roster at 100% would hide the "not checked in" state the
-- marshal screen exists to show.
insert into checkins (org_id, registration_id, event_id, checked_in_at, checked_in_by)
select
  r.org_id, r.id, r.event_id,
  -- Between three hours and thirty minutes before the gun.
  (e.event_date + coalesce(e.flag_off, time '05:00'))::timestamptz
    - ((abs(hashtext(r.id::text || 'ci')) % 150) + 30) * interval '1 minute',
  case when r.org_id = '00000000-0000-0000-0000-00000000a001'
       then '00000000-0000-0000-0000-0000000000b2'::uuid
       else '00000000-0000-0000-0000-0000000000b3'::uuid end
from registrations r
join events e on e.id = r.event_id
where r.status = 'paid'
  and e.event_date <= current_date
  and e.status <> 'cancelled'
  and abs(hashtext(r.id::text || 'ci')) % 100 < 93
on conflict (registration_id) do nothing;

alter table checkins enable trigger trg_checkins_notify;

-- ── Payout statements ───────────────────────────────────────────────────────
-- Mirrors payout_open_statement(): gross and commission come from unstamped
-- paid/partially-refunded payments, and stamping payout_statement_id is what
-- makes the money impossible to pay out twice. Inserted directly rather than
-- through the RPC because that function gates on auth.uid() being a super admin,
-- and a SQL session has no auth.uid().
--
-- Completed races settle; the race finishing today gets an OPEN statement, so
-- the Payouts page has one of each state to render.
insert into payout_statements (
  id, org_id, event_id, gross_cents, commission_cents, refunds_cents,
  net_owed_cents, status, reference, note, opened_by, opened_at, paid_at, paid_by
)
select
  ('00000000-0000-4000-9500-' || lpad((row_number() over (order by e.event_date))::text, 12, '0'))::uuid,
  e.org_id, e.id, t.gross, t.commission, 0,
  t.gross - t.commission,
  case when e.status = 'completed' then 'paid' else 'open' end,
  case when e.status = 'completed'
       then 'BDO-' || to_char(e.event_date + 14, 'YYYYMMDD') || '-' || upper(substr(md5(e.id::text), 1, 6))
       else null end,
  case when e.status = 'completed'
       then 'Settled by bank transfer, net of platform commission.'
       else 'Open statement — race in progress, settles once the results are final.' end,
  '00000000-0000-0000-0000-0000000000b1',
  (e.event_date + 1)::timestamptz,
  case when e.status = 'completed' then (e.event_date + 14)::timestamptz else null end,
  case when e.status = 'completed' then '00000000-0000-0000-0000-0000000000b1'::uuid else null end
from events e
cross join lateral (
  select
    coalesce(sum(p.amount) filter (
      where p.status in ('paid', 'partially_refunded') and p.payout_statement_id is null), 0) as gross,
    coalesce(sum(p.platform_fee) filter (
      where p.status in ('paid', 'partially_refunded') and p.payout_statement_id is null), 0) as commission
  from payments p
  join registrations r on r.id = p.registration_id
  where r.event_id = e.id
) t
where e.status = 'completed'
   or (e.event_date <= current_date and coalesce(e.end_date, e.event_date) >= current_date)
on conflict (id) do nothing;

-- Stamp the payments each statement settled, so a second statement on the same
-- event cannot collect the same money again.
update payments p
set payout_statement_id = s.id
from payout_statements s
join registrations r2 on r2.event_id = s.event_id
where p.registration_id = r2.id
  and p.status in ('paid', 'partially_refunded')
  and p.payout_statement_id is null
  and s.id::text like '00000000-0000-4000-9500-%';

-- ── A populated runner account ──────────────────────────────────────────────
-- Rather than adding registrations for the real account (which would push
-- slots_taken past slots_total on the sold-out races), four seeded entries are
-- REASSIGNED to it. The paid count per category is unchanged, so the invariant
-- from 03 still holds — only the name on those four entries changes.
do $$
declare
  me uuid := '5ed228e7-4a9a-4150-bb12-515032cb533a';  -- json.alanano@gmail.com
  v_cat uuid;
  v_reg uuid;
  v_want text;
begin
  foreach v_want in array array[
    'c2ff88fe-3b5b-44ee-a0c8-a250e0b86e20:paid',   -- Valencia Twin Peaks 45K (completed, checked in)
    'a947f498-1264-46c1-b83f-e2b8ee5b80f4:paid',   -- Kalatungan Traverse 50K (running right now)
    'f84c5516-3172-4573-b40c-44eaffc6f7f9:paid',   -- Dulang-Dulang Vertical 28K (upcoming)
    '3f06df55-c9b6-4d0d-aa3a-b53abfceb3ee:pending' -- Malaybalay City Marathon 21K (unpaid)
  ] loop
    v_cat := split_part(v_want, ':', 1)::uuid;

    -- Skip if this account already has an entry on that event.
    if exists (
      select 1 from registrations r
      join categories c on c.id = v_cat
      where r.user_id = me and r.event_id = c.event_id
    ) then
      continue;
    end if;

    select r.id into v_reg
    from registrations r
    where r.category_id = v_cat
      and r.status::text = split_part(v_want, ':', 2)
      and r.id::text like '00000000-0000-4000-900%'
    order by r.id
    limit 1;

    if v_reg is not null then
      update registrations
      set user_id = me,
          custom_data = custom_data || jsonb_build_object(
            'blood_type', 'O+', 'shirt_size', 'XL',
            'running_club', 'Bukidnon Trail Runners', 'emergency_relation', 'Spouse')
      where id = v_reg;
    end if;
  end loop;
end $$;

-- Fill in the parts of that profile the sign-up flow leaves blank.
update profiles
set city = 'City of Malaybalay',
    city_name = 'City of Malaybalay',
    province_name = 'Bukidnon',
    city_psgc_code = (select code from psgc_cities where name = 'City of Malaybalay' limit 1)
where id = '5ed228e7-4a9a-4150-bb12-515032cb533a' and city_name is null;

-- ── Notifications ───────────────────────────────────────────────────────────
-- The registration/check-in triggers were off during the bulk load, on purpose.
-- These are the notices that account would actually be holding: one per entry it
-- owns, plus the reschedule and cancellation notices for races it follows.
insert into notifications (user_id, type, title, body, data, read_at, created_at, dedup_key)
select
  r.user_id,
  'paid'::notification_type,
  'Payment received',
  'You''re confirmed for ' || e.name || '. Your ticket is ready.',
  jsonb_build_object('event_id', e.id, 'registration_id', r.id),
  case when r.created_at < now() - interval '20 days' then r.created_at + interval '2 days' end,
  r.created_at + interval '5 minutes',
  'seed-paid-' || r.id::text
from registrations r
join events e on e.id = r.event_id
where r.user_id = '5ed228e7-4a9a-4150-bb12-515032cb533a' and r.status = 'paid'
on conflict do nothing;

insert into notifications (user_id, type, title, body, data, read_at, created_at, dedup_key)
select
  r.user_id, 'registered'::notification_type, 'You''re registered',
  'Complete payment to secure your slot for ' || e.name || '.',
  jsonb_build_object('event_id', e.id, 'registration_id', r.id),
  null, r.created_at + interval '1 minute', 'seed-reg-' || r.id::text
from registrations r
join events e on e.id = r.event_id
where r.user_id = '5ed228e7-4a9a-4150-bb12-515032cb533a' and r.status = 'pending'
on conflict do nothing;

insert into notifications (user_id, type, title, body, data, read_at, created_at, dedup_key)
select
  ci.user_id, 'checked_in'::notification_type, 'Checked in',
  'You''re checked in for ' || e.name || '. Good luck out there.',
  jsonb_build_object('event_id', e.id, 'registration_id', ci.reg_id),
  ci.at + interval '10 minutes', ci.at, 'seed-ci-' || ci.reg_id::text
from (
  select r.user_id, r.id as reg_id, r.event_id, c.checked_in_at as at
  from checkins c join registrations r on r.id = c.registration_id
  where r.user_id = '5ed228e7-4a9a-4150-bb12-515032cb533a'
) ci
join events e on e.id = ci.event_id
on conflict do nothing;

commit;

select
  (select count(*) from checkins) as checkins,
  (select count(*) from payout_statements) as statements,
  (select count(*) from notifications) as notifications,
  (select count(*) from registrations
    where user_id = '5ed228e7-4a9a-4150-bb12-515032cb533a') as my_races;
