-- A captured PayMongo payment can require reconciliation even when its checkout
-- session was bound. Give platform staff a safe queue without exposing provider
-- payloads or granting direct access to the capture inbox.
create function public.platform_single_capture_reviews()
returns table (
  provider_payment_id text,
  registration_id uuid,
  event_name text,
  org_name text,
  amount_cents integer,
  reason text,
  first_seen_at timestamptz,
  registration_status text,
  payment_status text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select c.provider_payment_id, c.registration_id, e.name, o.name,
      c.amount_cents, c.reason, c.first_seen_at,
      r.status::text, p.status::text
    from public.single_payment_captures c
    join public.registrations r on r.id = c.registration_id
    join public.payments p on p.registration_id = r.id
    join public.events e on e.id = c.event_id
    join public.organizations o on o.id = c.org_id
    where c.state = 'reconciliation_required'
    order by c.first_seen_at desc, c.provider_payment_id;
end $$;

revoke all on function public.platform_single_capture_reviews() from public, anon, authenticated;
grant execute on function public.platform_single_capture_reviews() to authenticated;
