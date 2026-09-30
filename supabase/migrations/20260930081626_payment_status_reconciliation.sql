-- This migration has only run locally; it has not been applied to hosted projects.
-- A disabled provider webhook left a captured reservation pending for hours.
-- This worker verifies bound checkouts before expiry without creating or closing them.
create table public.payment_reconciliation_checks (
  kind text not null check(kind in ('single','group','reservation')),
  subject_id uuid not null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  session_id text not null check(session_id like 'cs_%'),
  created_at timestamptz not null default now(),
  attempted_at timestamptz,
  completed_at timestamptz,
  lease uuid,
  outcome text,
  primary key(kind,subject_id)
);
alter table public.payment_reconciliation_checks enable row level security;
revoke all on public.payment_reconciliation_checks from public,anon,authenticated;
grant all on public.payment_reconciliation_checks to service_role;
create index payment_reconciliation_checks_org on public.payment_reconciliation_checks(org_id);

create view public.payment_reconciliation_pending_v with (security_invoker=true) as
select 'single'::text kind,p.registration_id subject_id,p.org_id,p.provider_ref session_id
from public.payments p where p.provider='paymongo' and p.status='pending' and p.provider_ref like 'cs_%'
union all
select 'reservation',p.reservation_id,p.org_id,p.provider_ref
from public.reservation_payments p where p.provider='paymongo' and p.status='pending' and p.provider_ref like 'cs_%'
union all
select 'group',a.id,a.org_id,d.session_id
from public.booking_payment_attempts a join public.booking_payment_dispatches d on d.attempt_id=a.id
where a.status in ('creating','creation_unknown','ready') and d.session_id like 'cs_%';
revoke all on public.payment_reconciliation_pending_v from public,anon,authenticated;
grant select on public.payment_reconciliation_pending_v to service_role;

create function public.payment_reconciliation_claim(p_limit integer default 20)
returns table(kind text,subject_id uuid,session_id text,lease uuid)
language plpgsql security invoker set search_path='' as $$
begin
  insert into public.payment_reconciliation_checks as q(kind,subject_id,org_id,session_id)
  select p.kind,p.subject_id,p.org_id,p.session_id from public.payment_reconciliation_pending_v p
  on conflict on constraint payment_reconciliation_checks_pkey do update
    set session_id=excluded.session_id,created_at=clock_timestamp(),attempted_at=null,completed_at=null,lease=null,outcome=null
    where q.session_id is distinct from excluded.session_id;

  return query with picked as (
    select q.kind,q.subject_id from public.payment_reconciliation_checks q
    join public.payment_reconciliation_pending_v p using(kind,subject_id,session_id)
    where (q.attempted_at is null or q.attempted_at < statement_timestamp()-interval '4 minutes')
      and coalesce(q.outcome,'') not in ('review_required','reconciliation_required')
    order by q.attempted_at nulls first,q.kind,q.subject_id
    limit greatest(1,least(coalesce(p_limit,20),20)) for update of q skip locked
  ) update public.payment_reconciliation_checks q
    set attempted_at=clock_timestamp(),lease=gen_random_uuid()
    from picked p where q.kind=p.kind and q.subject_id=p.subject_id
    returning q.kind,q.subject_id,q.session_id,q.lease;
end $$;

create function public.payment_reconciliation_finish(p_kind text,p_subject uuid,p_lease uuid,p_outcome text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if p_outcome not in ('paid','pending','expired','review_required','reconciliation_required','retry_required') then
    raise exception 'invalid_reconciliation_outcome';
  end if;
  update public.payment_reconciliation_checks set completed_at=clock_timestamp(),outcome=p_outcome,lease=null
  where kind=p_kind and subject_id=p_subject and lease=p_lease;
  return found;
end $$;

-- Platform worker health contains no tenant or customer data. Keep it private.
create table public.payment_reconciliation_health (
  singleton boolean primary key default true check(singleton),
  completed_at timestamptz not null,
  provider_issue text
);
alter table public.payment_reconciliation_health enable row level security;
revoke all on public.payment_reconciliation_health from public,anon,authenticated;
grant all on public.payment_reconciliation_health to service_role;

create function public.payment_reconciliation_alerts() returns void
language plpgsql security definer set search_path='' as $$
declare issue text;
begin
  select case when h.completed_at < now()-interval '15 minutes' then 'payment_reconciliation_stalled'
    else h.provider_issue end into issue from public.payment_reconciliation_health h;
  if issue is null and exists (
    select 1 from public.payment_reconciliation_checks q
    join public.payment_reconciliation_pending_v p using(kind,subject_id,session_id)
    where coalesce(q.outcome,'') not in ('review_required','reconciliation_required')
      and q.created_at < now()-interval '20 minutes'
      and (q.completed_at is null or q.completed_at < now()-interval '20 minutes'
        or q.outcome='retry_required')
  ) then issue:='payment_reconciliation_overdue'; end if;
  if issue is null then return; end if;
  insert into public.notifications(user_id,type,title,body,data,dedup_key)
  select distinct ur.user_id,'payment_review'::public.notification_type,'Payment synchronization needs attention',
    'Check PayMongo webhook delivery and the payment reconciliation worker. Captured payments may need recovery.',
    jsonb_build_object('reason',issue),
    'payment-sync:'||issue||':'||current_date::text||':'||ur.user_id::text
  from public.user_roles ur where ur.role='super_admin'
  on conflict(dedup_key) do nothing;
end $$;

create function public.payment_reconciliation_heartbeat(p_provider_issue text default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_provider_issue is not null and p_provider_issue not in
    ('payment_webhook_disabled_or_missing','payment_webhook_health_unavailable') then
    raise exception 'invalid_provider_health';
  end if;
  insert into public.payment_reconciliation_health(singleton,completed_at,provider_issue)
  values(true,clock_timestamp(),p_provider_issue)
  on conflict(singleton) do update set completed_at=excluded.completed_at,provider_issue=excluded.provider_issue;
  perform public.payment_reconciliation_alerts();
end $$;

revoke all on function public.payment_reconciliation_claim(integer),
  public.payment_reconciliation_finish(text,uuid,uuid,text),
  public.payment_reconciliation_heartbeat(text),public.payment_reconciliation_alerts()
from public,anon,authenticated;
grant execute on function public.payment_reconciliation_claim(integer),
  public.payment_reconciliation_finish(text,uuid,uuid,text),
  public.payment_reconciliation_heartbeat(text),public.payment_reconciliation_alerts()
to service_role;

-- Independent SQL watchdog still runs when the HTTP worker stops responding.
select cron.schedule('payment-reconciliation-health','*/5 * * * *',
  $$select public.payment_reconciliation_alerts()$$);
-- Configure the HTTP worker per environment after deployment, using its own
-- project URL and the existing vault paymongo_expiry_worker_secret.
