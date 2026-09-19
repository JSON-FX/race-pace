-- A replacement checkout POST can have an uncertain outcome. Claim each old
-- session before that POST so a later event save cannot mint another unknown,
-- still-chargeable replacement for the same checkout.
create table public.pending_checkout_reprice_attempts (
  registration_id uuid primary key references public.registrations(id) on delete cascade,
  old_provider_ref text not null,
  new_provider_ref text,
  target_total integer not null,
  outcome text not null,
  detail jsonb not null default '{}'::jsonb,
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now()
);
alter table public.pending_checkout_reprice_attempts enable row level security;
revoke all on public.pending_checkout_reprice_attempts from public,anon,authenticated;
grant select,insert,update on public.pending_checkout_reprice_attempts to service_role;

create function public.begin_pending_checkout_reprice(
  p_registration_id uuid,p_old_session_id text,p_target_total integer
) returns text language plpgsql security invoker set search_path = '' as $$
declare p public.payments%rowtype; prior public.pending_checkout_reprice_attempts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into p from public.payments where registration_id=p_registration_id for update;
  if p.id is null or p.status<>'pending' or p.provider_ref is distinct from p_old_session_id
    then return 'mismatch'; end if;
  if exists(select 1 from public.single_payment_captures where registration_id=p_registration_id)
    then return 'capture_pending'; end if;
  select * into prior from public.pending_checkout_reprice_attempts where registration_id=p_registration_id;
  if prior.registration_id is not null and prior.old_provider_ref=p_old_session_id
     and prior.outcome not in ('provider_rejected','replacement_expired') then return 'already_claimed'; end if;
  insert into public.pending_checkout_reprice_attempts(
    registration_id,old_provider_ref,target_total,outcome
  ) values (p_registration_id,p_old_session_id,p_target_total,'creating')
  on conflict (registration_id) do update set
    old_provider_ref=excluded.old_provider_ref,new_provider_ref=null,
    target_total=excluded.target_total,outcome='creating',detail='{}'::jsonb,
    attempts=public.pending_checkout_reprice_attempts.attempts+1,updated_at=now();
  return 'claimed';
end $$;

create function public.record_pending_checkout_reprice(
  p_registration_id uuid,p_old_session_id text,p_outcome text,
  p_new_session_id text default null,p_detail jsonb default '{}'::jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.pending_checkout_reprice_attempts set
    new_provider_ref=p_new_session_id,outcome=p_outcome,
    detail=coalesce(p_detail,'{}'::jsonb),updated_at=now()
  where registration_id=p_registration_id and old_provider_ref=p_old_session_id;
end $$;

revoke all on function public.begin_pending_checkout_reprice(uuid,text,integer),
  public.record_pending_checkout_reprice(uuid,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.begin_pending_checkout_reprice(uuid,text,integer),
  public.record_pending_checkout_reprice(uuid,text,text,text,jsonb) to service_role;
