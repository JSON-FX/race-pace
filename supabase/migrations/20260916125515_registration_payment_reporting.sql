-- Local-only revision; never applied to hosted Supabase.
-- Separate charged gross from entry base. Preserve existing audit rows; only
-- future payment confirmations carry an explicit captured-gross marker.
-- Registration identity belongs to the entry; legacy rows fall back to profiles.
-- Preserve security-invoker views and the existing org authorization predicate.
CREATE OR REPLACE VIEW public.admin_registrations_v WITH (security_invoker = true) AS
 SELECT r.id,
    r.org_id,
    r.event_id,
    r.user_id,
    coalesce(nullif(btrim(r.custom_data->>'full_name'), ''), pr.full_name) AS full_name,
    coalesce(nullif(btrim(r.custom_data->>'bib_name'), ''), pr.bib_name) AS bib_name,
    r.category_id,
    c.label AS category_label,
    r.total_amount,
    p.status AS payment_status,
    p.method AS payment_method,
    r.custom_data,
    r.created_at,
    pr.avatar_url,
    r.status AS registration_status,
    p.refunded_amount,
    p.amount AS payment_amount
   FROM registrations r
     LEFT JOIN profiles pr ON pr.id = r.user_id
     LEFT JOIN categories c ON c.id = r.category_id
     LEFT JOIN payments p ON p.registration_id = r.id;


GRANT SELECT ON public.admin_registrations_v TO authenticated, service_role;

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
     where registration_id = p_registration_id returning amount into v_amount;

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
          jsonb_build_object('method', p_method, 'amount', v_amount, 'amount_basis', 'captured_gross'), 'system');

  return 'paid';
end;
$function$;


REVOKE ALL ON FUNCTION public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) TO service_role;
