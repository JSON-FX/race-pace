-- Local-only migration: iterated during local QA; never applied hosted.
-- A refund after opening left the saved total overstated while mark_paid stamped
-- a different set of payments. Snapshot and revision guard both database drift and
-- an old browser dialog after another operator explicitly refreshes the statement.
alter table public.payout_statements add column payment_snapshot jsonb;
alter table public.payout_statements add column revision integer not null default 0;
grant select(payment_snapshot, revision) on public.payout_statements to authenticated;
grant all(payment_snapshot, revision) on public.payout_statements to service_role;

create or replace function public.payout_payment_snapshot(p_event_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_array(p.id, p.status, p.amount, p.platform_fee,
    p.processor_fee_cents, p.processor_fee_source, p.net_to_org, p.refunded_amount,
    p.payout_statement_id, p.payout_clawback_id, p.raw->'refund'->>'status') order by p.id), '[]'::jsonb)
  from public.payments p join public.registrations r on r.id=p.registration_id
  where r.event_id=p_event_id;
$$;
revoke all on function public.payout_payment_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.payout_payment_snapshot(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.payout_open_statement(p_event_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org     uuid;
  v_gross   bigint;
  v_comm    bigint;
  v_proc    bigint;
  v_earn    bigint;
  v_refunds bigint;
  v_period  bigint;
  v_id      uuid;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Prevent phantom entries and money changes between comparison and stamping.
  -- All payout entry points take locks in this order; no network calls occur here.
  lock table public.registrations in exclusive mode;
  lock table public.payments in exclusive mode;

  select e.org_id into v_org from public.events e where e.id = p_event_id;
  if v_org is null then raise exception 'event_not_found'; end if;

  -- Amounts key on the STAMP, not on status alone:
  --   earn     = unsettled money we now owe   (paid/partial, no statement stamp)
  --   clawback = already-transferred money    (refunded OR partially refunded, HAS
  --              since refunded/reduced        a statement stamp, no clawback stamp)
  -- A refund lands in exactly one of those, or neither. Never both. Keying on
  -- status alone was the original, wrong design — see 20260807090300's header.
  select
    coalesce(sum(p.amount)              filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    coalesce(sum(p.platform_fee)        filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    -- 'historical' rows are excluded, and so are 'none' rows: on both, net_to_org
    -- does NOT have a processor fee deducted from it — on 'historical' because the
    -- platform absorbed a real fee under pre-2026-08-11 terms, on 'none' because
    -- processor_fee_cents is 0. Counting either here would show the organizer a
    -- cost they never bore AND break the gross - commission - processing identity
    -- for exactly those rows. The filter is what keeps the breakdown honest; it
    -- deliberately does not appear on the two net_to_org sums below, which must
    -- include historical rows at their stored value.
    coalesce(sum(p.processor_fee_cents) filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null
                                                  and p.processor_fee_source in ('actual','predicted')), 0),
    coalesce(sum(p.net_to_org)          filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    -- THE CLAWBACK, in two terms because the two cases are sized from different
    -- columns, not because they are two different rules.
    --   'refunded'           -> net_to_org, which a full refund leaves in place, so
    --                           it still reads as what was transferred. Verbatim
    --                           from the dump; this number must not move.
    --   'partially_refunded' -> refunded_amount, because net_to_org has already been
    --                           overwritten with the retention and no longer says
    --                           what was settled. See the header.
    -- Disjoint from each other by status, and from all five sums above by the stamp.
    coalesce(sum(p.net_to_org)          filter (where p.status = 'refunded'
                                                  and p.payout_statement_id is not null
                                                  and p.payout_clawback_id is null), 0)
  + coalesce(sum(p.refunded_amount)     filter (where p.status = 'partially_refunded'
                                                  and p.payout_statement_id is not null
                                                  and p.payout_clawback_id is null), 0),
    -- The fourth presentational line. Same rows as gross/commission/processing.
    coalesce(sum(p.refunded_amount)     filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0)
  into v_gross, v_comm, v_proc, v_earn, v_refunds, v_period
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id;

  -- net_owed is v_earn - v_refunds, NOT v_gross - v_comm - v_proc - v_period -
  -- v_refunds. The four presentational figures are stored beside it, never
  -- multiplied back into it.
  insert into public.payout_statements
    (org_id, event_id, gross_cents, commission_cents, processing_cents,
     refunds_in_period_cents, refunds_cents, net_owed_cents, opened_by, payment_snapshot)
  values
    (v_org, p_event_id, v_gross, v_comm, v_proc,
     v_period, v_refunds, v_earn - v_refunds, auth.uid(), public.payout_payment_snapshot(p_event_id))
  returning id into v_id;

  return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.payout_refresh_statement(p_statement_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p_event_id uuid;
  v_status text;
  v_org     uuid;
  v_gross   bigint;
  v_comm    bigint;
  v_proc    bigint;
  v_earn    bigint;
  v_refunds bigint;
  v_period  bigint;
  v_id      uuid;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Prevent phantom entries and money changes between comparison and stamping.
  -- All payout entry points take locks in this order; no network calls occur here.
  lock table public.registrations in exclusive mode;
  lock table public.payments in exclusive mode;

  select event_id, status into p_event_id, v_status from public.payout_statements where id = p_statement_id for update;
  if p_event_id is null then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  select e.org_id into v_org from public.events e where e.id = p_event_id;
  if v_org is null then raise exception 'event_not_found'; end if;

  -- Amounts key on the STAMP, not on status alone:
  --   earn     = unsettled money we now owe   (paid/partial, no statement stamp)
  --   clawback = already-transferred money    (refunded OR partially refunded, HAS
  --              since refunded/reduced        a statement stamp, no clawback stamp)
  -- A refund lands in exactly one of those, or neither. Never both. Keying on
  -- status alone was the original, wrong design — see 20260807090300's header.
  select
    coalesce(sum(p.amount)              filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    coalesce(sum(p.platform_fee)        filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    -- 'historical' rows are excluded, and so are 'none' rows: on both, net_to_org
    -- does NOT have a processor fee deducted from it — on 'historical' because the
    -- platform absorbed a real fee under pre-2026-08-11 terms, on 'none' because
    -- processor_fee_cents is 0. Counting either here would show the organizer a
    -- cost they never bore AND break the gross - commission - processing identity
    -- for exactly those rows. The filter is what keeps the breakdown honest; it
    -- deliberately does not appear on the two net_to_org sums below, which must
    -- include historical rows at their stored value.
    coalesce(sum(p.processor_fee_cents) filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null
                                                  and p.processor_fee_source in ('actual','predicted')), 0),
    coalesce(sum(p.net_to_org)          filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0),
    -- THE CLAWBACK, in two terms because the two cases are sized from different
    -- columns, not because they are two different rules.
    --   'refunded'           -> net_to_org, which a full refund leaves in place, so
    --                           it still reads as what was transferred. Verbatim
    --                           from the dump; this number must not move.
    --   'partially_refunded' -> refunded_amount, because net_to_org has already been
    --                           overwritten with the retention and no longer says
    --                           what was settled. See the header.
    -- Disjoint from each other by status, and from all five sums above by the stamp.
    coalesce(sum(p.net_to_org)          filter (where p.status = 'refunded'
                                                  and p.payout_statement_id is not null
                                                  and p.payout_clawback_id is null), 0)
  + coalesce(sum(p.refunded_amount)     filter (where p.status = 'partially_refunded'
                                                  and p.payout_statement_id is not null
                                                  and p.payout_clawback_id is null), 0),
    -- The fourth presentational line. Same rows as gross/commission/processing.
    coalesce(sum(p.refunded_amount)     filter (where p.status in ('paid','partially_refunded')
                                                  and p.payout_statement_id is null), 0)
  into v_gross, v_comm, v_proc, v_earn, v_refunds, v_period
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id;

  -- net_owed is v_earn - v_refunds, NOT v_gross - v_comm - v_proc - v_period -
  -- v_refunds. The four presentational figures are stored beside it, never
  -- multiplied back into it.
  update public.payout_statements set gross_cents=v_gross, commission_cents=v_comm,
    processing_cents=v_proc, refunds_in_period_cents=v_period, refunds_cents=v_refunds,
    net_owed_cents=v_earn-v_refunds, payment_snapshot=public.payout_payment_snapshot(p_event_id),
    revision=revision+1 where id=p_statement_id;
  return 'refreshed';
end;
$function$;


CREATE OR REPLACE FUNCTION public.payout_mark_paid(p_statement_id uuid, p_reference text, p_note text, p_expected_revision integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_snapshot jsonb;
  v_revision integer;
  v_event  uuid;
  v_status text;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Prevent phantom entries and money changes between comparison and stamping.
  -- All payout entry points take locks in this order; no network calls occur here.
  lock table public.registrations in exclusive mode;
  lock table public.payments in exclusive mode;

  select s.event_id, s.status, s.payment_snapshot, s.revision into v_event, v_status, v_snapshot, v_revision
    from public.payout_statements s where s.id = p_statement_id for update;
  if v_event is null then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;
  if p_expected_revision is null or p_expected_revision <> v_revision then return 'stale'; end if;
  if v_snapshot is null or v_snapshot <> public.payout_payment_snapshot(v_event) then return 'stale'; end if;
  if nullif(btrim(p_reference), '') is null then return 'reference_required'; end if;


  -- Earn stamp. A row that is ALREADY partially refunded when it is first settled had
  -- its refund netted out of THIS statement's earnings (the earn sum reads net_to_org,
  -- which the refund had already dropped to the retention), so that refund is
  -- accounted for here and now — never a clawback. Marking it in the same UPDATE is
  -- what makes the two mutually exclusive; leaving it NULL is exactly the over-charge
  -- 095700 shipped. A 'paid' row keeps a NULL clawback stamp so that a refund landing
  -- LATER is still recovered.
  --
  -- `else p.payout_clawback_id` rather than `else null`: this UPDATE requires a NULL
  -- payout_statement_id, and the clawback UPDATE requires a NON-NULL one, so the
  -- clawback stamp is provably already NULL on every row reached here. Writing the
  -- column back to itself keeps that an assumption this statement does not depend on.
  update public.payments p
     set payout_statement_id = p_statement_id,
         payout_clawback_id  = case
                                 when p.status = 'partially_refunded' then p_statement_id
                                 else p.payout_clawback_id
                               end
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('paid','partially_refunded')
     and p.payout_statement_id is null;

  -- Clawback stamp: money already transferred on an EARLIER statement and since
  -- refunded. Rows the UPDATE above just touched are excluded by `payout_clawback_id
  -- is null`, which it set — no ordering predicate needed.
  update public.payments p
     set payout_clawback_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('refunded','partially_refunded')
     and p.payout_statement_id is not null
     and p.payout_clawback_id is null;

  update public.payout_statements
     set status = 'paid', paid_at = now(), paid_by = auth.uid(),
         reference = p_reference, note = p_note
   where id = p_statement_id;

  return 'paid';
end;
$function$;


-- Old clients may not settle without supplying the revision they reviewed.
create or replace function public.payout_mark_paid(p_statement_id uuid, p_reference text, p_note text)
returns text language plpgsql security definer set search_path='' as $$
begin
  if not public.auth_is_super_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return 'review_required';
end; $$;
revoke all on function public.payout_open_statement(uuid) from public, anon;
grant execute on function public.payout_open_statement(uuid) to authenticated, service_role;
revoke all on function public.payout_refresh_statement(uuid) from public, anon;
grant execute on function public.payout_refresh_statement(uuid) to authenticated, service_role;
revoke all on function public.payout_mark_paid(uuid,text,text) from public, anon;
grant execute on function public.payout_mark_paid(uuid,text,text) to authenticated, service_role;
revoke all on function public.payout_mark_paid(uuid,text,text,integer) from public, anon;
grant execute on function public.payout_mark_paid(uuid,text,text,integer) to authenticated, service_role;
