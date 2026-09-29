-- Local-only until hosted acceptance. Reuse the leased outbox and its worker.
create or replace function public.coming_soon_email_claim(p_limit integer default 20)
returns setof public.transactional_email_jobs language sql security invoker set search_path='' as $$
  with candidates as (
    select id from public.transactional_email_jobs
    where type in ('coming_soon_opened','reservation_paid','prescreening_ready','prescreening_rejected')
      and sent_at is null and attempts<5 and available_at<=now()
      and (lease_expires_at is null or lease_expires_at<=now())
    order by created_at,id for update skip locked limit greatest(1,least(coalesce(p_limit,20),50))
  ) update public.transactional_email_jobs j set lease_token=gen_random_uuid(),
    lease_expires_at=now()+interval '5 minutes',attempts=j.attempts+1
  from candidates c where j.id=c.id returning j.*;
$$;
revoke all on function public.coming_soon_email_claim(integer) from public,anon,authenticated;
grant execute on function public.coming_soon_email_claim(integer) to service_role;

create function public.prescreening_email_status(p_batch uuid)
returns table(id uuid,type text,sent_at timestamptz,attempts integer,last_error text)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.prescreening_batches b where b.id=p_batch and
    (b.booked_by_user_id=auth.uid() or public.auth_can_admin_org(b.org_id))) then
    raise exception 'forbidden' using errcode='42501'; end if;
  return query select j.id,j.type,j.sent_at,j.attempts,j.last_error from public.transactional_email_jobs j
    where j.type in ('prescreening_ready','prescreening_rejected') and j.payload->>'batch_id'=p_batch::text
    order by j.created_at;
end $$;
revoke all on function public.prescreening_email_status(uuid) from public,anon;
grant execute on function public.prescreening_email_status(uuid) to authenticated;

create function public.prescreening_resend_email(p_batch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.prescreening_batches%rowtype; j public.transactional_email_jobs%rowtype;
begin
  select * into b from public.prescreening_batches where id=p_batch and
    (booked_by_user_id=auth.uid() or public.auth_can_admin_org(org_id)) for update;
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into j from public.transactional_email_jobs where type='prescreening_ready' and payload->>'batch_id'=b.id::text
    order by created_at desc limit 1 for update;
  if not found or b.status<>'ready' or b.payment_deadline_at<=statement_timestamp() then
    raise exception 'request_not_payable' using errcode='23514'; end if;
  if j.lease_expires_at>statement_timestamp() or greatest(j.sent_at,j.available_at)>statement_timestamp()-interval '5 minutes' then
    raise exception 'email_retry_later' using errcode='23514'; end if;
  -- A deliberate resend gets a new delivery identity. Transport retries keep
  -- that identity; neither path changes the batch deadline or its capacity.
  update public.transactional_email_jobs set sent_at=null,attempts=0,last_error=null,available_at=statement_timestamp(),
    payload=payload||jsonb_build_object('delivery_id',gen_random_uuid()) where id=j.id;
end $$;
revoke all on function public.prescreening_resend_email(uuid) from public,anon;
grant execute on function public.prescreening_resend_email(uuid) to authenticated;
