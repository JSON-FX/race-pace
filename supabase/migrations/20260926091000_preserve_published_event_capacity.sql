-- A published race with a stored event total must not clear it to bypass
-- category and reservation admission checks.
create function public.published_event_capacity_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.total_event_slots is not null and new.total_event_slots is null
    and old.status <> 'draft' then
    raise exception 'published_event_capacity_required' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.published_event_capacity_guard() from public, anon, authenticated;
create trigger published_event_capacity_guard
  before update of total_event_slots on public.events
  for each row execute function public.published_event_capacity_guard();
