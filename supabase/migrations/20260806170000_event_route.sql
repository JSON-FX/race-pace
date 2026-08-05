-- Course route imported from the organizer's GPX, for the animated course map.
--
-- Stored as jsonb rather than PostGIS geography: the site only ever reads the
-- whole line back to draw it, never does spatial queries against it, and the
-- extension plus its geometry round-tripping would buy nothing here. If
-- proximity search ever matters (e.g. "races near me"), that belongs on a
-- separate indexed column, not on the drawing data.
--
-- Shape: [[lng, lat] | [lng, lat, elevation_m], ...] — GeoJSON coordinate
-- order, lng FIRST. The importer swaps it, since GPX is lat-first.

alter table public.events
  add column if not exists route jsonb;

-- jsonb accepts literally any JSON, so without this an object, a string or a
-- single point could land in the column and only fail later inside the map's
-- render loop, in the browser, where nobody sees it. Cheap structural gate at
-- the boundary; the exhaustive per-point check lives in isValidRoute().
alter table public.events
  drop constraint if exists events_route_is_line,
  add constraint events_route_is_line
    check (
      route is null
      or (jsonb_typeof(route) = 'array' and jsonb_array_length(route) >= 2)
    );

-- Point budget. The importer already simplifies to MAX_ROUTE_POINTS (600), but
-- the column is writable by any org admin through PostgREST, and a raw 20,000-
-- point GPX pasted straight in would be shipped to every visitor's browser.
alter table public.events
  drop constraint if exists events_route_point_budget,
  add constraint events_route_point_budget
    check (route is null or jsonb_array_length(route) <= 2000);

comment on column public.events.route is
  'Course line as [[lng,lat,ele?],...] in GeoJSON order, simplified on import. Null when the organizer has not uploaded a GPX; the public map then shows start/finish markers only.';
