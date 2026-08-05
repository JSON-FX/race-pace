-- Start / finish coordinates for the course locator on the public event page.
--
-- All four columns are nullable and independent of each other: organizers fill
-- them in over time, and an event with no coordinates simply omits the map
-- rather than rendering an empty frame. A loop course sets finish = start.
--
-- numeric(9,6) not double precision: ~0.1 m resolution, exact decimal storage,
-- and no float drift on round-trips through JSON. 9 digits total covers
-- ±180.000000 for longitude.

alter table public.events
  add column if not exists start_lat numeric(9, 6),
  add column if not exists start_lng numeric(9, 6),
  add column if not exists finish_lat numeric(9, 6),
  add column if not exists finish_lng numeric(9, 6);

-- Range checks, so a transposed lat/lng pair (a genuinely common paste error —
-- most map UIs show "lat, lng" but many APIs return "lng, lat") fails at write
-- time instead of silently placing a Philippine race in the Indian Ocean.
-- NOT VALID would skip existing rows; there are none with values yet, so a
-- plain constraint is safe and validates immediately.
alter table public.events
  drop constraint if exists events_start_lat_range,
  add constraint events_start_lat_range
    check (start_lat is null or (start_lat >= -90 and start_lat <= 90));

alter table public.events
  drop constraint if exists events_start_lng_range,
  add constraint events_start_lng_range
    check (start_lng is null or (start_lng >= -180 and start_lng <= 180));

alter table public.events
  drop constraint if exists events_finish_lat_range,
  add constraint events_finish_lat_range
    check (finish_lat is null or (finish_lat >= -90 and finish_lat <= 90));

alter table public.events
  drop constraint if exists events_finish_lng_range,
  add constraint events_finish_lng_range
    check (finish_lng is null or (finish_lng >= -180 and finish_lng <= 180));

-- A latitude with no longitude (or vice versa) cannot be plotted; reject the
-- half-filled pair rather than letting the UI decide what a lone number means.
alter table public.events
  drop constraint if exists events_start_coords_paired,
  add constraint events_start_coords_paired
    check ((start_lat is null) = (start_lng is null));

alter table public.events
  drop constraint if exists events_finish_coords_paired,
  add constraint events_finish_coords_paired
    check ((finish_lat is null) = (finish_lng is null));

comment on column public.events.start_lat is
  'Start line latitude. Paired with start_lng; both null when unset. Rendered by the course locator on the public event page.';
comment on column public.events.finish_lat is
  'Finish line latitude. Equal to start_lat for a loop course.';
