-- A checkout create can time out before its PayMongo session is bound locally.
-- Keep the hold visible to platform staff even after an expiry worker tries it.
create function public.platform_unbound_checkout_reviews()
returns table (
  registration_id uuid,
  event_id uuid,
  event_name text,
  org_id uuid,
  org_name text,
  amount_cents integer,
  expires_at timestamptz,
  latest_outcome text,
  attempts integer,
  last_attempt_at timestamptz,
  capture_count integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select r.id, e.id, e.name, o.id, o.name, p.amount, r.expires_at,
      a.outcome, coalesce(a.attempts, 0), a.last_attempt_at,
      (select count(*)::integer from public.single_payment_captures c
       where c.registration_id = r.id)
    from public.registrations r
    join public.payments p on p.registration_id = r.id
    join public.events e on e.id = r.event_id
    join public.organizations o on o.id = r.org_id
    left join public.provider_session_expiry_attempts a on a.registration_id = r.id
    where r.status = 'pending'
      and r.booking_order_id is null
      and p.status = 'pending'
      and p.provider = 'paymongo'
      and p.provider_ref is null
      and p.checkout_url is null
    order by a.last_attempt_at desc nulls last, r.created_at, r.id;
end $$;

revoke all on function public.platform_unbound_checkout_reviews() from public, anon, authenticated;
grant execute on function public.platform_unbound_checkout_reviews() to authenticated;
