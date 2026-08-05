-- Two race worlds, two landing pages.
--
-- A trail ultra and a city fun run are not the same product. The runner-facing
-- site renders an elevation profile for one and a route ribbon for the other,
-- and a flat 5K has no meaningful elevation profile to draw. That branch has to
-- be a value the organizer SETS in the admin console, not something inferred
-- from elevation_gain_m — a hilly road race and a flat coastal ultra would both
-- be classified wrongly, and silently.

create type event_discipline as enum ('trail', 'road');

-- Default 'trail': every event that exists today is a trail race, so the default
-- keeps them rendering exactly as they do now.
alter table events
  add column discipline event_discipline not null default 'trail';

comment on column events.discipline is
  'Drives which landing layout the public site renders: trail => elevation profile, road => route ribbon.';

-- Per-distance detail. These live on the event today, which is wrong once an
-- event has a 100K and a 10K: they do not share a cut-off or a climb.
-- All nullable — organizers fill them in over time, and the site hides any
-- fact it has no value for rather than printing a zero.
alter table categories
  add column elevation_gain_m integer,
  add column cutoff_hours     numeric(4,1),
  add column blurb            text;

comment on column categories.elevation_gain_m is 'Climb for THIS distance. Null = not published; the site omits the fact.';
comment on column categories.cutoff_hours     is 'Cut-off for THIS distance. Null = no published cut-off (typical for fun runs).';
comment on column categories.blurb            is 'One line on who the distance is for. Carries the fun-run layout; optional on trail.';

alter table categories
  add constraint categories_elevation_gain_m_sane check (elevation_gain_m is null or elevation_gain_m between 0 and 30000),
  add constraint categories_cutoff_hours_sane     check (cutoff_hours     is null or cutoff_hours     between 0 and 240);

-- Race-morning schedule: [{"time":"04:30","label":"Gun start, 21K and 10K"}, ...]
-- jsonb rather than a child table — it is display-only, always read whole, never
-- queried across events, and an organizer edits it as one ordered list.
alter table events
  add column schedule jsonb not null default '[]'::jsonb;

comment on column events.schedule is
  'Ordered [{time,label}] shown on the public event page. Display-only; never queried across events.';

alter table events
  add constraint events_schedule_is_array check (jsonb_typeof(schedule) = 'array');

-- No new RLS policies needed: these are columns on tables whose existing
-- policies already gate reads (public catalog) and writes (org admins).
