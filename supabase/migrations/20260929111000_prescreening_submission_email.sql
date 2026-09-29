-- Additive follow-up: notify the verified booker about successful review holds.
-- Managed Passports are listed in that one email; they receive no separate mail.
alter table public.transactional_email_jobs drop constraint transactional_email_jobs_type_check;
alter table public.transactional_email_jobs add constraint transactional_email_jobs_type_check check (type in (
  'event_rescheduled','event_cancelled','event_updated','payment_failed','payment_expiring',
  'coming_soon_opened','reservation_paid','prescreening_ready','prescreening_rejected','prescreening_submitted'
));

create or replace function public.prescreening_submit(p_actor uuid,p_request jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.prescreening_batches%rowtype; e public.events%rowtype; c public.categories%rowtype;
  p public.runner_passports%rowtype; v_line jsonb; v_count integer; v_intent text; v_proof uuid;
begin
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  if jsonb_typeof(p_request->'participants') is distinct from 'array' or p_request->>'idempotency_key' is null then
    raise exception 'invalid_input' using errcode='22023'; end if;
  v_count:=jsonb_array_length(p_request->'participants');
  v_intent:=p_request->>'checkout_intent';
  if v_count<1 or v_count>10 or v_intent is null or v_intent not in ('entry','reservation') or
    (select count(distinct x->>'participant_passport_id') from jsonb_array_elements(p_request->'participants') x)<>v_count then
    raise exception 'invalid_input' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||':prescreening:'||(p_request->>'idempotency_key'),0));
  select * into b from public.prescreening_batches where booked_by_user_id=p_actor and idempotency_key=(p_request->>'idempotency_key')::uuid;
  if found then
    if b.request_snapshot is distinct from p_request then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return b.id;
  end if;
  select * into e from public.events where id=(p_request->>'event_id')::uuid for update;
  if not found or e.status not in ('coming_soon','open','almost_full') then raise exception 'event_unavailable' using errcode='23514'; end if;
  if v_intent='entry' and (e.status not in ('open','almost_full') or e.registration_closes_at<=statement_timestamp()) then
    raise exception 'registration_closed' using errcode='23514'; end if;
  perform 1 from public.organizations where id=e.org_id and is_active for share;
  if not found then raise exception 'org_suspended' using errcode='23514'; end if;
  perform 1 from public.categories where id in(select (x->>'category_id')::uuid from jsonb_array_elements(p_request->'participants') x) order by id for update;
  perform 1 from public.runner_passports where id in(select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x) order by id for share;
  perform 1 from public.passport_managers where user_id=p_actor and passport_id in(select (x->>'participant_passport_id')::uuid from jsonb_array_elements(p_request->'participants') x) order by passport_id for share;
  insert into public.prescreening_batches(org_id,event_id,booked_by_user_id,idempotency_key,checkout_intent,request_snapshot)
    values(e.org_id,e.id,p_actor,(p_request->>'idempotency_key')::uuid,v_intent,p_request) returning * into b;
  for v_line in select x from jsonb_array_elements(p_request->'participants') x order by x->>'participant_passport_id' loop
    select * into c from public.categories where id=(v_line->>'category_id')::uuid and event_id=e.id and org_id=e.org_id;
    if not found then raise exception 'category_not_found' using errcode='22023'; end if;
    select * into p from public.runner_passports where id=(v_line->>'participant_passport_id')::uuid;
    if not found or (p.claimed_user_id is distinct from p_actor and (p.claimed_user_id is not null or not exists(
      select 1 from public.passport_managers where passport_id=p.id and user_id=p_actor))) then
      raise exception 'participant_not_accessible' using errcode='42501'; end if;
    if exists(select 1 from public.event_capacity_claims(e.id) q where q.participant_passport_id=p.id) then
      raise exception 'participant_already_held' using errcode='23505'; end if;
    if v_intent='reservation' and (not c.reservation_enabled or c.reservation_sales_close_at<=statement_timestamp()) then
      raise exception 'reservations_not_open' using errcode='23514'; end if;
    v_proof:=null;
    if c.prescreening_enabled then
      select id into v_proof from public.prescreening_uploads where id=(v_line->>'proof_upload_id')::uuid
        and category_id=c.id and event_id=e.id and org_id=e.org_id and participant_passport_id=p.id
        and booked_by_user_id=p_actor and verified_at is not null;
      if not found then raise exception 'verified_proof_required' using errcode='23514'; end if;
    end if;
    perform public.assert_category_capacity(c.id,case when v_intent='reservation' then 'reservation' else 'general' end,1);
    insert into public.prescreening_applications(batch_id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,
      participant_name,is_managed,screening_required,requirement_snapshot,proof_upload_id,explanation,decision)
    values(b.id,e.org_id,e.id,c.id,p.id,p_actor,
      coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),'My Race Passport'),p.claimed_user_id is distinct from p_actor,
      c.prescreening_enabled,case when c.prescreening_enabled then c.prescreening_requirement end,v_proof,
      nullif(btrim(v_line->>'explanation'),''),case when c.prescreening_enabled then 'pending' else 'not_required' end);
  end loop;
  perform public.prescreening_refresh_ready(b.id);
  -- Queue only after every participant's hold succeeds. A replay returns above,
  -- and an aborted submission rolls back both capacity and the notification.
  if exists(select 1 from public.prescreening_applications where batch_id=b.id and decision='pending') then
    insert into public.transactional_email_jobs(type,user_id,event_id,dedup_key,payload)
    values('prescreening_submitted',b.booked_by_user_id,b.event_id,'prescreening_submitted:'||b.id,
      jsonb_build_object('batch_id',b.id)) on conflict(dedup_key) do nothing;
  end if;
  return b.id;
end $$;
revoke all on function public.prescreening_submit(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prescreening_submit(uuid,jsonb) to service_role;

-- Local-only until hosted acceptance. Reuse the leased outbox and its worker.
create or replace function public.coming_soon_email_claim(p_limit integer default 20)
returns setof public.transactional_email_jobs language sql security invoker set search_path='' as $$
  with candidates as (
    select id from public.transactional_email_jobs
    where type in ('coming_soon_opened','reservation_paid','prescreening_ready','prescreening_rejected','prescreening_submitted')
      and sent_at is null and attempts<5 and available_at<=now()
      and (lease_expires_at is null or lease_expires_at<=now())
    order by created_at,id for update skip locked limit greatest(1,least(coalesce(p_limit,20),50))
  ) update public.transactional_email_jobs j set lease_token=gen_random_uuid(),
    lease_expires_at=now()+interval '5 minutes',attempts=j.attempts+1
  from candidates c where j.id=c.id returning j.*;
$$;
revoke all on function public.coming_soon_email_claim(integer) from public,anon,authenticated;
grant execute on function public.coming_soon_email_claim(integer) to service_role;

create or replace function public.prescreening_email_status(p_batch uuid)
returns table(id uuid,type text,sent_at timestamptz,attempts integer,last_error text)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.prescreening_batches b where b.id=p_batch and
    (b.booked_by_user_id=auth.uid() or public.auth_can_admin_org(b.org_id))) then
    raise exception 'forbidden' using errcode='42501'; end if;
  return query select j.id,j.type,j.sent_at,j.attempts,j.last_error from public.transactional_email_jobs j
    where j.type in ('prescreening_ready','prescreening_rejected','prescreening_submitted') and j.payload->>'batch_id'=p_batch::text
    order by j.created_at;
end $$;
revoke all on function public.prescreening_email_status(uuid) from public,anon;
grant execute on function public.prescreening_email_status(uuid) to authenticated;
