-- Organizers run more than "trail" and "road".
--
-- Terrain and distance are DIFFERENT axes: a trail marathon and a road marathon
-- both exist, and distances already live in `categories` (an event has a 100K
-- and a 10K). So these values name the KIND of event, not how far it is —
-- category labels stay free text and are unaffected.
--
-- Eight values, still only TWO page layouts. The mapping lives in
-- packages/shared (`disciplineLayout`) rather than here, so the public site and
-- the admin console cannot disagree about which design an event gets.
--
-- Added on their own with nothing using them in the same statement — Postgres
-- rejects "unsafe use of new enum value" when a value is added and consumed in
-- one transaction (same reason 20260724120000 added 'claiming' alone).

alter type event_discipline add value if not exists 'ultra';
alter type event_discipline add value if not exists 'cross_country';
alter type event_discipline add value if not exists 'obstacle';
alter type event_discipline add value if not exists 'marathon';
alter type event_discipline add value if not exists 'half_marathon';
alter type event_discipline add value if not exists 'fun_run';

comment on type event_discipline is
  'Kind of event, chosen by the organizer. Maps to one of two public layouts via disciplineLayout() in packages/shared: terrain types => elevation profile, road types => route ribbon. Distances are NOT encoded here — those are category labels.';
