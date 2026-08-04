-- Flattened read models for the admin console's list screens.
--
-- Why views: registrations.user_id references auth.users, NOT profiles, so PostgREST
-- has no embeddable path to a runner's name. Both list hooks worked around this with a
-- second .in() query and stitched names in JS, which makes server-side ORDER BY / ILIKE
-- on the runner name impossible. Flattening the joins here makes .range(), .order(),
-- .ilike() and count:'exact' work on plain columns.
--
-- security_invoker = true: the caller's own RLS on every underlying table still applies,
-- so these views expose no row an org admin could not already read.

create or replace view admin_payments_v
with (security_invoker = true) as
  select
    p.registration_id,
    p.org_id,
    r.event_id,
    e.name              as event_name,
    r.user_id,
    pr.full_name,
    p.amount,
    p.platform_fee,
    p.net_to_org,
    p.method,
    p.status,
    p.created_at
  from payments p
  join registrations r on r.id = p.registration_id
  left join events e   on e.id = r.event_id
  left join profiles pr on pr.id = r.user_id;

create or replace view admin_registrations_v
with (security_invoker = true) as
  select
    r.id,
    r.org_id,
    r.event_id,
    r.user_id,
    pr.full_name,
    pr.bib_name,
    r.category_id,
    c.label             as category_label,
    r.total_amount,
    p.status            as payment_status,
    p.method            as payment_method,
    r.custom_data,
    r.created_at
  from registrations r
  left join profiles pr on pr.id = r.user_id
  left join categories c on c.id = r.category_id
  left join payments p   on p.registration_id = r.id;

create or replace view admin_event_reg_counts_v
with (security_invoker = true) as
  select r.org_id, r.event_id, count(*)::int as reg_count
  from registrations r
  group by r.org_id, r.event_id;

grant select on admin_payments_v          to authenticated;
grant select on admin_registrations_v     to authenticated;
grant select on admin_event_reg_counts_v  to authenticated;
