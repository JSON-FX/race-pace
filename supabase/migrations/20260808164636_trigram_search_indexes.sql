-- Make the admin search box indexable.
--
-- THE PROBLEM: every admin search runs a LEADING-wildcard match —
-- `full_name ilike '%term%'` — and no btree index can serve one. Measured on
-- the hosted project (1,262 profiles):
--
--   Seq Scan on profiles pr  (actual time=32.318..74.635 rows=20)
--   Execution Time: 76.259 ms
--
-- 76ms is survivable today. It is also linear in the number of runners, and it
-- runs on EVERY keystroke, against a view that joins four tables under RLS. At
-- 50k runners the same scan is seconds, per character typed.
--
-- pg_trgm's GIN operator class indexes three-character substrings, which is
-- what makes an unanchored ILIKE indexable at all. It supports LIKE, ILIKE, ~
-- and ~* — the case-insensitivity of ILIKE is handled by the opclass, so no
-- lower() expression index is needed.
--
-- The three columns below are exactly the ones the app searches, no more:
--   profiles.full_name  — searched by BOTH the registrations and payments pages
--   profiles.bib_name   — registrations only
--   events.name         — payments only, via admin_payments_v's `event_name`
-- (see searchPattern + the `.or(...)` calls in lib/queries/{registrations,
-- payments}.ts, and the `ilike p_q` branches in the admin_*_aggregates RPCs —
-- table and KPI row must stay searchable by the same predicate or the cards
-- disagree with the rows beneath them.)
--
-- Deliberately NOT `create index concurrently`: `supabase db push` runs each
-- migration inside a transaction, and CONCURRENTLY cannot run there. These are
-- small tables (~1.3k profiles, ~20 events) so a plain build is milliseconds
-- and the brief ACCESS EXCLUSIVE lock is not worth engineering around. That
-- calculus changes if profiles ever reaches the millions — at which point the
-- index should be built by hand with CONCURRENTLY, outside a migration.
--
-- Additive only: an extension and three indexes. No policy, grant, column or
-- query semantics change, so this cannot alter what any caller can read or
-- what any query returns — only how fast the planner can find it.

-- Extensions live in `extensions` here (see pgcrypto, uuid-ossp,
-- pg_stat_statements), not public — so the operator class has to be schema
-- qualified below, since `extensions` is not on the default search_path.
create extension if not exists pg_trgm with schema extensions;

create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (full_name extensions.gin_trgm_ops);

create index if not exists profiles_bib_name_trgm_idx
  on public.profiles using gin (bib_name extensions.gin_trgm_ops);

create index if not exists events_name_trgm_idx
  on public.events using gin (name extensions.gin_trgm_ops);
