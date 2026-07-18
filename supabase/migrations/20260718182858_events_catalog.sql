create table events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  place text,
  region text,
  event_date date,
  flag_off time,
  elevation_gain_m integer,
  cutoff_hours integer,
  status event_status not null default 'draft',
  hero_image_url text,
  created_at timestamptz not null default now()
);
create index on events(org_id);
alter table events enable row level security;
create policy "events_read_published" on events
  for select using (status <> 'draft');

create table categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  code text not null,
  label text not null,
  distance_km numeric(6,2),
  base_price integer not null,
  slots_total integer not null default 0,
  slots_taken integer not null default 0,
  created_at timestamptz not null default now()
);
create index on categories(event_id);
alter table categories enable row level security;
create policy "categories_read_published" on categories
  for select using (exists (
    select 1 from events e where e.id = categories.event_id and e.status <> 'draft'));

create table addons (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  name text not null,
  price integer not null,
  created_at timestamptz not null default now()
);
create index on addons(event_id);
alter table addons enable row level security;
create policy "addons_read_published" on addons
  for select using (exists (
    select 1 from events e where e.id = addons.event_id and e.status <> 'draft'));

create table form_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  key text not null,
  label text not null,
  type field_type not null,
  required boolean not null default false,
  options text[],
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (event_id, key)
);
create index on form_fields(event_id);
alter table form_fields enable row level security;
create policy "form_fields_read_published" on form_fields
  for select using (exists (
    select 1 from events e where e.id = form_fields.event_id and e.status <> 'draft'));

-- Data API grants
grant select on events, categories, addons, form_fields to anon, authenticated;
grant all on events, categories, addons, form_fields to service_role;
