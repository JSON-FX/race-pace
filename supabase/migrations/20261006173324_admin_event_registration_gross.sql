-- Retained gross cannot reconstruct original sales after full refunds: those
-- rows leave the retained total, and nonrefundable fees are not refunded_amount.
-- The reporting view already allocates each group capture once per participant.
create function public.admin_event_registration_gross(p_event_id uuid)
returns table (gross_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(v.payment_amount::bigint), 0)::bigint as gross_cents
  from public.admin_registrations_v v
  where v.event_id = p_event_id
    and v.payment_status in ('paid', 'partially_refunded', 'refunded')
    and public.auth_can_admin_org(v.org_id)
$$;

revoke all on function public.admin_event_registration_gross(uuid) from public, anon;
grant execute on function public.admin_event_registration_gross(uuid) to authenticated, service_role;
