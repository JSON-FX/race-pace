-- Read models and one write path for the five new console pages.
-- Design 2026-08-06 §3 (dashboard), §4 (check-in undo), §7 (commission).

-- Daily sign-ups for the dashboard chart.
--
-- generate_series so days with zero registrations still produce a point.
-- Without it the line interpolates straight across a quiet week and invents a
-- steady trickle that never happened — the one way a sparkline can actively lie.
create or replace function public.admin_org_signups_daily(p_org_id uuid, p_days int default 30)
returns table (d date, n int)
language sql
stable
security invoker
set search_path = ''
as $$
  select g.d::date, coalesce(count(r.id), 0)::int
  from generate_series(current_date - (p_days - 1), current_date, interval '1 day') g(d)
  left join public.registrations r
    on r.org_id = p_org_id and r.created_at::date = g.d::date
  group by g.d
  order by g.d;
$$;

grant execute on function public.admin_org_signups_daily(uuid, int) to authenticated;
grant execute on function public.admin_org_signups_daily(uuid, int) to service_role;

-- Reverse a mis-scan. There is no delete path on checkins today, and mis-scans
-- at a start line are common.
--
-- Authorized by auth_can_check_in_event — the SAME helper the scan path uses —
-- so undo can never be available to someone who could not have checked the
-- runner in to begin with.
create or replace function public.checkin_undo(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_event uuid;
begin
  select r.org_id, r.event_id into v_org, v_event
    from public.registrations r where r.id = p_registration_id;
  if v_org is null then return 'not_found'; end if;

  if not public.auth_can_check_in_event(v_org, v_event) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.checkins where registration_id = p_registration_id;
  return 'undone';
end;
$$;

revoke all on function public.checkin_undo(uuid) from public;
grant execute on function public.checkin_undo(uuid) to authenticated;
grant execute on function public.checkin_undo(uuid) to service_role;

-- Super admins set commercial terms.
--
-- 20260724140000_scope_org_update_grant.sql narrowed organizations' UPDATE grant
-- to specific columns; the five terms columns are new and were not in that list,
-- so without this grant a super admin's write silently changes zero rows —
-- exactly how the branding editor broke before.
grant update (commission_type, commission_rate, commission_flat_cents,
              refund_policy, refund_fee_cents)
  on organizations to authenticated;

drop policy if exists organizations_super_admin_terms on organizations;
create policy organizations_super_admin_terms on organizations
  for update using (auth_is_super_admin()) with check (auth_is_super_admin());
