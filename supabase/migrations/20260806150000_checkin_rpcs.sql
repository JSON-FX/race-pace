-- Race-day check-in read models. Design 2026-08-06 §4.
--
-- Why RPCs and not additive RLS policies: RLS is row-level, not column-level.
-- Granting a marshal SELECT on registrations would also hand them total_amount
-- and custom_data. These functions return exactly the roster fields and nothing
-- else, and confine the privilege expansion to two definitions instead of
-- widening policy surface on the money tables.
--
-- The allowed role set MIRRORS canCheckIn() in supabase/functions/_shared/authz.ts:
--   marshal | editor | admin | super_admin
-- A change to one is a change to the other.
--
-- Every column is cast explicitly: `returns table` fails at runtime on any type
-- mismatch, and registrations.status is the enum registration_status, not text.

-- Does the caller hold a check-in role for this org, honouring event_scope?
-- security definer for the same reason auth_can_admin_org is: it reads only the
-- caller's own user_roles rows, so it never needs a select policy and never recurses.
create or replace function auth_can_check_in_event(p_org_id uuid, p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select auth_is_super_admin()
      or exists (
        select 1 from user_roles ur
        where ur.user_id = auth.uid()
          and ur.org_id = p_org_id
          and ur.role in ('marshal', 'editor', 'admin')
          and (ur.event_scope is null or ur.event_scope = p_event_id)
      );
$$;

create or replace function checkin_events()
returns table (id uuid, name text, event_date date, end_date date)
language sql stable security definer set search_path = public as $$
  select e.id, e.name::text, e.event_date, e.end_date
  from events e
  where auth_can_check_in_event(e.org_id, e.id)
  order by e.event_date nulls last, e.name;
$$;

create or replace function checkin_roster(p_event_id uuid)
returns table (
  registration_id uuid,
  ticket_token    text,
  runner          text,
  bib             text,
  category        text,
  status          text,
  checked_in_at   timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    r.id,
    r.ticket_token::text,
    coalesce(pr.full_name, 'Unknown runner')::text,
    pr.bib_name::text,
    coalesce(c.label, '')::text,
    r.status::text,
    ci.checked_in_at
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

revoke all on function auth_can_check_in_event(uuid, uuid) from public;
revoke all on function checkin_events()                    from public;
revoke all on function checkin_roster(uuid)                from public;
grant execute on function checkin_events()     to authenticated;
grant execute on function checkin_roster(uuid) to authenticated;
