-- PSGC reference tables (Region → Province → City/Municipality). Public read-only.
create table psgc_regions (
  code text primary key, name text not null,
  region_name text, island_group_code text );
create table psgc_provinces (
  code text primary key, name text not null,
  region_code text not null references psgc_regions(code),
  island_group_code text );
create table psgc_cities (
  code text primary key, name text not null,
  is_city boolean not null default false,
  province_code text references psgc_provinces(code),  -- nullable: NCR / independent cities
  region_code text not null references psgc_regions(code),
  island_group_code text );
create index on psgc_provinces(region_code);
create index on psgc_cities(province_code);
create index on psgc_cities(region_code);

alter table psgc_regions   enable row level security;
alter table psgc_provinces enable row level security;
alter table psgc_cities    enable row level security;
create policy "psgc_regions_read"   on psgc_regions   for select using (true);
create policy "psgc_provinces_read" on psgc_provinces for select using (true);
create policy "psgc_cities_read"    on psgc_cities    for select using (true);

-- Data API grants: Supabase does not auto-expose new tables to anon/authenticated/
-- service_role, so grant explicitly (same pattern as 20260718182546_init_orgs_profiles.sql
-- and 20260718182858_events_catalog.sql). Without this, the select-using(true) policies
-- above are unreachable via PostgREST/supabase-js: role-level privilege is checked before
-- RLS, so anon still gets 42501 "permission denied" despite the policy allowing the row.
grant select on psgc_regions, psgc_provinces, psgc_cities to anon, authenticated;
grant all on psgc_regions, psgc_provinces, psgc_cities to service_role;
