-- Pass-on fees change the captured charge, not the registration base price.
-- The registration revenue card must use the same charge as Payments; otherwise
-- it undercounts gross and can turn negative after a partial refund.
create or replace function public.admin_registration_aggregates(
  p_event_id uuid,
  p_status text default 'all',
  p_category_id text default 'all',
  p_q text default ''
)
returns table (
  total int,
  paid int,
  gross_cents bigint,
  refund_count int,
  refunded_cents bigint,
  new_this_week int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::int                                                              as total,
    count(*) filter (where v.payment_status in ('paid', 'partially_refunded'))::int                     as paid,
    coalesce(sum(p.amount::bigint - v.refunded_amount) filter (where v.payment_status in ('paid', 'partially_refunded')), 0)::bigint    as gross_cents,
    count(*) filter (where v.payment_status in ('refunded', 'partially_refunded'))::int                 as refund_count,
    -- Actual returned amount, not the base price or original charge.
    coalesce(sum(v.refunded_amount) filter (where v.payment_status in ('refunded', 'partially_refunded')), 0)::bigint as refunded_cents,
    count(*) filter (where v.created_at >= now() - interval '7 days')::int     as new_this_week
  from public.admin_registrations_v v
  left join public.payments p on p.registration_id = v.id
  where v.event_id = p_event_id
    and (
      p_status = 'all'
      or (p_status in ('expired', 'cancelled') and v.registration_status::text = p_status)
      or (p_status not in ('expired', 'cancelled') and v.payment_status::text = p_status)
    )
    and (p_category_id = 'all' or v.category_id::text = p_category_id)
    and (
      p_q = '' or
      v.full_name ilike p_q or
      v.bib_name ilike p_q
    )
$$;

revoke all on function public.admin_registration_aggregates(uuid, text, text, text) from public, anon;

grant execute on function public.admin_registration_aggregates(uuid, text, text, text) to authenticated;
