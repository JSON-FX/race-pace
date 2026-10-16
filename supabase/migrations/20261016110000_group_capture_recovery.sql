-- This migration has only run locally; it has not been applied to hosted projects.
-- A pre-screening SQL alias shadowed the payment-attempt record and rolled back
-- both capture evidence and registration fulfillment. Observe evidence in its
-- own RPC transaction, then retry the original atomic fulfillment from that row.
alter table public.booking_payment_captures
  add column attempts integer not null default 0 check(attempts>=0),
  add column last_error_code text,
  add column last_attempt_at timestamptz;
create index booking_payment_captures_received on public.booking_payment_captures(attempt_id,created_at) where state='received';
create index booking_payment_captures_order_state on public.booking_payment_captures(booking_order_id,state);

create function public.booking_payment_capture_observe(p_attempt uuid,p_capture jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare v_attempt public.booking_payment_attempts%rowtype; v_order public.booking_orders%rowtype;
  v_capture public.booking_payment_captures%rowtype;
begin
  if jsonb_typeof(p_capture) is distinct from 'object' or coalesce(p_capture->>'paymentId','') !~ '^pay_[A-Za-z0-9_-]+$'
    then raise exception 'invalid_capture_identity' using errcode='22023'; end if;
  perform 1 from public.events where id=(select bo.event_id from public.booking_orders bo
    join public.booking_payment_attempts ba on ba.booking_order_id=bo.id where ba.id=p_attempt) for update;
  select * into v_attempt from public.booking_payment_attempts where id=p_attempt;
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
  select * into v_order from public.booking_orders where id=v_attempt.booking_order_id for update;
  perform 1 from public.booking_payment_attempts where id=p_attempt for update;
  perform pg_advisory_xact_lock(hashtextextended('capture:'||(p_capture->>'paymentId'),0));
  select * into v_capture from public.booking_payment_captures where payment_id=p_capture->>'paymentId';
  if found then
    if v_capture.attempt_id<>p_attempt then raise exception 'capture_identity_conflict' using errcode='23514'; end if;
    -- A replay can carry different provider expansions. The first evidence wins.
    return v_capture.state;
  end if;
  insert into public.booking_payment_captures(org_id,booking_order_id,attempt_id,payment_id,capture)
    values(v_order.org_id,v_order.id,p_attempt,p_capture->>'paymentId',p_capture);
  return 'received';
end $$;

create function public.booking_payment_capture_failure(p_attempt uuid,p_payment_id text,p_error_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_error_code is null or p_error_code !~ '^[A-Za-z0-9_]{1,80}$'
    then raise exception 'invalid_failure_code' using errcode='22023'; end if;
  update public.booking_payment_captures set attempts=attempts+1,
    last_error_code=p_error_code,last_attempt_at=clock_timestamp()
    where attempt_id=p_attempt and payment_id=p_payment_id and state='received';
end $$;

revoke all on function public.booking_payment_capture_observe(uuid,jsonb),
  public.booking_payment_capture_failure(uuid,text,text) from public,anon,authenticated;
grant execute on function public.booking_payment_capture_observe(uuid,jsonb),
  public.booking_payment_capture_failure(uuid,text,text) to service_role;


CREATE OR REPLACE FUNCTION public.booking_payment_confirm(p_attempt uuid, p_capture jsonb, p_tokens jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
  c public.booking_payment_captures%rowtype; v_n integer; v_reason text; v_fee integer;
  v_provider_managed boolean; v_excess integer:=0; v_reserved_paid_at timestamptz;
begin
  perform 1 from public.events where id=(select lock_order.event_id from public.booking_orders lock_order join public.booking_payment_attempts lock_attempt on lock_attempt.booking_order_id=lock_order.id where lock_attempt.id=p_attempt) for update;
  select * into a from public.booking_payment_attempts where id=p_attempt;
  if not found then raise exception 'attempt_not_found' using errcode='22023'; end if;
  select * into o from public.booking_orders where id=a.booking_order_id;
  perform 1 from public.categories cat where cat.id in
    (select distinct r.category_id from public.registrations r where r.booking_order_id=o.id)
    order by cat.id for update;
  select * into o from public.booking_orders where id=a.booking_order_id for update;
  select * into a from public.booking_payment_attempts where id=p_attempt for update;
  v_provider_managed:=coalesce((a.terms_snapshot->>'provider_managed_fee')::boolean,false);
  select * into d from public.booking_payment_dispatches where attempt_id=p_attempt;
  if p_capture->>'paymentId' is null or p_capture->>'paymentId' !~ '^pay_'
  then raise exception 'invalid_capture_identity' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('capture:'||(p_capture->>'paymentId'),0));
  select * into c from public.booking_payment_captures where payment_id=p_capture->>'paymentId';
  if found then
    if c.attempt_id<>a.id then raise exception 'capture_identity_conflict' using errcode='23514'; end if;
    if c.state<>'received' then return c.state; end if;
    -- Confirmation must consume the independently committed provider evidence.
    p_capture:=c.capture;
  else
    -- Compatibility for older Edge bundles during an additive deployment.
    insert into public.booking_payment_captures(org_id,booking_order_id,attempt_id,payment_id,capture)
      values(o.org_id,o.id,a.id,p_capture->>'paymentId',p_capture) returning * into c;
  end if;
  if exists(select 1 from public.booking_payment_captures where booking_order_id=o.id and state='fulfilled')
  then v_reason:='extra_capture';
  elsif p_capture->>'invalidReason' is not null then v_reason:='invalid_provider_capture';
  elsif d.session_id is null or p_capture->>'sessionId' is distinct from d.session_id
    or p_capture->>'attemptId' is distinct from a.id::text or p_capture->>'orderId' is distinct from o.id::text
    or p_capture->>'currency' is distinct from 'PHP' or (p_capture->>'livemode')::boolean is distinct from d.livemode
    or (v_provider_managed and ((p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint
      < a.gross_cents::bigint or (p_capture->>'amount')::bigint-(p_capture->>'feeCents')::bigint>a.gross_cents::bigint+1))
    or (not v_provider_managed and (p_capture->>'amount')::bigint is distinct from a.gross_cents::bigint)
  then v_reason:='capture_mismatch';
  elsif o.status not in ('pending','expired') then v_reason:='order_not_confirmable';
  end if;
  perform 1 from public.registrations where booking_order_id=o.id order by id for update;
  select count(*) into v_n from public.booking_payment_quote_lines where attempt_id=a.id;
  if v_reason is null and (v_n<1 or v_n>10 or v_n<>(select count(*) from public.registrations where booking_order_id=o.id)
    or exists(select 1 from public.booking_payment_quote_lines q left join public.registrations r on r.id=q.registration_id
      where q.attempt_id=a.id and (r.id is null or r.booking_order_id<>o.id or r.status not in ('pending','expired') or r.total_amount<>q.base_cents))
    or (select sum(gross_cents) from public.booking_payment_quote_lines where attempt_id=a.id)<>a.gross_cents)
  then v_reason:='order_entries_changed'; end if;
  if v_reason is null and (not exists(select 1 from public.events where id=o.event_id and status in ('open','almost_full'))
    or not exists(select 1 from public.organizations where id=o.org_id and is_active))
  then v_reason:='event_unavailable'; end if;
  if v_reason is null and exists(select 1 from public.registrations r join public.registrations other
    on other.event_id=r.event_id and other.participant_passport_id=r.participant_passport_id and other.id<>r.id
    where r.booking_order_id=o.id and other.status in ('pending','paid'))
  then v_reason:='participant_already_registered'; end if;
  if v_reason is null and exists(
    select 1 from public.categories cat
    join (select category_id,count(*)::integer needed from public.registrations where booking_order_id=o.id group by category_id) wanted
      on wanted.category_id=cat.id
    where (select count(*) from public.registrations other where other.category_id=cat.id
      and other.booking_order_id is distinct from o.id and (other.status='paid' or
        (other.status='pending' and (other.expires_at is null or other.expires_at>statement_timestamp()))))
      +wanted.needed>cat.slots_total)
  then v_reason:='capacity_unavailable'; end if;
  -- Group fulfillment must use the provider's capture time for every held
  -- Passport place. Without a verified paidAt, reconcile instead of issuing
  -- tickets after a reservation deadline.
  if v_reason is null and exists (
    select 1 from public.registrations r where r.booking_order_id=o.id
      and r.event_reservation_id is not null
  ) then
    if coalesce(p_capture->>'paidAt','') !~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      v_reason:='reservation_capture_time_missing';
    else
      begin
        v_reserved_paid_at:=(p_capture->>'paidAt')::timestamptz;
      exception when invalid_datetime_format or datetime_field_overflow then
        v_reason:='invalid_capture_time';
      end;
    end if;
    if v_reason is null and exists (
      select 1 from public.registrations r
        left join public.event_reservations er on er.id=r.event_reservation_id
        where r.booking_order_id=o.id and r.event_reservation_id is not null
          and (er.id is null or er.status<>'paid' or er.user_id<>o.booked_by_user_id
            or v_reserved_paid_at>coalesce((select greatest(p.entry_payment_deadline_at,cat.entry_payment_deadline_at)
              from public.event_reservation_places p join public.categories cat on cat.id=p.category_id
              where p.reservation_id=er.id and p.participant_passport_id=r.participant_passport_id),er.registration_deadline_at)
            or (exists (select 1 from public.event_reservation_places p
                  where p.reservation_id=er.id)
              and not exists (select 1 from public.event_reservation_places p
                where p.reservation_id=er.id and p.participant_passport_id=r.participant_passport_id
                  and p.status='held')))
    ) then v_reason:='reservation_deadline_passed'; end if;
  end if;
  -- A provider callback can arrive later than its capture. Require an actual
  -- capture time within the original window and a hold that was never released.
  if v_reason is null and o.reservation_request->>'prescreening_batch_id' is not null then
    begin
      v_reserved_paid_at:=(p_capture->>'paidAt')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_reserved_paid_at:=null;
    end;
    if v_reserved_paid_at is null or not exists(select 1 from public.prescreening_batches b
      where b.id=(o.reservation_request->>'prescreening_batch_id')::uuid and b.booking_order_id=o.id
      and b.status='ready' and b.checkout_intent='entry' and v_reserved_paid_at<=b.payment_deadline_at
      and not exists(select 1 from public.prescreening_applications screening where screening.batch_id=b.id
        and screening.decision<>'rejected' and (screening.released_at is not null or screening.decision not in ('approved','not_required')))) then
      v_reason:='prescreening_payment_window_ended';
    end if;
  end if;
  if v_reason is null and (jsonb_typeof(p_tokens) is distinct from 'object' or
    exists(select 1 from public.booking_payment_quote_lines where attempt_id=a.id and coalesce(length(p_tokens->>registration_id::text),0)<20))
  then raise exception 'ticket_tokens_required' using errcode='22023'; end if;
  v_fee:=(p_capture->>'feeCents')::integer;
  if v_reason is null and (v_fee is null or v_fee<0 or v_fee>(p_capture->>'amount')::bigint)
  then v_reason:='invalid_processor_fee'; end if;
  if v_reason is null and v_provider_managed then v_excess:=(p_capture->>'amount')::integer-v_fee-a.gross_cents; end if;
  if v_reason is null then
    begin
      update public.registrations set status='paid',expires_at=null,ticket_token=p_tokens->>id::text where booking_order_id=o.id;
      with used as (select category_id,count(*)::integer n from public.registrations where booking_order_id=o.id group by category_id)
      update public.categories cat set slots_taken=cat.slots_taken+used.n from used where cat.id=used.category_id;
      with parts as (
        select q.*,case when a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents/a.gross_cents end part,
          case when a.gross_cents=0 then 0 else v_fee::bigint*q.gross_cents%a.gross_cents end rem
        from public.booking_payment_quote_lines q where attempt_id=a.id
      ), ranked as (select *,row_number() over(order by rem desc,registration_id) rn,sum(part) over() parts from parts),
      allocated as (select *,part+case when rn<=v_fee-parts then 1 else 0 end fee from ranked)
      insert into public.booking_payment_allocations(capture_id,org_id,registration_id,gross_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents)
        select c.id,o.org_id,registration_id,
          gross_cents+case when v_provider_managed then fee else 0 end+
            case when v_provider_managed and registration_id=(select q.registration_id from public.booking_payment_quote_lines q where q.attempt_id=a.id and q.gross_cents>0 order by q.registration_id limit 1) then v_excess else 0 end,
          platform_fee_cents,fee,
          gross_cents::bigint+case when v_provider_managed then fee else 0 end+
            case when v_provider_managed and registration_id=(select q.registration_id from public.booking_payment_quote_lines q where q.attempt_id=a.id and q.gross_cents>0 order by q.registration_id limit 1) then v_excess else 0 end-platform_fee_cents-fee
        from allocated;
      update public.booking_orders set status='paid',expires_at=null where id=o.id;
      update public.booking_payment_attempts set status='paid' where id=a.id;
      update public.booking_payment_captures set state='fulfilled' where id=c.id;
      insert into public.booking_order_deliveries(booking_order_id,org_id) values(o.id,o.org_id);
      return 'fulfilled';
    exception when unique_violation or check_violation then v_reason:='fulfillment_conflict';
    end;
  end if;
  update public.booking_payment_captures set state='reconciliation_required',reason=v_reason where id=c.id;
  if o.status<>'paid' then
    update public.booking_orders set status='reconciliation_required' where id=o.id;
    update public.booking_payment_attempts set status='reconciliation_required' where id=a.id;
  end if;
  return 'reconciliation_required';
end $function$;

revoke all on function public.booking_payment_confirm(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.booking_payment_confirm(uuid,jsonb,jsonb) to service_role;

-- The evidence table stays private. This projection returns one state per order
-- and checks tenant/booker scope before exposing safe operational diagnostics.
create function public.booking_payment_progress(p_orders uuid[])
returns table(booking_order_id uuid,attempt_id uuid,state text,received_at timestamptz,
  attempts integer,last_error_code text,last_attempt_at timestamptz)
language sql stable security definer set search_path='' as $$
  select bo.id,bc.attempt_id,
    case bc.state when 'received' then 'processing' when 'fulfilled' then 'paid' else 'review_required' end,
    bc.created_at,
    case when public.auth_can_admin_org(bo.org_id) then bc.attempts end,
    case when public.auth_can_admin_org(bo.org_id) then coalesce(bc.last_error_code,bc.reason) end,
    case when public.auth_can_admin_org(bo.org_id) then bc.last_attempt_at end
  from public.booking_orders bo
  join lateral (select capture_row.* from public.booking_payment_captures capture_row
    where capture_row.booking_order_id=bo.id
    order by case capture_row.state when 'reconciliation_required' then 0 when 'received' then 1 else 2 end,
      capture_row.created_at,capture_row.id limit 1) bc on true
  where bo.id=any(p_orders) and (bo.booked_by_user_id=auth.uid() or public.auth_can_admin_org(bo.org_id));
$$;
revoke all on function public.booking_payment_progress(uuid[]) from public,anon;
grant execute on function public.booking_payment_progress(uuid[]) to authenticated;

create table public.booking_payment_retry_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  booking_order_id uuid not null references public.booking_orders(id) on delete cascade,
  attempt_id uuid not null references public.booking_payment_attempts(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default clock_timestamp()
);
alter table public.booking_payment_retry_audit enable row level security;
revoke all on public.booking_payment_retry_audit from public,anon,authenticated;
grant select,insert,delete on public.booking_payment_retry_audit to service_role;

create function public.booking_payment_retry(p_attempt uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_attempt public.booking_payment_attempts%rowtype; v_session text;
begin
  select * into v_attempt from public.booking_payment_attempts where id=p_attempt;
  if not found or auth.uid() is null or not public.auth_can_admin_org(v_attempt.org_id)
    then raise exception 'forbidden' using errcode='42501'; end if;
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=v_attempt.booking_order_id) for update;
  perform 1 from public.booking_orders where id=v_attempt.booking_order_id for update;
  perform 1 from public.booking_payment_attempts where id=p_attempt for update;
  if not exists(select 1 from public.booking_payment_captures where attempt_id=p_attempt and state='received')
    or exists(select 1 from public.booking_payment_captures where booking_order_id=v_attempt.booking_order_id and state<>'received')
    then raise exception 'payment_not_retryable' using errcode='22023'; end if;
  select session_id into v_session from public.booking_payment_dispatches where attempt_id=p_attempt;
  if v_session is null then raise exception 'payment_not_retryable' using errcode='22023'; end if;
  insert into public.booking_payment_retry_audit(org_id,booking_order_id,attempt_id,requested_by)
    values(v_attempt.org_id,v_attempt.booking_order_id,p_attempt,auth.uid());
  insert into public.payment_reconciliation_checks(kind,subject_id,org_id,session_id)
    values('group',p_attempt,v_attempt.org_id,v_session)
    on conflict(kind,subject_id) do update set attempted_at=null,outcome=null,lease=null;
  return true;
end $$;
revoke all on function public.booking_payment_retry(uuid) from public,anon;
grant execute on function public.booking_payment_retry(uuid) to authenticated;

-- Select received evidence even if a provider-expiry outcome or an older bundle
-- changed the attempt status. No provider GET is needed to fulfill this work.
create or replace view public.payment_reconciliation_pending_v with (security_invoker=true) as
select 'single'::text kind,p.registration_id subject_id,p.org_id,p.provider_ref session_id
from public.payments p where p.provider='paymongo' and p.status='pending' and p.provider_ref like 'cs_%'
union all
select 'reservation',p.reservation_id,p.org_id,p.provider_ref
from public.reservation_payments p where p.provider='paymongo' and p.status='pending' and p.provider_ref like 'cs_%'
union all
select 'group',ba.id,ba.org_id,bd.session_id
from public.booking_payment_attempts ba join public.booking_payment_dispatches bd on bd.attempt_id=ba.id
where bd.session_id like 'cs_%' and (ba.status in ('creating','creation_unknown','ready')
  or exists(select 1 from public.booking_payment_captures bc where bc.attempt_id=ba.id and bc.state='received'));
revoke all on public.payment_reconciliation_pending_v from public,anon,authenticated;
grant select on public.payment_reconciliation_pending_v to service_role;

create or replace function public.payment_reconciliation_claim(p_limit integer default 20)
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
      and (coalesce(q.outcome,'') not in ('review_required','reconciliation_required')
        or (q.kind='group' and exists(select 1 from public.booking_payment_captures bc where bc.attempt_id=q.subject_id and bc.state='received')))
    order by q.attempted_at nulls first,q.kind,q.subject_id
    limit greatest(1,least(coalesce(p_limit,20),20)) for update of q skip locked
  ) update public.payment_reconciliation_checks q
    set attempted_at=clock_timestamp(),lease=gen_random_uuid()
    from picked p where q.kind=p.kind and q.subject_id=p.subject_id
    returning q.kind,q.subject_id,q.session_id,q.lease;
end $$;

create or replace function public.payment_reconciliation_alerts() returns void
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
  if issue is null and exists(select 1 from public.booking_payment_captures
    where state<>'fulfilled' and created_at<now()-interval '20 minutes') then
    issue:='payment_reconciliation_overdue';
  end if;
  if issue is null then return; end if;
  insert into public.notifications(user_id,type,title,body,data,dedup_key)
  select distinct ur.user_id,'payment_review'::public.notification_type,'Payment synchronization needs attention',
    'Check PayMongo webhook delivery and the payment reconciliation worker. Captured payments may need recovery.',
    jsonb_build_object('reason',issue),
    'payment-sync:'||issue||':'||current_date::text||':'||ur.user_id::text
  from public.user_roles ur where ur.role='super_admin'
  on conflict(dedup_key) do nothing;
end $$;

revoke all on function public.payment_reconciliation_claim(integer),public.payment_reconciliation_alerts() from public,anon,authenticated;
grant execute on function public.payment_reconciliation_claim(integer),public.payment_reconciliation_alerts() to service_role;

-- Inbox evidence owns the hold independently of attempt status.

CREATE OR REPLACE FUNCTION public.booking_order_prepare_payment(p_actor uuid, p_order uuid, p_method text, p_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.booking_orders%rowtype; v_org public.organizations%rowtype;
  v_attempt public.booking_payment_attempts%rowtype; v_rate public.processor_rates%rowtype;
  v_method text := case when p_method='maya' then 'paymaya' else p_method end;
  v_lines jsonb; v_count bigint; v_base bigint; v_commission bigint;
  v_target bigint; v_gross bigint; v_surcharge bigint; v_predicted bigint;
  v_terms jsonb; v_modes integer;
begin
  perform 1 from public.events where id=(select event_id from public.booking_orders where id=p_order) for update;
  if p_key is null or p_order is null or v_method is null or v_method not in ('card','gcash','paymaya','qrph')
  then raise exception 'invalid_input' using errcode='22023'; end if;
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payment:'||p_actor::text||':'||p_key::text,0));
  select * into v_order from public.booking_orders where id=p_order and booked_by_user_id=p_actor for update;
  if not found then raise exception 'order_not_found' using errcode='42501'; end if;
  if exists(select 1 from public.booking_payment_captures where booking_order_id=p_order)
    then raise exception 'payment_capture_unresolved' using errcode='22023'; end if;
  if v_order.status<>'pending' then raise exception 'order_not_pending' using errcode='22023'; end if;
  if v_order.expires_at is null or v_order.expires_at<=statement_timestamp()
  then raise exception 'hold_expired' using errcode='22023'; end if;
  perform 1 from public.events where id=v_order.event_id and org_id=v_order.org_id and status in ('open','almost_full') for share;
  if not found then raise exception 'registration_closed' using errcode='22023'; end if;
  select * into v_org from public.organizations where id=v_order.org_id for share;
  if not v_org.is_active then raise exception 'org_suspended' using errcode='22023'; end if;
  perform 1 from public.registrations where booking_order_id=p_order order by id for share;
  select count(*),coalesce(sum(total_amount),0) into v_count,v_base from public.registrations where booking_order_id=p_order;
  if v_count<1 or v_count>10 or v_count is distinct from jsonb_array_length(v_order.reservation_request->'participants')
    or (select sum(coalesce(discount_original_cents,total_amount)) from public.registrations where booking_order_id=p_order) is distinct from v_order.entry_total_cents or exists(select 1 from public.registrations r where booking_order_id=p_order
      and (r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp() or r.total_amount<0
        or r.event_id<>v_order.event_id or r.org_id<>v_order.org_id))
  then raise exception 'order_entries_changed' using errcode='22023'; end if;

  select * into v_attempt from public.booking_payment_attempts where booked_by_user_id=p_actor and idempotency_key=p_key for update;
  if found then
    if v_attempt.booking_order_id<>p_order or v_attempt.method<>v_method
    then raise exception 'idempotency_conflict' using errcode='22023'; end if;
    return public.booking_payment_preparation_result(v_attempt.id);
  end if;
  if exists(select 1 from public.booking_payment_attempts where booking_order_id=p_order and status not in ('failed','expired'))
  then raise exception 'payment_attempt_in_progress' using errcode='22023'; end if;
  select count(distinct coalesce(discount_snapshot->>'fee_mode',v_org.fee_mode)) into v_modes
    from public.registrations where booking_order_id=p_order and total_amount>0;
  if v_modes>1 then raise exception 'discount_mixed_fee_modes'; end if;
  select coalesce(min(coalesce(discount_snapshot->>'fee_mode',v_org.fee_mode)),v_org.fee_mode) into v_org.fee_mode
    from public.registrations where booking_order_id=p_order and total_amount>0;
  if v_org.commission_rate<0 or v_org.commission_flat_cents<0
  then raise exception 'invalid_terms' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',r.id,'base',r.total_amount,'fee',
    least(r.total_amount,case when v_org.commission_type='fixed' then v_org.commission_flat_cents
      else round(r.total_amount::numeric*coalesce(v_org.commission_rate,0.10))::bigint end)) order by r.id)
    into v_lines from public.registrations r where r.booking_order_id=p_order;
  select sum((x->>'fee')::bigint) into v_commission from jsonb_array_elements(v_lines) x;
  if v_base>0 and v_org.fee_mode='absorb' then
    select * into v_rate from public.processor_rates where provider='paymongo' and method=v_method and scope='local'
      and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())
      order by effective_from desc,id limit 1 for share;
    if not found then raise exception 'rate_card_missing' using errcode='22023'; end if;
    if v_rate.percent_bps>=10000 then raise exception 'invalid_processor_rate' using errcode='22023'; end if;
  end if;
  v_target := v_base+case when v_org.fee_mode='pass_on' then v_commission else 0 end;
  v_gross := case when v_base=0 then 0 when v_org.fee_mode='absorb' then v_base else v_target end;
  v_surcharge := case when v_org.fee_mode='pass_on' then v_gross-v_target else 0 end;
  v_predicted := case when v_gross=0 or v_org.fee_mode='pass_on' then 0
    else (v_gross*v_rate.percent_bps+5000)/10000+v_rate.fixed_cents end;
  if greatest(v_base,v_commission,v_gross,v_surcharge,v_predicted)>2147483647
  then raise exception 'order_amount_too_large' using errcode='22023'; end if;
  if v_gross>0 and v_gross<100 then raise exception 'discount_balance_too_small'; end if;
  if v_gross-v_commission-v_predicted<0 then raise exception 'discount_fees_exceed_balance'; end if;
  v_terms := jsonb_build_object('fee_mode',v_org.fee_mode,'commission_type',v_org.commission_type,
    'commission_bps',round(coalesce(v_org.commission_rate,0.10)*10000),'commission_flat_cents',v_org.commission_flat_cents,
    'rate_id',v_rate.id,'percent_bps',coalesce(v_rate.percent_bps,0),'fixed_cents',coalesce(v_rate.fixed_cents,0),
    'provider_managed_fee',v_org.fee_mode='pass_on', 'discounts',(select jsonb_agg(jsonb_build_object('registration_id',id,'snapshot',discount_snapshot,'discount_cents',discount_amount_cents)) from public.registrations where booking_order_id=p_order));
  insert into public.booking_payment_attempts(org_id,booking_order_id,booked_by_user_id,idempotency_key,method,
    terms_snapshot,base_cents,platform_fee_cents,processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
  values(v_order.org_id,p_order,p_actor,p_key,v_method,v_terms,v_base,v_commission,v_surcharge,v_gross,v_predicted,v_gross-v_commission-v_predicted)
  returning * into v_attempt;

  -- First allocate surcharge on pre-processor payable weights, then allocate
  -- predicted processor cost on final gross. Stable UUID ties preserve centavos.
  with entries as (
    select (x->>'id')::uuid id,(x->>'base')::bigint base,(x->>'fee')::bigint fee,
      (x->>'base')::bigint+case when v_org.fee_mode='pass_on' then (x->>'fee')::bigint else 0 end weight
    from jsonb_array_elements(v_lines) x
  ), surcharge_floor as (
    select *,case when v_target=0 then 0 else v_surcharge*weight/v_target end part,
      case when v_target=0 then 0 else v_surcharge*weight%v_target end remainder from entries
  ), surcharge_ranked as (
    select *,row_number() over(order by remainder desc,id) rn,sum(part) over() parts from surcharge_floor
  ), gross_lines as (
    select *,part+case when rn<=v_surcharge-parts then 1 else 0 end surcharge,
      weight+part+case when rn<=v_surcharge-parts then 1 else 0 end gross from surcharge_ranked
  ), fee_floor as (
    select *,case when v_gross=0 then 0 else v_predicted*gross/v_gross end fee_part,
      case when v_gross=0 then 0 else v_predicted*gross%v_gross end fee_remainder from gross_lines
  ), fee_ranked as (
    select *,row_number() over(order by fee_remainder desc,id) fee_rn,sum(fee_part) over() fee_parts from fee_floor
  ), final as (
    select *,fee_part+case when fee_rn<=v_predicted-fee_parts then 1 else 0 end processor from fee_ranked
  ) insert into public.booking_payment_quote_lines(attempt_id,org_id,registration_id,base_cents,platform_fee_cents,
    processor_surcharge_cents,gross_cents,processor_fee_predicted_cents,net_to_org_predicted_cents)
    select v_attempt.id,v_order.org_id,id,base,fee,surcharge,gross,processor,gross-fee-processor from final;
  return public.booking_payment_preparation_result(v_attempt.id);
end $function$;

CREATE OR REPLACE FUNCTION public.booking_payment_claim_dispatch(p_actor uuid, p_attempt uuid, p_request jsonb, p_livemode boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.booking_payment_attempts%rowtype; o public.booking_orders%rowtype; d public.booking_payment_dispatches%rowtype;
begin
  perform 1 from public.events where id=(select lock_order.event_id from public.booking_orders lock_order join public.booking_payment_attempts lock_attempt on lock_attempt.booking_order_id=lock_order.id where lock_attempt.id=p_attempt) for update;
  perform 1 from auth.users where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false) for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;
  select * into a from public.booking_payment_attempts where id=p_attempt and booked_by_user_id=p_actor;
  if not found then raise exception 'attempt_not_found' using errcode='42501'; end if;
  select * into o from public.booking_orders where id=a.booking_order_id for update;
  select * into a from public.booking_payment_attempts where id=p_attempt for update;
  if exists(select 1 from public.booking_payment_captures where booking_order_id=o.id)
    then raise exception 'payment_capture_unresolved' using errcode='22023'; end if;
  if o.status<>'pending' or o.expires_at<=statement_timestamp() or o.expires_at is null
  then raise exception 'order_not_payable' using errcode='22023'; end if;
  if a.gross_cents=0 then raise exception 'free_order_requires_confirmation' using errcode='22023'; end if;
  perform 1 from public.organizations where id=o.org_id and is_active for share;
  if not found then raise exception 'org_suspended' using errcode='22023'; end if;
  perform 1 from public.events where id=o.event_id and status in ('open','almost_full') for share;
  if not found then raise exception 'registration_closed' using errcode='22023'; end if;
  perform 1 from public.registrations where booking_order_id=o.id order by id for share;
  if (select count(*) from public.registrations where booking_order_id=o.id) <>
      (select count(*) from public.booking_payment_quote_lines where attempt_id=a.id)
    or exists(select 1 from public.booking_payment_quote_lines q left join public.registrations r on r.id=q.registration_id
      where q.attempt_id=a.id and (r.id is null or r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp()
      or r.total_amount<>q.base_cents or r.booking_order_id<>o.id))
  then raise exception 'order_entries_changed' using errcode='22023'; end if;
  select * into d from public.booking_payment_dispatches where attempt_id=a.id;
  if found then
    if d.request_body is distinct from p_request or d.livemode is distinct from p_livemode
    then raise exception 'dispatch_request_changed' using errcode='22023'; end if;
    return jsonb_build_object('action',case when d.state='ready' then 'ready' else 'pending' end,'checkout_url',d.checkout_url);
  end if;
  if a.status<>'prepared' then raise exception 'attempt_not_prepared' using errcode='22023'; end if;
  if p_request#>>'{data,attributes,metadata,booking_order_id}' is distinct from o.id::text
    or p_request#>>'{data,attributes,metadata,payment_attempt_id}' is distinct from a.id::text
    or p_request#>'{data,attributes,payment_method_types}' is distinct from jsonb_build_array(a.method)
    or coalesce((p_request#>>'{data,attributes,pass_on_fees}')::boolean,false) is distinct from
      coalesce((a.terms_snapshot->>'provider_managed_fee')::boolean,false)
    or (select sum((x->>'amount')::bigint*(x->>'quantity')::bigint) from jsonb_array_elements(p_request#>'{data,attributes,line_items}') x) is distinct from a.gross_cents::numeric
    or exists(select 1 from jsonb_array_elements(p_request#>'{data,attributes,line_items}') x
      where x->>'currency' is distinct from 'PHP' or (x->>'amount')::bigint<0 or (x->>'quantity')::integer<>1)
  then raise exception 'invalid_provider_request' using errcode='22023'; end if;
  insert into public.booking_payment_dispatches(attempt_id,org_id,request_body,livemode) values(a.id,a.org_id,p_request,p_livemode);
  update public.booking_payment_attempts set status='creating' where id=a.id;
  return jsonb_build_object('action','dispatch');
end $function$;

create or replace function public.discount_apply(p_actor uuid,p_registration uuid,p_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.registrations%rowtype; d public.discount_codes%rowtype; p public.payments%rowtype; o public.organizations%rowtype;
 original integer; eligible integer; savings integer:=0; fee integer; mode text; snap jsonb; uses integer;
begin
 perform 1 from public.events where id=(select event_id from public.registrations where id=p_registration) for update;
 select * into r from public.registrations where id=p_registration for update;
 if not found or coalesce(r.booked_by_user_id,r.user_id)<>p_actor then raise exception 'registration_not_found'; end if;
 if r.status<>'pending' or r.expires_at is null or r.expires_at<=statement_timestamp() then raise exception 'hold_expired'; end if;
 select * into o from public.organizations where id=r.org_id for share;
 if not o.is_active then raise exception 'org_suspended'; end if;
 if not exists(select 1 from public.events where id=r.event_id and status in ('open','almost_full')) then raise exception 'registration_closed'; end if;
 if r.booking_order_id is not null then
  perform 1 from public.booking_orders where id=r.booking_order_id for update;
  if exists(select 1 from public.booking_payment_captures where booking_order_id=r.booking_order_id) then raise exception 'discount_payment_locked'; end if;
  if exists(select 1 from public.booking_payment_attempts where booking_order_id=r.booking_order_id and status not in ('failed','expired','prepared')) then raise exception 'discount_payment_locked'; end if;
  -- A prepared quote has never reached PayMongo and can be replaced safely.
  update public.booking_payment_attempts set status='expired' where booking_order_id=r.booking_order_id and status='prepared';
 else
  select * into p from public.payments where registration_id=r.id for update;
  if not found or p.status<>'pending' or p.discount_checkout_state is distinct from 'prepared' or p.provider_ref is not null then raise exception 'discount_payment_locked'; end if;
 end if;
 original:=coalesce(r.discount_original_cents,r.total_amount);
 mode:=o.fee_mode;
 if nullif(btrim(p_code),'') is not null then
  select * into d from public.discount_codes where org_id=r.org_id and code=upper(btrim(p_code)) for update;
  if not found then raise exception 'discount_invalid'; end if;
  if r.discount_code=d.code then return jsonb_build_object('code',r.discount_code,'discount_cents',r.discount_amount_cents,'total_cents',r.total_amount,'snapshot',r.discount_snapshot); end if;
  if not d.active or (d.starts_at is not null and d.starts_at>statement_timestamp()) or (d.ends_at is not null and d.ends_at<=statement_timestamp()) then raise exception 'discount_inactive'; end if;
  if d.scope='events' and not r.event_id=any(d.event_ids) or d.scope='categories' and not r.category_id=any(d.category_ids) then raise exception 'discount_ineligible'; end if;
  if d.assigned_passport_id is not null and d.assigned_passport_id<>r.participant_passport_id then raise exception 'discount_wrong_passport'; end if;
  if exists(select 1 from public.discount_redemptions where code_id=d.id and passport_id=r.participant_passport_id and state<>'released') then raise exception 'discount_already_used'; end if;
  select count(*) into uses from public.discount_redemptions where code_id=d.id and state<>'released';
  if d.max_uses is not null and uses>=d.max_uses then raise exception 'discount_exhausted'; end if;
    -- Add-ons are already frozen on registration; derive entry from that frozen
  -- total so later category price edits cannot enlarge the eligible amount.
  eligible:=case when d.coverage='subtotal' then original else greatest(0,original-coalesce((select sum(price)::integer from public.registration_addons where registration_id=r.id),0)) end;
  savings:=least(eligible,case when d.discount_type='flat' then d.value else round(eligible::numeric*d.value/10000)::integer end);
  if d.absorb_fees then mode:='absorb'; end if;
  snap:=jsonb_build_object('code_id',d.id,'code',d.code,'kind',d.kind,'discount_type',d.discount_type,'value',d.value,'coverage',d.coverage,'absorb_fees',d.absorb_fees,'fee_mode',mode);
 end if;
 fee:=least(original-savings,case when o.commission_type='fixed' then o.commission_flat_cents else round((original-savings)::numeric*coalesce(o.commission_rate,0.10))::integer end);
 if original-savings>0 and original-savings<100 then raise exception 'discount_balance_too_small'; end if;
 if original-savings>0 and mode='absorb' and not exists(select 1 from public.processor_rates where provider='paymongo' and scope='local' and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())) then raise exception 'rate_card_missing'; end if;
 if original-savings>0 and mode='absorb' and exists(select 1 from public.processor_rates where provider='paymongo' and method in ('card','gcash','paymaya','qrph')
   and effective_from<=statement_timestamp() and (effective_to is null or effective_to>statement_timestamp())
   and original-savings-fee < round((original-savings)::numeric*percent_bps/10000)+fixed_cents) then raise exception 'discount_fees_exceed_balance'; end if;
 update public.discount_redemptions set state='released' where registration_id=r.id and state='reserved';
 if d.id is not null then insert into public.discount_redemptions(org_id,code_id,registration_id,passport_id,original_cents,discount_cents,snapshot)
  values(r.org_id,d.id,r.id,r.participant_passport_id,original,savings,snap); end if;
 update public.registrations set total_amount=original-savings,discount_original_cents=original,discount_amount_cents=savings,discount_code=d.code,discount_snapshot=snap where id=r.id;
 if r.booking_order_id is null then
  perform set_config('racepace.allow_checkout_reprice','on',true);
  update public.payments set amount=original-savings+case when mode='pass_on' then fee else 0 end,
   checkout_fee_mode=mode,checkout_platform_fee=fee,checkout_provider_managed_fee=(mode='pass_on' and provider='paymongo'),
   checkout_request=checkout_request||jsonb_build_object('amount',original-savings+case when mode='pass_on' then fee else 0 end,
    'passOnFees',mode='pass_on' and provider='paymongo','lineItems',jsonb_build_array(jsonb_build_object('name','Race registration','amount',original-savings+case when mode='pass_on' then fee else 0 end)),
    'metadata',jsonb_build_object('fee_mode',mode,'platform_fee_cents',fee::text)) where id=p.id;
 end if;
 return jsonb_build_object('code',d.code,'discount_cents',savings,'total_cents',original-savings,'snapshot',snap);
end $$;

create or replace function public.prescreening_finish_expiry(p_batch uuid) returns text
language plpgsql security definer set search_path='' as $$
declare b public.prescreening_batches%rowtype;
begin
  select * into b from public.prescreening_batches where id=p_batch;
  if not found then return 'not_found'; end if;
  perform 1 from public.events where id=b.event_id for update;
  select * into b from public.prescreening_batches where id=p_batch for update;
  if b.status<>'ready' then return b.status; end if;
  if b.payment_deadline_at>statement_timestamp() then return 'not_due'; end if;
  perform 1 from public.booking_orders where id=b.booking_order_id for update;
  perform 1 from public.booking_payment_attempts where booking_order_id=b.booking_order_id order by id for update;
  perform 1 from public.event_reservations where id=b.event_reservation_id for update;
  perform 1 from public.registrations r join public.prescreening_applications a on a.id=r.prescreening_application_id
    where a.batch_id=b.id order by r.id for update of r;
  if exists(select 1 from public.booking_payment_captures where booking_order_id=b.booking_order_id) or
    exists(select 1 from public.booking_orders where id=b.booking_order_id and status in ('paid','reconciliation_required')) or
    exists(select 1 from public.booking_payment_attempts where booking_order_id=b.booking_order_id and status not in ('prepared','failed','expired')) or
    exists(select 1 from public.event_reservations where id=b.event_reservation_id and status<>'expired') or
    exists(select 1 from public.registrations r join public.prescreening_applications a on a.id=r.prescreening_application_id
      where a.batch_id=b.id and (r.status='paid' or exists(select 1 from public.payments p where p.registration_id=r.id and
      (p.status='paid' or (p.status='pending' and p.provider='paymongo' and (p.provider_ref is not null or p.checkout_request is not null)))))) then
    return 'payment_unresolved'; end if;
  update public.booking_payment_attempts set status='expired' where booking_order_id=b.booking_order_id and status='prepared';
  update public.registrations r set status='expired',expires_at=null from public.prescreening_applications a
    where a.id=r.prescreening_application_id and a.batch_id=b.id and r.status='pending';
  update public.payments p set status='failed' from public.registrations r join public.prescreening_applications a on a.id=r.prescreening_application_id
    where p.registration_id=r.id and a.batch_id=b.id and p.status='pending';
  update public.booking_orders set status='expired',expires_at=null where id=b.booking_order_id and status='pending';
  update public.prescreening_applications set released_at=statement_timestamp() where batch_id=b.id and released_at is null;
  update public.prescreening_batches set status='expired' where id=b.id;
  return 'expired';
end $$;

create or replace function public.expire_stale_registrations() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with expired as (
    update public.registrations r set status='expired',expires_at=null
    where r.status='pending' and r.expires_at<=now()
      and not exists(select 1 from public.booking_payment_captures bc where bc.booking_order_id=r.booking_order_id)
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
    and not exists(select 1 from public.booking_payment_captures bc where bc.booking_order_id=r.booking_order_id)
      and not exists(select 1 from public.payments p
      where p.registration_id=r.id and p.provider='paymongo');
  update public.payments p set status='failed' from public.registrations r
  where p.registration_id=r.id and r.event_id=new.id and r.status='expired'
    and p.status='pending' and p.provider<>'paymongo';
  return new;
end $$;

revoke all on function public.booking_order_prepare_payment(uuid,uuid,text,uuid),
  public.booking_payment_claim_dispatch(uuid,uuid,jsonb,boolean),public.discount_apply(uuid,uuid,text),
  public.prescreening_finish_expiry(uuid),
  public.expire_stale_registrations(),public.expire_pending_on_event_close()
  from public,anon,authenticated;
grant execute on function public.booking_order_prepare_payment(uuid,uuid,text,uuid),
  public.booking_payment_claim_dispatch(uuid,uuid,jsonb,boolean),public.discount_apply(uuid,uuid,text),
  public.prescreening_finish_expiry(uuid),public.expire_stale_registrations() to service_role;
