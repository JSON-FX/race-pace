-- 1,200 demo runner accounts, with a full profile each.
--
-- WHY 1,200: registrations have to be spread over DISTINCT runners within one
-- event, and the biggest field in the catalog is 700 (Baungon Sunrise 10K).
-- 1,200 leaves headroom for that plus the pending/refunded entries seeded on
-- top, without a runner ever appearing twice on the same start list.
--
-- Ids are structured, not random: 00000000-0000-4000-8000-<12-digit index>.
-- That makes the whole cohort selectable with one LIKE, so this file — and
-- everything derived from it — is re-runnable.
--
-- Password for every account is password123, same as the staff accounts in
-- supabase/seed.sql, so you can sign in as any runner and see My Races.

begin;

-- ── Accounts ────────────────────────────────────────────────────────────────
with n as (select generate_series(1, 1200) i)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
  'authenticated', 'authenticated',
  'runner' || lpad(i::text, 4, '0') || '@racepace.test',
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now() - (i % 400) * interval '1 day',
  now() - (i % 400) * interval '1 day',
  now() - (i % 400) * interval '1 day',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, '', '', '', ''
from n
on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  extensions.gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', u.created_at, u.created_at, u.created_at
from auth.users u
where u.id::text like '00000000-0000-4000-8000-%'
  and not exists (
    select 1 from auth.identities ai
    where ai.user_id = u.id and ai.provider = 'email'
  );

-- ── Profiles ────────────────────────────────────────────────────────────────
-- Names are drawn from three arrays by co-prime strides, so the 1,200 rows are
-- varied without a random() call — this file has to produce the same cohort
-- every time it runs.
with
  fn as (select array[
    'Juan','Jose','Mark','John Paul','Christian','Michael','Ronnel','Jayson','Dexter','Arnel',
    'Ramil','Niño','Rey','Joel','Allan','Kevin','Jerome','Bryan','Roldan','Emmanuel',
    'Maria','Ana','Jenny','Rosalie','Cristina','Grace','Michelle','Aileen','Jasmin','Kimberly',
    'Charmaine','Rowena','Divina','Liezel','Marilou','Sheila','Ivy','Precious','Angeline','Rhea',
    'Ferdinand','Gilbert','Rodel','Salvador','Wilfredo','Benjie','Noel','Elmer','Vicente','Teodoro'
  ]::text[] a),
  ln as (select array[
    'Santos','Reyes','Cruz','Bautista','Ocampo','Garcia','Mendoza','Torres','Gonzales','Ramos',
    'Aquino','Villanueva','Castillo','Flores','Rivera','Del Rosario','Fernandez','Navarro','Alonzo','Salazar',
    'Lumbao','Cabanlit','Gonzaga','Tampus','Bacarro','Dagondon','Emperado','Pagayon','Sumalpong','Handumon',
    'Baldoza','Quinto','Malinao','Tabamo','Rubio','Casiño','Ondoy','Balanay','Mangubat','Sarile',
    'Abarquez','Ledesma','Pacana','Tagalog','Yamut','Bagalanon','Damasco','Enriquez','Molina','Villamor'
  ]::text[] a),
  mi as (select array['A','B','C','D','E','F','G','J','L','M','N','P','R','S','T','V']::text[] a),
  cities as (
    select c.code, c.name, p.name province,
           row_number() over (order by p.name, c.name) rn,
           count(*) over () total
    from psgc_cities c
    join psgc_provinces p on p.code = c.province_code
    where p.name in ('Bukidnon', 'Misamis Oriental', 'Misamis Occidental')
  ),
  n as (select generate_series(1, 1200) i)
insert into profiles (
  id, full_name, bib_name, gender, shirt_size, emergency_contact,
  city, date_of_birth, blood_type, city_psgc_code, city_name, province_name
)
select
  ('00000000-0000-4000-8000-' || lpad(n.i::text, 12, '0'))::uuid,
  first_name || ' ' || middle_initial || '. ' || last_name,
  upper(split_part(first_name, ' ', 1)),
  -- Gender follows the NAME, or the roster reads as nonsense. Entries 1-20 and
  -- 41-50 of `fn` are men's names, 21-40 women's.
  (array['Male','Female','Non-binary','Prefer not to say'])[
    case when n.i % 47 = 0 then 3 when n.i % 53 = 0 then 4
         when fn_idx <= 20 or fn_idx >= 41 then 1 else 2 end],
  (array['XS','S','M','L','XL','XXL'])[1 + (n.i * 5) % 6],
  -- Emergency contact reads as a real one: a differently-named person and a
  -- plausible PH mobile number (09 + 9 digits, never a run of leading zeros).
  (select a[1 + (n.i * 23) % array_length(a, 1)] from fn) || ' ' || last_name
    || ' 09' || (170000000 + (n.i * 7919 * 31) % 829999999)::text,
  city_name,
  date '1970-01-01' + ((n.i * 4409) % 13100) * interval '1 day',
  (array['A+','A-','B+','B-','O+','O-','AB+','AB-','Unknown'])[1 + (n.i * 11) % 9],
  city_code, city_name, province_name
from n
cross join lateral (
  select
    1 + (n.i * 17) % (select array_length(a, 1) from fn) as fn_idx,
    (select a[1 + (n.i * 17) % array_length(a, 1)] from fn) as first_name,
    (select a[1 + (n.i * 31) % array_length(a, 1)] from ln) as last_name,
    (select a[1 + (n.i * 13) % array_length(a, 1)] from mi) as middle_initial,
    (select c.code from cities c where c.rn = 1 + (n.i * 19) % c.total) as city_code,
    (select c.name from cities c where c.rn = 1 + (n.i * 19) % c.total) as city_name,
    (select c.province from cities c where c.rn = 1 + (n.i * 19) % c.total) as province_name
) v
on conflict (id) do update set
  full_name = excluded.full_name, bib_name = excluded.bib_name,
  gender = excluded.gender, shirt_size = excluded.shirt_size,
  emergency_contact = excluded.emergency_contact, city = excluded.city,
  date_of_birth = excluded.date_of_birth, blood_type = excluded.blood_type,
  city_psgc_code = excluded.city_psgc_code, city_name = excluded.city_name,
  province_name = excluded.province_name;

commit;
