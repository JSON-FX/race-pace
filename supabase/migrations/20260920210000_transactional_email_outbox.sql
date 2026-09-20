-- Important runner email is durable work, not part of the organizer or payment
-- request. State-changing triggers enqueue one private row in the same
-- transaction; a protected Edge worker performs delivery after commit.
create table public.transactional_email_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in (
    'event_rescheduled','event_cancelled','event_updated',
    'payment_failed','payment_expiring'
  )),
  user_id uuid not null references auth.users(id) on delete cascade,
  registration_id uuid references public.registrations(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  dedup_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 5),
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check ((lease_token is null) = (lease_expires_at is null))
);

create index transactional_email_jobs_pending_idx
  on public.transactional_email_jobs(available_at,created_at)
  where sent_at is null and attempts < 5;

alter table public.transactional_email_jobs enable row level security;

revoke all on public.transactional_email_jobs from public,anon,authenticated;

grant select,insert,update,delete on public.transactional_email_jobs to service_role;

create function public.transactional_email_event_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
  v_payload jsonb := '{}'::jsonb;
  v_changed text[] := '{}'::text[];
  v_change_key text;
begin
  if old.status is distinct from 'cancelled' and new.status = 'cancelled' then
    v_type := 'event_cancelled';
    v_payload := jsonb_build_object('status_note',new.status_note);
    v_change_key := 'cancelled';
  elsif new.event_date is distinct from old.event_date
     or new.end_date is distinct from old.end_date then
    v_type := 'event_rescheduled';
    v_payload := jsonb_build_object(
      'previous_event_date',old.event_date,
      'event_date',new.event_date,
      'previous_end_date',old.end_date,
      'end_date',new.end_date
    );
    v_change_key := concat_ws(':','rescheduled',coalesce(new.event_date::text,'none'),coalesce(new.end_date::text,'none'));
  else
    if new.name is distinct from old.name then v_changed := array_append(v_changed,'name'); end if;
    if new.place is distinct from old.place then v_changed := array_append(v_changed,'place'); end if;
    if new.venue is distinct from old.venue then v_changed := array_append(v_changed,'venue'); end if;
    if new.region_name is distinct from old.region_name then v_changed := array_append(v_changed,'region_name'); end if;
    if new.province_name is distinct from old.province_name then v_changed := array_append(v_changed,'province_name'); end if;
    if new.city_name is distinct from old.city_name then v_changed := array_append(v_changed,'city_name'); end if;
    if new.description is distinct from old.description then v_changed := array_append(v_changed,'description'); end if;
    if new.schedule is distinct from old.schedule then v_changed := array_append(v_changed,'schedule'); end if;
    if new.inclusions is distinct from old.inclusions then v_changed := array_append(v_changed,'inclusions'); end if;
    if new.flag_off is distinct from old.flag_off then v_changed := array_append(v_changed,'flag_off'); end if;
    if new.elevation_gain_m is distinct from old.elevation_gain_m then v_changed := array_append(v_changed,'elevation_gain_m'); end if;
    if new.cutoff_hours is distinct from old.cutoff_hours then v_changed := array_append(v_changed,'cutoff_hours'); end if;
    if new.registration_closes_at is distinct from old.registration_closes_at then v_changed := array_append(v_changed,'registration_closes_at'); end if;
    if new.kit_edit_closes_at is distinct from old.kit_edit_closes_at then v_changed := array_append(v_changed,'kit_edit_closes_at'); end if;
    if new.check_in_required is distinct from old.check_in_required then v_changed := array_append(v_changed,'check_in_required'); end if;
    if new.status_note is distinct from old.status_note then v_changed := array_append(v_changed,'status_note'); end if;
    if cardinality(v_changed) = 0 then return new; end if;
    v_type := 'event_updated';
    v_payload := jsonb_build_object('changed_fields',to_jsonb(v_changed));
    -- A repeated no-op save never reaches this branch. txid groups all fields
    -- from one organizer write into one message per registration.
    v_change_key := 'updated:' || txid_current()::text;
  end if;

  insert into public.transactional_email_jobs(
    type,user_id,registration_id,event_id,dedup_key,payload
  )
  select v_type,coalesce(r.booked_by_user_id,r.user_id),r.id,new.id,
    concat_ws(':',v_type,new.id::text,r.id::text,v_change_key),v_payload
  from public.registrations r
  where r.event_id = new.id and r.status in ('pending','paid')
  on conflict (dedup_key) do nothing;
  return new;
end $$;

revoke all on function public.transactional_email_event_change()
  from public,anon,authenticated;

-- Alphabetical trigger order matters on cancellation. Capture pending runners
-- before events_close_expires_pending releases their reservations.
create trigger a_transactional_email_event_change
  after update on public.events for each row
  execute function public.transactional_email_event_change();

create function public.transactional_email_payment_failed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status is distinct from 'failed' and new.status = 'failed' then
    insert into public.transactional_email_jobs(
      type,user_id,registration_id,event_id,dedup_key
    )
    select 'payment_failed',coalesce(r.booked_by_user_id,r.user_id),r.id,r.event_id,
      'payment_failed:' || new.id::text
    from public.registrations r
    where r.id = new.registration_id and r.status = 'pending'
    on conflict (dedup_key) do nothing;
  end if;
  return new;
end $$;

revoke all on function public.transactional_email_payment_failed()
  from public,anon,authenticated;

create trigger transactional_email_payment_failed
  after update of status on public.payments for each row
  execute function public.transactional_email_payment_failed();

create function public.transactional_email_enqueue_expiring_payments()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with inserted as (
    insert into public.transactional_email_jobs(
      type,user_id,registration_id,event_id,dedup_key,payload
    )
    select 'payment_expiring',coalesce(r.booked_by_user_id,r.user_id),r.id,r.event_id,
      'payment_expiring:' || r.id::text,
      jsonb_build_object('expires_at',r.expires_at)
    from public.registrations r
    join public.payments p on p.registration_id = r.id
    join public.events e on e.id = r.event_id
    where r.status = 'pending' and p.status = 'pending'
      and r.expires_at > now() and r.expires_at <= now() + interval '2 hours'
      and e.status not in ('cancelled','closed','completed')
    on conflict (dedup_key) do nothing
    returning 1
  ) select count(*) into v_count from inserted;
  return v_count;
end $$;

revoke all on function public.transactional_email_enqueue_expiring_payments()
  from public,anon,authenticated;

grant execute on function public.transactional_email_enqueue_expiring_payments()
  to service_role;

create function public.transactional_email_claim(p_limit integer default 20)
returns setof public.transactional_email_jobs
language sql security invoker set search_path = '' as $$
  with candidates as (
    select j.id from public.transactional_email_jobs j
    where j.sent_at is null and j.attempts < 5
      and j.available_at <= now()
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
    order by j.created_at,j.id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),50))
  )
  update public.transactional_email_jobs j set
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + interval '5 minutes',
    attempts = j.attempts + 1
  from candidates c where j.id = c.id
  returning j.*;
$$;

create function public.transactional_email_finish(
  p_job uuid,p_lease uuid,p_error text default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_attempts integer;
begin
  select attempts into v_attempts from public.transactional_email_jobs
  where id=p_job and lease_token=p_lease and sent_at is null for update;
  if v_attempts is null then return false; end if;
  update public.transactional_email_jobs set
    sent_at = case when p_error is null then now() else null end,
    available_at = case when p_error is null then available_at
      else now() + make_interval(mins => least(60,5 * v_attempts)) end,
    last_error = case when p_error is null then null else left(p_error,120) end,
    lease_token = null,
    lease_expires_at = null
  where id=p_job and lease_token=p_lease and sent_at is null;
  return found;
end $$;

revoke all on function public.transactional_email_claim(integer),
  public.transactional_email_finish(uuid,uuid,text)
  from public,anon,authenticated;

grant execute on function public.transactional_email_claim(integer),
  public.transactional_email_finish(uuid,uuid,text)
  to service_role;

-- Pure database selection is environment-independent. HTTP delivery remains an
-- explicitly configured worker schedule after each deployment target is checked.
select cron.schedule(
  'enqueue-transactional-payment-expiry',
  '*/15 * * * *',
  $$select public.transactional_email_enqueue_expiring_payments()$$
);
