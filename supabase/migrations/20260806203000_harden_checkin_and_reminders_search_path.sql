-- Follow-up to 20260806202000_harden_auth_helper_search_path.sql. That migration
-- hardened the three `auth_*` authorization HELPERS (`auth_is_super_admin`,
-- `auth_can_admin_org`, `auth_can_check_in_event`) to `search_path = ''`, and its
-- own enumeration flagged `checkin_events`/`checkin_roster` (still `search_path =
-- public`, unqualified `events`) as "out of reach for that task" (PR2/check-in
-- scope) but explicitly NOT as safe — their own authorization DECISION no longer
-- forgeable (that runs through the now-hardened helper), but their unqualified
-- `events` reference was still nominally shadowable in isolation.
--
-- Reproduced why that residual matters, against `checkin_roster` specifically:
-- the attacker does NOT need to forge the (now-hardened) helper. They forge its
-- INPUT instead. Holding a real check-in role in org A only, they
-- `create temp table events (...)` mapping org B's real event id to org A, then
-- call `checkin_roster(orgB_event_id)`. `auth_can_check_in_event(e.org_id, e.id)`
-- is handed `org_id = A` (from the shadowed row) and correctly returns true for
-- what it was told — the function was never lied to about ITS OWN logic, only
-- about which org a given event belongs to. The join then returns REAL org-B
-- `registrations` rows: runner PII and `ticket_token` (race-day entry gate).
-- Reproduced: 0 rows before the shadow, 1 row after, containing another org's
-- runner name/bib/ticket_token. See task-v3b-report.md for the full transcript.
--
-- `checkin_events()` has the identical unqualified-`events` defect. Its own
-- review judged it non-leaking (a shadowed `events` row only feeds the attacker
-- back their own fabricated rows, since the function just lists events, it
-- doesn't join to another table keyed off the shadow) but it gets the same
-- one-line fix here anyway — leaving one of a matched pair hardened and the
-- other not is exactly how this class of bug has now regressed three times in
-- this codebase (see the 20260806202000 migration's own header).
--
-- Separately: `fn_enqueue_event_reminders()` turned out to be reachable by
-- ANY `authenticated` session directly, not cron-only as previously assumed —
-- `pg_proc.proacl` showed `{=X/postgres,...}`, i.e. EXECUTE granted to PUBLIC
-- (from `20260723090600_event_reminders.sql`'s original `grant ... to
-- service_role`, which never revoked the implicit PUBLIC default). Its body is
-- `search_path = public` with unqualified `notifications`/`events`/
-- `registrations`. A plain authenticated user could shadow `events`/
-- `registrations` in `pg_temp` and call it directly, causing the (real)
-- `notifications` table to receive attacker-authored rows addressed to
-- attacker-chosen `user_id`s — a phishing primitive delivered inside the app's
-- own notification feed, bypassing `notifications` RLS entirely (RLS never
-- runs; the INSERT happens inside a SECURITY DEFINER function body). Reproduced:
-- 0 notification rows before, 1 forged row after (see task-v3b-report.md).
-- `pg_cron`'s `event-reminders-daily` job runs as `username = 'postgres'`
-- (`cron.job`), who is also the function's owner — an owner always has
-- implicit EXECUTE regardless of GRANT/REVOKE state, so revoking PUBLIC's
-- grant here does not affect the legitimate cron caller. `service_role`'s own
-- explicit grant (also present in `proacl`) is left untouched.
--
-- While auditing every SECURITY DEFINER function for this same shape, found
-- `fn_notify_on_event_change` (an AFTER INSERT/UPDATE trigger on `events`) is
-- ALSO reachable by an ordinary authenticated org admin performing a fully
-- legitimate action: `events` grants `authenticated` real INSERT+UPDATE at the
-- table level, gated only by `auth_can_admin_org(org_id)` on their OWN org —
-- something any org editor/admin can do for real. The trigger body then does
-- an unqualified `select ... from registrations` to pick notification
-- recipients and an unqualified `insert into notifications`. An org admin
-- updating (or publishing) their OWN event, having first shadowed
-- `pg_temp.registrations` with attacker-chosen `user_id` rows, causes the
-- (real) `notifications` table to receive forged rows for ANY user_id, not
-- just their own org's registrants — same phishing-primitive shape as
-- `fn_enqueue_event_reminders`, reachable via a legitimate DML action rather
-- than a direct RPC call. Hardened here for the same reason.
--
-- `fn_notify_on_registration` (trigger on `registrations`) and
-- `fn_notify_on_checkin` (trigger on `checkins`) were checked against the
-- actual table grants (`\dp`), not assumed: `authenticated`'s grant on
-- `registrations` is `rdDxtm` (read/delete/... — no `a` insert, no `w`
-- update) and on `checkins` is `rDxtm` (read only, no insert). Neither table
-- has ANY authenticated-reachable INSERT/UPDATE path today (registrations are
-- written only by the `registrations-checkout` edge function and
-- `confirm_payment_tx`/`refund_registration_tx`, both `service_role`-only;
-- checkins have no write RPC at all yet — that ships with PR2). So neither
-- trigger can currently be fired by an authenticated session at all, forged
-- input or not — confirming, rather than assuming, the original review's
-- judgment for these two specifically. Hardened anyway, defensively: the fix
-- is a zero-behaviour-change qualification, identical cost to leaving them,
-- and closes the gap before whatever PR2 write path exists inevitably makes
-- one of them reachable and this has to be re-discovered a fourth time.
--
-- All bodies below are read from the CURRENT catalog definitions
-- (`pg_get_functiondef`), not the historical migration files, since a later
-- migration can differ from what shipped originally (checked — it doesn't
-- here, but the practice matters). Signatures, return types, volatility and
-- behaviour are unchanged; this is resolution hardening only, matching
-- 20260806202000's exact pattern.

create or replace function public.checkin_events()
returns table (id uuid, name text, event_date date, end_date date)
language sql stable security definer set search_path = '' as $$
  select e.id, e.name::text, e.event_date, e.end_date
  from public.events e
  where public.auth_can_check_in_event(e.org_id, e.id)
  order by e.event_date nulls last, e.name;
$$;

create or replace function public.checkin_roster(p_event_id uuid)
returns table (
  registration_id uuid,
  ticket_token    text,
  runner          text,
  bib             text,
  category        text,
  status          text,
  checked_in_at   timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    r.id,
    r.ticket_token::text,
    coalesce(pr.full_name, 'Unknown runner')::text,
    pr.bib_name::text,
    coalesce(c.label, '')::text,
    r.status::text,
    ci.checked_in_at
  from public.registrations r
  join public.events e            on e.id = r.event_id
  left join public.profiles pr    on pr.id = r.user_id
  left join public.categories c   on c.id = r.category_id
  left join public.checkins ci    on ci.registration_id = r.id
  where r.event_id = p_event_id
    and r.status in ('pending', 'paid')
    and public.auth_can_check_in_event(e.org_id, e.id)
  order by coalesce(pr.full_name, '');
$$;

create or replace function public.fn_enqueue_event_reminders() returns void
  language plpgsql security definer set search_path = '' as $$
declare d int;
begin
  foreach d in array array[7,1] loop
    insert into public.notifications (user_id, type, title, body, data, dedup_key)
    select r.user_id, 'event_reminder',
           case when d = 1 then '1 day to go' else d || ' days to go' end,
           e.name || case when d = 1 then ' is tomorrow. Get your gear ready.' else ' is coming up. Get ready.' end,
           jsonb_build_object('event_id', e.id),
           'reminder:' || e.id || ':' || r.user_id || ':' || d
    from public.events e
    join public.registrations r on r.event_id = e.id and r.status = 'paid'
    where e.status = 'open' and e.event_date = current_date + d
    on conflict (dedup_key) do nothing;
  end loop;
end; $$;

-- It was assumed to be cron-only; it is not (see header above). No role other
-- than the function owner (`postgres`, who runs the `pg_cron` job) needs it.
revoke execute on function public.fn_enqueue_event_reminders() from public;

create or replace function public.fn_notify_on_registration() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_name from public.events where id = new.event_id;
    if new.status = 'paid' then
      insert into public.notifications (user_id, type, title, body, data)
      values (new.user_id, 'paid', 'Payment received',
              'You''re confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    else
      insert into public.notifications (user_id, type, title, body, data)
      values (new.user_id, 'registered', 'You''re registered',
              'Complete payment to secure your slot for ' || coalesce(v_name,'the event') || '.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from 'paid' and new.status = 'paid' then
    select name into v_name from public.events where id = new.event_id;
    insert into public.notifications (user_id, type, title, body, data)
    values (new.user_id, 'paid', 'Payment received',
            'You''re confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
  end if;
  return new;
end; $$;

create or replace function public.fn_notify_on_event_change() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from 'cancelled' and new.status = 'cancelled' then
    insert into public.notifications (user_id, type, title, body, data)
    select r.user_id, 'event_cancelled', 'Event cancelled',
           new.name || ' has been cancelled.', jsonb_build_object('event_id', new.id)
    from public.registrations r where r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and new.original_date is distinct from old.original_date and new.original_date is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select r.user_id, 'event_rescheduled', 'Event rescheduled',
           new.name || ' has a new date. Check the details.', jsonb_build_object('event_id', new.id)
    from public.registrations r where r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from 'completed' and new.status = 'completed' then
    insert into public.notifications (user_id, type, title, body, data)
    select r.user_id, 'event_completed', 'You completed ' || new.name || '!',
           'Thanks for joining. See you at the next race.', jsonb_build_object('event_id', new.id)
    from public.registrations r where r.event_id = new.id and r.status = 'paid';
  end if;

  -- newly published (draft/insert -> open): broadcast to all users, deduped per (event,user).
  if (tg_op = 'INSERT' and new.status = 'open')
     or (tg_op = 'UPDATE' and old.status is distinct from 'open' and new.status = 'open') then
    insert into public.notifications (user_id, type, title, body, data, dedup_key)
    select p.id, 'event_created', 'New event',
           new.name || ' was just listed. Take a look.',
           jsonb_build_object('event_id', new.id),
           'event_created:' || new.id || ':' || p.id
    from public.profiles p
    on conflict (dedup_key) do nothing;
  end if;

  return new;
end; $$;

create or replace function public.fn_notify_on_checkin() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_name text;
begin
  select r.user_id into v_uid from public.registrations r where r.id = new.registration_id;
  select name into v_name from public.events where id = new.event_id;
  if v_uid is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_uid, 'checked_in', 'You''re checked in',
            'Checked in at ' || coalesce(v_name,'the event') || '. Enjoy your race.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.registration_id));
  end if;
  return new;
end; $$;
