-- Local-only migration, not yet applied to a hosted environment.
-- An unresolved provider call must keep its hold, without monopolizing the
-- oldest-first worker page forever. Claiming a page rotates even failed work.
alter table public.event_reservations add column maintenance_checked_at timestamptz;
create index reservation_maintenance_queue on public.event_reservations(maintenance_checked_at nulls first)
  where status in ('pending','paid');
create or replace function public.coming_soon_expiry_candidates(p_limit integer default 50)
returns setof uuid language plpgsql volatile security invoker set search_path='' as $$
declare ids uuid[];
begin
  select array_agg(q.id) into ids from (
    select r.id from public.event_reservations r join public.events e on e.id=r.event_id
    where (r.status='pending' and r.checkout_expires_at<=statement_timestamp()) or
      (r.status='paid' and (exists(select 1 from public.event_reservation_places p left join public.categories c on c.id=p.category_id
        where p.reservation_id=r.id and p.status='held' and
          coalesce(greatest(p.entry_payment_deadline_at,c.entry_payment_deadline_at),r.registration_deadline_at)<=statement_timestamp()
          and (p.category_id is not null or e.status<>'coming_soon'))
        or (r.reservation_request is null and r.registration_deadline_at<=statement_timestamp() and e.status<>'coming_soon'
          and not exists(select 1 from public.event_reservation_places where reservation_id=r.id))))
    order by r.maintenance_checked_at nulls first,r.created_at,r.id
    limit greatest(1,least(coalesce(p_limit,50),100))
  ) q;
  -- The reservation update trigger also locks its event. Acquire events first
  -- in the same order as admission before any reservation row is updated.
  perform 1 from public.events where id in (select event_id from public.event_reservations where id=any(ids)) order by id for update;
  return query update public.event_reservations r set maintenance_checked_at=statement_timestamp()
    where r.id=any(ids) returning r.id;
end $$;
revoke all on function public.coming_soon_expiry_candidates(integer) from public,anon,authenticated;
grant execute on function public.coming_soon_expiry_candidates(integer) to service_role;

-- Only unused upload tickets older than seven days are retired. Delete their
-- authority atomically before touching Storage; a failed Storage request stays
-- in this private outbox for retry. Submitted proofs are never collected here.
create table public.prescreening_proof_cleanup (
  object_path text primary key,
  created_at timestamptz not null default now(),
  attempted_at timestamptz
);
alter table public.prescreening_proof_cleanup enable row level security;
revoke all on public.prescreening_proof_cleanup from anon,authenticated;
grant all on public.prescreening_proof_cleanup to service_role;

create function public.prescreening_collect_unused_proofs(p_limit integer default 50)
returns setof text language plpgsql security definer set search_path='' as $$
declare candidate record;
begin
  for candidate in
    select u.id,u.event_id from public.prescreening_uploads u
    where u.created_at<statement_timestamp()-interval '7 days'
      and not exists(select 1 from public.prescreening_applications a where a.proof_upload_id=u.id)
    order by u.event_id,u.id limit greatest(1,least(coalesce(p_limit,50),200))
  loop
    -- Submission also takes the event lock before binding proof to an application.
    perform 1 from public.events where id=candidate.event_id for update;
    with retired as (
      delete from public.prescreening_uploads u where u.id=candidate.id
        and not exists(select 1 from public.prescreening_applications a where a.proof_upload_id=u.id)
      returning object_path
    )
    insert into public.prescreening_proof_cleanup(object_path) select object_path from retired
      on conflict(object_path) do nothing;
  end loop;
  return query with candidates as (
    select c.object_path from public.prescreening_proof_cleanup c
    order by c.attempted_at nulls first,c.created_at,c.object_path
    limit greatest(1,least(coalesce(p_limit,50),200)) for update skip locked
  )
  update public.prescreening_proof_cleanup c set attempted_at=statement_timestamp()
    from candidates q where c.object_path=q.object_path returning c.object_path;
end $$;
revoke all on function public.prescreening_collect_unused_proofs(integer) from public,anon,authenticated;
grant execute on function public.prescreening_collect_unused_proofs(integer) to service_role;
