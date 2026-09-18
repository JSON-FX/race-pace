-- Existing open events retain their history during the waiver rollout. New
-- publication must select an immutable organizer waiver before selling slots.
create function public.event_require_waiver_to_open()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Service-role maintenance and historical fixture imports are trusted. The
  -- checkout function independently rejects every waiverless event.
  if auth.role() = 'service_role' then return new; end if;
  if TG_OP = 'UPDATE' and new.status is not distinct from old.status
    and new.waiver_version_id is not distinct from old.waiver_version_id then return new; end if;
  if new.status in ('open', 'almost_full') and not exists (
    select 1 from public.organizer_waiver_versions v
    where v.id = new.waiver_version_id and v.org_id = new.org_id and v.published_at is not null
  ) then
    raise exception 'event_waiver_required_for_publishing' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function public.event_require_waiver_to_open() from public, anon, authenticated;
grant execute on function public.event_require_waiver_to_open() to service_role;
create trigger event_require_waiver_to_open before insert or update of status, waiver_version_id on public.events
  for each row execute function public.event_require_waiver_to_open();
