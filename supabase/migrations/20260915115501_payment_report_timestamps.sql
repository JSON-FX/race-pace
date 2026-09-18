-- A checkout can exist long before confirmation. Never substitute created_at.
ALTER TABLE public.payments ADD COLUMN paid_at timestamptz;
GRANT SELECT (paid_at) ON public.payments TO authenticated;
GRANT ALL (paid_at) ON public.payments TO service_role;

-- Audit timestamps were written atomically by confirm_payment_tx. Unknown
-- legacy dates remain NULL rather than inventing a capture time.
UPDATE public.payments p SET paid_at = a.confirmed_at
FROM (
 SELECT a.registration_id, a.org_id, min(a.created_at) AS confirmed_at
 FROM public.registration_audit a
 JOIN public.registrations r ON r.id = a.registration_id AND r.org_id = a.org_id AND r.event_id = a.event_id
 WHERE a.action = 'paid' AND a.actor_role = 'system'
 GROUP BY a.registration_id, a.org_id
) a WHERE a.registration_id = p.registration_id AND a.org_id = p.org_id
AND p.status IN ('paid', 'partially_refunded', 'refunded');

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
  v_user uuid;
  v_amount int;
  v_live integer;
  v_constraint text;
begin
  select status, category_id, org_id, event_id, user_id, total_amount
    into v_status, v_category, v_org, v_event, v_user, v_amount
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  if v_status = 'expired' then
    select count(*) into v_live
      from public.registrations
     where event_id = v_event
       and user_id = v_user
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
REVOKE ALL ON FUNCTION public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_tx(uuid,text,integer,integer,text,jsonb,integer,integer,text) TO service_role;
CREATE OR REPLACE VIEW public.admin_payments_v WITH (security_invoker = true) AS
 SELECT p.registration_id,
    p.org_id,
    r.event_id,
    e.name AS event_name,
    r.user_id,
    COALESCE(NULLIF(btrim(r.custom_data ->> 'full_name'::text), ''::text), pr.full_name) AS full_name,
    p.amount,
    p.platform_fee,
    p.net_to_org,
    p.method,
    p.status,
    p.created_at,
    p.refunded_amount,
    pr.avatar_url,
    p.processor_fee_cents,
    p.processor_fee_source,
    p.paid_at
   FROM payments p
     JOIN registrations r ON r.id = p.registration_id
     LEFT JOIN events e ON e.id = r.event_id
     LEFT JOIN profiles pr ON pr.id = r.user_id;

GRANT SELECT ON public.admin_payments_v TO authenticated, service_role;
