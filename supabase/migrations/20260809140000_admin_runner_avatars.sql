-- Project runners' avatar_url through the admin read models.
--
-- profiles.avatar_url has existed since 20260722122753, but nothing an admin
-- reads exposed it, so every runner in the console was an initials monogram
-- even once they had set a photo. Each of these already joins profiles and
-- selects pr.full_name, so avatar_url rides along on a join that is already
-- paid for and is visible under exactly the same RLS that makes the name
-- visible — no new policy, no new exposure.

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
    p.created_at,
    -- refunded_amount was appended by 20260807090200; it has to stay in place.
    -- create or replace view can only ADD columns at the end of the list, so the
    -- whole existing list must be repeated verbatim and in order — reordering or
    -- renaming any of it errors out (42P16) rather than silently rebuilding.
    p.refunded_amount,
    pr.avatar_url
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
    r.created_at,
    pr.avatar_url
  from registrations r
  left join profiles pr on pr.id = r.user_id
  left join categories c on c.id = r.category_id
  left join payments p   on p.registration_id = r.id;

-- create or replace cannot widen a function's return table, so this one is
-- dropped and rebuilt. Dropping takes its grants with it, hence the full
-- revoke/grant pair below rather than just the added column.
drop function if exists checkin_roster(uuid);

create function checkin_roster(p_event_id uuid)
returns table (
  registration_id uuid,
  ticket_token    text,
  runner          text,
  bib             text,
  category        text,
  status          text,
  checked_in_at   timestamptz,
  avatar_url      text
)
language sql stable security definer set search_path = public as $$
  select
    r.id,
    r.ticket_token::text,
    coalesce(pr.full_name, 'Unknown runner')::text,
    pr.bib_name::text,
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
  order by coalesce(pr.full_name, '');
$$;

revoke all on function checkin_roster(uuid) from public;
grant execute on function checkin_roster(uuid) to authenticated;

grant select on admin_payments_v      to authenticated;
grant select on admin_registrations_v to authenticated;
