-- Runner profile PSGC city. Legacy `city` kept (nullable, unused going forward).
alter table profiles
  add column if not exists city_psgc_code text references psgc_cities(code),
  add column if not exists city_name text,
  add column if not exists province_name text;
