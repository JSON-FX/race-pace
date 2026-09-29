-- Local-only until hosted staging acceptance. Review is separate from money
-- reconciliation; only the whole remaining group can become payable.
alter table public.transactional_email_jobs drop constraint transactional_email_jobs_type_check;
alter table public.transactional_email_jobs add constraint transactional_email_jobs_type_check check (type in (
  'event_rescheduled','event_cancelled','event_updated','payment_failed','payment_expiring',
  'coming_soon_opened','reservation_paid','prescreening_ready','prescreening_rejected'
));

create function public.prescreening_refresh_ready(p_batch uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.prescreening_batches%rowtype; e public.events%rowtype; v_deadline timestamptz;
begin
  select * into b from public.prescreening_batches where id=p_batch;
  if not found then raise exception 'request_not_found' using errcode='22023'; end if;
  select * into e from public.events where id=b.event_id for update;
  select * into b from public.prescreening_batches where id=p_batch for update;
  if b.status<>'reviewing' or b.payment_ready_at is not null then return; end if;
  if not exists(select 1 from public.prescreening_applications where batch_id=b.id and released_at is null) then
    update public.prescreening_batches set status='cancelled' where id=b.id; return;
  end if;
  if exists(select 1 from public.prescreening_applications where batch_id=b.id and released_at is null and decision='pending') then return; end if;
  if not exists(select 1 from public.organizations where id=e.org_id and is_active) then return; end if;
  if b.checkout_intent='entry' and e.status not in ('open','almost_full') then return; end if;
  if b.checkout_intent='reservation' and e.status not in ('coming_soon','open','almost_full') then return; end if;
  v_deadline:=statement_timestamp()+interval '72 hours';
  if (b.checkout_intent='entry' and e.registration_closes_at is not null and e.registration_closes_at<v_deadline) or
    (b.checkout_intent='reservation' and exists(select 1 from public.prescreening_applications a join public.categories c on c.id=a.category_id
      where a.batch_id=b.id and a.released_at is null and c.entry_payment_deadline_at<v_deadline)) then
    raise exception 'extend_payment_deadline_before_approval' using errcode='23514';
  end if;
  update public.prescreening_batches set status='ready',payment_ready_at=statement_timestamp(),payment_deadline_at=v_deadline where id=b.id;
  insert into public.transactional_email_jobs(type,user_id,event_id,dedup_key,payload)
  values('prescreening_ready',b.booked_by_user_id,b.event_id,'prescreening_ready:'||b.id,
    jsonb_build_object('batch_id',b.id,'payment_deadline_at',v_deadline)) on conflict(dedup_key) do nothing;
end $$;
revoke all on function public.prescreening_refresh_ready(uuid) from public,anon,authenticated;
grant execute on function public.prescreening_refresh_ready(uuid) to service_role;

create function public.prescreening_submit(p_actor uuid,p_request jsonb) returns uuid
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
  return b.id;
end $$;
revoke all on function public.prescreening_submit(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prescreening_submit(uuid,jsonb) to service_role;

create function public.prescreening_review(p_application uuid,p_decision text,p_reason text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.prescreening_applications%rowtype; b public.prescreening_batches%rowtype;
begin
  select * into a from public.prescreening_applications where id=p_application;
  if not found or not public.auth_can_admin_org(a.org_id) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') or
    (p_decision='rejected' and (nullif(btrim(p_reason),'') is null or length(p_reason)>4000)) then
    raise exception 'rejection_reason_required' using errcode='22023'; end if;
  perform 1 from public.events where id=a.event_id for update;
  select * into b from public.prescreening_batches where id=a.batch_id for update;
  select * into a from public.prescreening_applications where id=p_application for update;
  if a.decision=p_decision then return a.batch_id; end if;
  if a.decision<>'pending' or a.released_at is not null or b.status<>'reviewing' then
    raise exception 'review_already_decided' using errcode='23514'; end if;
  update public.prescreening_applications set decision=p_decision,reviewed_by_user_id=auth.uid(),reviewed_at=statement_timestamp(),
    rejection_reason=case when p_decision='rejected' then btrim(p_reason) end,
    released_at=case when p_decision='rejected' then statement_timestamp() end where id=a.id;
  if p_decision='rejected' then
    insert into public.transactional_email_jobs(type,user_id,event_id,dedup_key,payload)
    values('prescreening_rejected',a.booked_by_user_id,a.event_id,'prescreening_rejected:'||a.id,
      jsonb_build_object('batch_id',a.batch_id,'application_id',a.id,'rejection_reason',btrim(p_reason)))
    on conflict(dedup_key) do nothing;
  end if;
  if p_decision='rejected' then
    -- Releasing a rejected participant must not depend on a different runner's
    -- payment deadline. Maintenance retries readiness after the organizer extends it.
    begin
      perform public.prescreening_refresh_ready(a.batch_id);
    exception when check_violation then
      if sqlerrm<>'extend_payment_deadline_before_approval' then raise; end if;
    end;
  else
    perform public.prescreening_refresh_ready(a.batch_id);
  end if;
  return a.batch_id;
end $$;
revoke all on function public.prescreening_review(uuid,text,text) from public,anon;
grant execute on function public.prescreening_review(uuid,text,text) to authenticated;

create function public.prescreening_window_immutable() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.payment_ready_at is not null and (new.payment_ready_at,new.payment_deadline_at) is distinct from (old.payment_ready_at,old.payment_deadline_at) then
    raise exception 'prescreening_payment_window_immutable' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.prescreening_window_immutable() from public,anon,authenticated;
create trigger prescreening_window_immutable before update on public.prescreening_batches for each row execute function public.prescreening_window_immutable();
