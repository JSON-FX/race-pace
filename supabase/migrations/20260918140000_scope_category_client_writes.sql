-- Event editors set capacity, but slots_taken is a payment-derived count.
-- Table-wide client grants let an organizer forge the count directly and
-- bypass the checkout hold/capacity invariant. Keep only editor fields.
revoke insert, update on public.categories from authenticated;
grant insert (org_id, event_id, code, label, distance_km, base_price,
  slots_total, elevation_gain_m, cutoff_hours, blurb)
  on public.categories to authenticated;
grant update (code, label, distance_km, base_price, slots_total,
  elevation_gain_m, cutoff_hours, blurb)
  on public.categories to authenticated;

-- The old slot helper was accidentally executable by PUBLIC. It is an
-- invoker function, but there is no reason for browser roles to call it.
create or replace function public.increment_slot(p_category_id uuid)
returns void language sql set search_path = '' as $$
  update public.categories set slots_taken = slots_taken + 1 where id = p_category_id;
$$;
revoke all on function public.increment_slot(uuid) from public, anon, authenticated;
grant execute on function public.increment_slot(uuid) to service_role;

create or replace function public.decrement_slot(p_category_id uuid)
returns void language sql set search_path = '' as $$
  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = p_category_id;
$$;
revoke all on function public.decrement_slot(uuid) from public, anon, authenticated;
grant execute on function public.decrement_slot(uuid) to service_role;
