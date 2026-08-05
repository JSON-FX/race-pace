-- Aggregate read models for the admin dashboard. Design 2026-08-06 §8.1.
--
-- Aggregation stays in Postgres: summing every payment row in the browser does
-- not scale and invites floating-point bugs on money. All amounts are integer
-- centavos; sum() over integer yields bigint, cast explicitly so the wire shape
-- is predictable.
--
-- security_invoker = true: the caller's own RLS on registrations and payments
-- still applies, so these expose no row an org admin could not already read.
-- Same pattern as 20260804120000_admin_list_views.sql.
--
-- admin_event_reg_counts_v stays as-is for the Events list; this adds revenue
-- alongside the count rather than changing that view's shape.

create or replace view admin_org_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    count(*)::int                                                             as reg_count,
    count(*) filter (where p.status = 'paid')::int                            as paid_count,
    count(*) filter (where p.status is distinct from 'paid')::int             as pending_count,
    coalesce(sum(p.amount)       filter (where p.status = 'paid'), 0)::bigint as gross_revenue,
    coalesce(sum(p.net_to_org)   filter (where p.status = 'paid'), 0)::bigint as net_to_org,
    coalesce(sum(p.platform_fee) filter (where p.status = 'paid'), 0)::bigint as platform_fee
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id;

create or replace view admin_event_totals_v
with (security_invoker = true) as
  select
    r.org_id,
    r.event_id,
    count(*)::int                                                             as reg_count,
    coalesce(sum(p.amount) filter (where p.status = 'paid'), 0)::bigint       as gross_revenue
  from registrations r
  left join payments p on p.registration_id = r.id
  group by r.org_id, r.event_id;

grant select on admin_org_totals_v   to authenticated;
grant select on admin_event_totals_v to authenticated;
