-- PayMongo sessions stay chargeable until its expire API closes them. Keep the
-- local reservation until that provider outcome is known, including an
-- uncertain create whose session ID has not yet been bound.
create table public.provider_session_expiry_attempts (
  registration_id uuid primary key references public.registrations(id),
  session_id text,
  outcome text not null,
  detail jsonb not null default '{}'::jsonb,
  attempts integer not null default 1 check (attempts > 0),
  first_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.provider_session_expiry_attempts enable row level security;
revoke all on public.provider_session_expiry_attempts from public,anon,authenticated;
grant select,insert,update on public.provider_session_expiry_attempts to service_role;

create function public.paymongo_expiry_candidates(p_limit integer default 20)
returns table(registration_id uuid, session_id text)
language sql stable security invoker set search_path = '' as $$
  select r.id,p.provider_ref
  from public.registrations r
  join public.payments p on p.registration_id=r.id
  join public.events e on e.id=r.event_id
  left join public.provider_session_expiry_attempts a on a.registration_id=r.id
  where r.status='pending' and r.booking_order_id is null
    and p.status='pending' and p.provider='paymongo'
    and (r.expires_at<=now() or e.status in ('cancelled','closed','completed'))
  order by a.last_attempt_at nulls first,r.expires_at,r.id
  limit greatest(1,least(coalesce(p_limit,20),100));
$$;

create function public.record_paymongo_expiry_attempt(
  p_registration_id uuid,p_session_id text,p_outcome text,p_detail jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.provider_session_expiry_attempts(
    registration_id,session_id,outcome,detail,completed_at
  ) values (
    p_registration_id,p_session_id,p_outcome,coalesce(p_detail,'{}'::jsonb),
    case when p_outcome='expired' then now() else null end
  ) on conflict (registration_id) do update set
    session_id=excluded.session_id,outcome=excluded.outcome,detail=excluded.detail,
    attempts=public.provider_session_expiry_attempts.attempts+1,
    last_attempt_at=now(),
    completed_at=case when excluded.outcome='expired' then now()
      else public.provider_session_expiry_attempts.completed_at end;
end $$;

create function public.finish_paymongo_checkout_expiry(
  p_registration_id uuid,p_session_id text,p_provider_evidence jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare r public.registrations%rowtype; p public.payments%rowtype;
begin
  if p_session_id is null or p_session_id !~ '^cs_[A-Za-z0-9_-]+$' then return 'invalid_session'; end if;
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into r from public.registrations where id=p_registration_id for update;
  select * into p from public.payments where registration_id=p_registration_id for update;
  if r.id is null or p.id is null or p.provider<>'paymongo' or
     p.provider_ref is distinct from p_session_id then return 'mismatch'; end if;
  if r.status<>'pending' or p.status<>'pending' then return 'already_final'; end if;
  if exists(select 1 from public.single_payment_captures where registration_id=p_registration_id)
    then return 'capture_pending'; end if;
  update public.registrations set status='expired',expires_at=null where id=p_registration_id;
  update public.payments set status='failed' where id=p.id;
  perform public.record_paymongo_expiry_attempt(
    p_registration_id,p_session_id,'expired',p_provider_evidence
  );
  return 'expired';
end $$;

create or replace function public.expire_stale_registrations() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with expired as (
    update public.registrations r set status='expired',expires_at=null
    where r.status='pending' and r.expires_at<=now()
      and not exists(select 1 from public.payments p
        where p.registration_id=r.id and p.provider='paymongo')
    returning r.id
  ), failed as (
    update public.payments p set status='failed' from expired e
    where p.registration_id=e.id and p.status='pending' returning p.id
  ) select count(*) into v_count from expired;
  return v_count;
end $$;

create or replace function public.expire_pending_on_event_close() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.registrations r set status='expired',expires_at=null
  where r.event_id=new.id and r.status='pending'
    and not exists(select 1 from public.payments p
      where p.registration_id=r.id and p.provider='paymongo');
  update public.payments p set status='failed' from public.registrations r
  where p.registration_id=r.id and r.event_id=new.id and r.status='expired'
    and p.status='pending' and p.provider<>'paymongo';
  return new;
end $$;

revoke all on function public.paymongo_expiry_candidates(integer),
  public.record_paymongo_expiry_attempt(uuid,text,text,jsonb),
  public.finish_paymongo_checkout_expiry(uuid,text,jsonb),
  public.expire_stale_registrations(),public.expire_pending_on_event_close()
  from public,anon,authenticated;
grant execute on function public.paymongo_expiry_candidates(integer),
  public.record_paymongo_expiry_attempt(uuid,text,text,jsonb),
  public.finish_paymongo_checkout_expiry(uuid,text,jsonb),
  public.expire_stale_registrations() to service_role;
