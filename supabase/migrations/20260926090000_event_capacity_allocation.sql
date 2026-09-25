-- Existing races used category totals as their only capacity. Record that
-- existing value once, then keep the event total independent of later edits.
update public.events e
set total_event_slots = allocation.slots
from (
  select event_id, sum(slots_total)::integer as slots
  from public.categories
  group by event_id
) allocation
where e.id = allocation.event_id
  and e.total_event_slots is null
  and allocation.slots > 0;

create function public.event_capacity_allocation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_allocated bigint;
begin
  if new.total_event_slots is null then return new; end if;
  select coalesce(sum(slots_total), 0) into v_allocated
  from public.categories where event_id = new.id;
  if v_allocated > new.total_event_slots then
    raise exception 'event_categories_exceed_total_capacity' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status = 'coming_soon'
    and new.status in ('open', 'almost_full') and old.coming_soon_reserve_enabled
    and v_allocated <> new.total_event_slots then
    raise exception 'event_categories_must_equal_total_capacity' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.event_capacity_allocation_guard() from public, anon, authenticated;
create trigger event_capacity_allocation_guard
  before update of total_event_slots, status on public.events
  for each row execute function public.event_capacity_allocation_guard();

create function public.category_capacity_allocation_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_total integer; v_allocated bigint;
begin
  -- The parent lock serializes category edits with reservation admission and
  -- event capacity changes, so two editors cannot each allocate the last place.
  select total_event_slots into v_total from public.events
    where id = new.event_id for update;
  if v_total is null then return new; end if;
  select coalesce(sum(slots_total), 0) into v_allocated
  from public.categories
  where event_id = new.event_id and id is distinct from new.id;
  if v_allocated + new.slots_total > v_total then
    raise exception 'event_categories_exceed_total_capacity' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.category_capacity_allocation_guard() from public, anon, authenticated;
create trigger category_capacity_allocation_guard
  before insert or update of slots_total, event_id on public.categories
  for each row execute function public.category_capacity_allocation_guard();
