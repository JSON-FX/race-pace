-- The public organizer directory needs a structured home base. Keep every
-- field nullable so existing organizations remain valid until admins edit them.
alter table public.organizations
  add column home_city_psgc_code text references public.psgc_cities(code),
  add column home_city_name text,
  add column home_province_name text,
  add column home_region_name text;

-- Description already exists, but authenticated users were never granted
-- column-scoped UPDATE access to it.
grant update (description, home_city_psgc_code, home_city_name, home_province_name, home_region_name)
  on table public.organizations to authenticated;

-- The existing organization UPDATE policy includes editors. Keep these new
-- public profile fields admin-only even when a client bypasses Settings.
create function public.guard_organizer_profile_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.description is not distinct from old.description
    and new.home_city_psgc_code is not distinct from old.home_city_psgc_code
    and new.home_city_name is not distinct from old.home_city_name
    and new.home_province_name is not distinct from old.home_province_name
    and new.home_region_name is not distinct from old.home_region_name then
    return new;
  end if;
  if (session_user = 'postgres' and auth.jwt() is null)
    or auth.jwt() ->> 'role' = 'service_role' then return new; end if;
  if auth.uid() is null or not (
    public.auth_is_super_admin() or exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and org_id = new.id and role = 'admin'
    )
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_organizer_profile_fields() from public, anon, authenticated;
grant execute on function public.guard_organizer_profile_fields() to service_role;
create trigger guard_organizer_profile_fields
  before update of description, home_city_psgc_code, home_city_name, home_province_name, home_region_name
  on public.organizations for each row execute function public.guard_organizer_profile_fields();
