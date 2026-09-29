-- Public category actions need the same capacity ledger as admission. Expose
-- only aggregate counts for published, active events; never participant rows.
create function public.category_availability(p_event uuid)
returns table(category_id uuid,total_available integer,general_available integer,reservation_available integer)
language sql stable security definer set search_path='' as $$
  with claims as materialized (
    select q.category_id,q.pool from public.event_capacity_claims(p_event) q
  ), used as (
    select category_id,count(*)::integer total,
      count(*) filter(where pool='general')::integer general,
      count(*) filter(where pool='reservation')::integer reserved
    from claims group by category_id
  ), event_used as (
    select count(*)::integer total from claims
  ), capacity as (
    select c.id,c.slots_total,c.reservation_slots,c.reservation_enabled,
      c.reservation_sales_close_at,
      greatest(0,least(c.slots_total-coalesce(u.total,0),
        coalesce(e.total_event_slots,0)-event_used.total))::integer remaining,
      coalesce(u.general,0) general_used,coalesce(u.reserved,0) reserved_used
    from public.categories c join public.events e on e.id=c.event_id
      join public.organizations o on o.id=e.org_id
      cross join event_used left join used u on u.category_id=c.id
    where c.event_id=p_event and e.status in ('coming_soon','open','almost_full') and o.is_active
  )
  select id,remaining,
    case when reservation_enabled and reservation_sales_close_at>statement_timestamp()
      then greatest(0,least(remaining,slots_total-reservation_slots-general_used))
      else remaining end::integer,
    case when reservation_enabled and reservation_sales_close_at>statement_timestamp()
      then greatest(0,least(remaining,reservation_slots-reserved_used))
      else 0 end::integer
  from capacity;
$$;
revoke all on function public.category_availability(uuid) from public;
grant execute on function public.category_availability(uuid) to anon,authenticated,service_role;
