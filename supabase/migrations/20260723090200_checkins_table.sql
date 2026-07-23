-- Minimal race-day check-in (Plan 14 shape). Written only by the check-in Edge
-- Function (service role); one row per registration. Design §5.4.
create table checkins (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  registration_id uuid not null unique references registrations(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  checked_in_at   timestamptz not null default now(),
  checked_in_by   uuid references auth.users(id)
);
create index checkins_event_idx on checkins (event_id);

alter table checkins enable row level security;
-- The runner reads their own check-in; org admins read their org's.
create policy "checkins_read_own_or_admin" on checkins for select
  using (exists (select 1 from registrations r
                 where r.id = checkins.registration_id
                   and (r.user_id = auth.uid() or auth_can_admin_org(r.org_id))));

grant select on checkins to authenticated;
grant all on checkins to service_role;
