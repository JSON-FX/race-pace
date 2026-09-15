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
    p.refunded_amount
   FROM registrations r
     LEFT JOIN profiles pr ON pr.id = r.user_id
     LEFT JOIN categories c ON c.id = r.category_id
     LEFT JOIN payments p ON p.registration_id = r.id;

CREATE OR REPLACE VIEW public.admin_payments_v WITH (security_invoker = true) AS
 SELECT p.registration_id,
    p.org_id,
    r.event_id,
    e.name AS event_name,
    r.user_id,
    coalesce(nullif(btrim(r.custom_data->>'full_name'), ''), pr.full_name) AS full_name,
    p.amount,
    p.platform_fee,
    p.net_to_org,
    p.method,
    p.status,
    p.created_at,
    p.refunded_amount,
    pr.avatar_url
   FROM payments p
     JOIN registrations r ON r.id = p.registration_id
     LEFT JOIN events e ON e.id = r.event_id
     LEFT JOIN profiles pr ON pr.id = r.user_id;

CREATE OR REPLACE FUNCTION public.checkin_roster(p_event_id uuid)
 RETURNS TABLE(registration_id uuid, ticket_token text, runner text, bib text, category text, status text, checked_in_at timestamp with time zone, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    r.id,
    r.ticket_token::text,
    coalesce(coalesce(nullif(btrim(r.custom_data->>'full_name'), ''), pr.full_name), 'Unknown runner')::text,
    coalesce(nullif(btrim(r.custom_data->>'bib_name'), ''), pr.bib_name)::text,
    coalesce(c.label, '')::text,
    r.status::text,
    ci.checked_in_at,
    pr.avatar_url::text
  from registrations r
  join events e            on e.id = r.event_id
  left join profiles pr    on pr.id = r.user_id
  left join categories c   on c.id = r.category_id
  left join checkins ci    on ci.registration_id = r.id
  where r.event_id = p_event_id
    and r.status in ('pending', 'paid')
    and auth_can_check_in_event(e.org_id, e.id)
  order by coalesce(coalesce(nullif(btrim(r.custom_data->>'full_name'), ''), pr.full_name), '');
$function$;


REVOKE ALL ON FUNCTION public.checkin_roster(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.checkin_roster(uuid) TO authenticated, service_role;
GRANT SELECT ON public.admin_registrations_v, public.admin_payments_v TO authenticated, service_role;
