-- Participant identity is now the duplicate boundary. Checkout remains self-only
-- until the helper flow and nullable participant account consumers are ready.
-- Keep the index name: payment confirmation and Edge conflict handling use it.
alter table public.registrations alter column participant_passport_id set not null;
drop index public.registrations_one_live_per_event;
create unique index registrations_one_live_per_event
 on public.registrations(event_id, participant_passport_id)
 where status in ('pending','paid');
-- Add the future retry boundary without removing legacy user-based retries yet.
alter table public.registrations add constraint registrations_booker_participant_retry
 unique(booked_by_user_id,participant_passport_id,idempotency_key);
CREATE OR REPLACE FUNCTION public.confirm_payment_tx(p_registration_id uuid, p_method text, p_fee integer, p_net integer, p_token text, p_raw jsonb, p_processor_fee integer DEFAULT 0, p_processor_fee_predicted integer DEFAULT NULL::integer, p_processor_fee_source text DEFAULT 'none'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_status public.registration_status;
  v_category uuid;
  v_org uuid;
  v_event uuid;
  v_participant uuid;
  v_amount int;
  v_live integer;
  v_constraint text;
begin
  select status, category_id, org_id, event_id, participant_passport_id, total_amount
    into v_status, v_category, v_org, v_event, v_participant, v_amount
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  if v_status = 'expired' then
    select count(*) into v_live
      from public.registrations
     where event_id = v_event
       and participant_passport_id = v_participant
       and id <> p_registration_id
       and status in ('pending', 'paid');
    if v_live > 0 then
      return 'conflict';
    end if;
  elsif v_status <> 'pending' then
    return 'not_pending';  -- refunded/cancelled: never re-confirm (replay-safe)
  end if;

  begin
    update public.payments
       set status = 'paid', paid_at = coalesce(paid_at, now()), method = p_method, platform_fee = p_fee,
           net_to_org = p_net, raw = p_raw,
           processor_fee_cents           = coalesce(p_processor_fee, 0),
           processor_fee_predicted_cents = p_processor_fee_predicted,
           processor_fee_source          = coalesce(p_processor_fee_source, 'none')
     where registration_id = p_registration_id;

    update public.registrations
       set status = 'paid', ticket_token = p_token, expires_at = null
     where id = p_registration_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'registrations_one_live_per_event' then
      return 'conflict';
    end if;
    raise;  -- some other constraint: a real bug, must not be swallowed
  end;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_role)
  values (p_registration_id, v_org, v_event, 'paid',
          jsonb_build_object('method', p_method, 'amount', v_amount), 'system');

  return 'paid';
end;
$function$;

CREATE OR REPLACE FUNCTION public.dedupe_live_registrations()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_expired_count integer;
begin
  with ranked as (
    select id, category_id, status,
           row_number() over (
             partition by event_id, participant_passport_id
             order by (status = 'paid') desc, created_at, id
           ) as rn
      from public.registrations
     where status in ('pending', 'paid')
  ),
  losers as (
    select id, category_id, status from ranked where rn > 1
  ),
  released as (
    update public.categories c
       set slots_taken = greatest(c.slots_taken - sub.n, 0)
      from (select category_id, count(*) as n from losers where status = 'paid' group by category_id) sub
     where c.id = sub.category_id
    returning c.id
  ),
  expired as (
    update public.registrations r
       set status = 'expired', expires_at = null
      from losers l
     where r.id = l.id
    returning r.id
  )
  select count(*) into v_expired_count from expired;

  return v_expired_count;
end;
$function$;


revoke all on function public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text), public.dedupe_live_registrations() from public,anon,authenticated;
grant execute on function public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text), public.dedupe_live_registrations() to service_role;
