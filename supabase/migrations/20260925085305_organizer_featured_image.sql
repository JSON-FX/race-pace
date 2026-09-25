-- A profile photograph is separate from the wide promotional cover. Existing
-- organizations need no backfill; a null value renders a text-led public hero.
alter table public.organizations add column featured_image_url text;
grant update (featured_image_url) on table public.organizations to authenticated;

-- Editors satisfy the older organization UPDATE row policy. Reuse the profile
-- guard so only organization admins may change this new public identity field.
create or replace function public.guard_organizer_profile_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.description is not distinct from old.description
    and new.home_city_psgc_code is not distinct from old.home_city_psgc_code
    and new.home_city_name is not distinct from old.home_city_name
    and new.home_province_name is not distinct from old.home_province_name
    and new.home_region_name is not distinct from old.home_region_name
    and new.featured_image_url is not distinct from old.featured_image_url then
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

drop trigger guard_organizer_profile_fields on public.organizations;
create trigger guard_organizer_profile_fields
  before update of description, home_city_psgc_code, home_city_name, home_province_name, home_region_name, featured_image_url
  on public.organizations for each row execute function public.guard_organizer_profile_fields();
