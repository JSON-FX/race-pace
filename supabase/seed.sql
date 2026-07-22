-- Organizations. a1 (Race Pace) kept for backend tests; a2..a5 populate the
-- marketplace to match the Race Pace design. Avatars/banners are generated in-app
-- from brand_color + initials, so no image URLs are needed.
insert into organizations (id, name, slug, brand_color, commission_rate, description) values
  ('00000000-0000-0000-0000-0000000000a1', 'Race Pace', 'race-pace', '#159A55', 0.10,
   'Trail and ultra races across Davao and the Mt Apo highlands.'),
  ('00000000-0000-0000-0000-0000000000a2', 'Apo Skyrunners Assoc.', 'apo-skyrunners', '#159A55', 0.10,
   'Community of mountain runners staging Mindanao''s toughest sky ultras since 2016. Trail with respect, finish with pride.'),
  ('00000000-0000-0000-0000-0000000000a3', 'Highland Endurance', 'highland-endurance', '#0F766E', 0.10,
   'Endurance trail events across the Bukidnon highlands.'),
  ('00000000-0000-0000-0000-0000000000a4', 'Riverside Runners', 'riverside-runners', '#B45309', 0.10,
   'River and city trail races around Davao.'),
  ('00000000-0000-0000-0000-0000000000a5', 'Kitanglad Highland Runners', 'kitanglad-highland-runners', '#7C3AED', 0.10,
   'Skyraces and highland trails in the Kitanglad range.');

-- Events. e1 kept (+description); e2..e5 are the design's marketplace, incl. one
-- rescheduled (e3) and one cancelled (e4).
-- PSGC codes looked up post-`db reset` from psgc_cities (see migration ..140100):
--   e1/e4 City of Digos/Davao (Davao Del Sur, Davao Region); e2 City of Kidapawan
--   (Cotabato, SOCCSKSARGEN); e3 City of Malaybalay (Bukidnon, Northern Mindanao);
--   e5 Lantapan municipality (Bukidnon, Northern Mindanao).
insert into events (id, org_id, name, place, region, event_date, status, elevation_gain_m, cutoff_hours, description, original_date, status_note, city_psgc_code, region_name, province_name, city_name, venue) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
   'Apo Sky Ultra 2026', 'Mt Apo', 'Davao', '2026-11-14', 'open', 4200, 20,
   'The flagship 100K around Mt Apo — technical ridgelines, mossy forest, and a summit sunrise.', null, null,
   '112403000', 'Davao Region', 'Davao Del Sur', 'City of Digos', 'Kapatagan Base Camp'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a2',
   'Mt. Apo Sky Ultra', 'Kidapawan', 'Davao del Sur', '2026-10-18', 'open', 4300, 18,
   'The flagship 100K around Mindanao''s highest peak — 4,300m of climbing through mossy forest and summit ridgelines.', null, null,
   '124704000', 'SOCCSKSARGEN', 'Cotabato', 'City of Kidapawan', 'Ilomavis Trailhead'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a3',
   'Bukidnon Highland 50', 'Malaybalay', 'Bukidnon', '2026-09-27', 'open', 2600, 14,
   'A fast 50K through pine ridges and cloud forest above Malaybalay. Your slot carries over to the new date.',
   '2026-09-14', 'Your slot carries over to the new date. Registration remains open for the remaining places.',
   '101312000', 'Northern Mindanao', 'Bukidnon', 'City of Malaybalay', 'Malaybalay City Coliseum'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a4',
   'Davao River Trail 21', 'Davao City', 'Davao', '2026-08-30', 'cancelled', 900, 8,
   'A 21K along the Davao river trail.', null,
   'Registrations are closed. Paid runners will be refunded automatically — check My Races for status.',
   '112402000', 'Davao Region', 'Davao Del Sur', 'City of Davao', 'Davao Riverfront Park'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a5',
   'Kitanglad Skyrace', 'Lantapan', 'Bukidnon', '2026-11-22', 'almost_full', 3100, 16,
   'A sky race up the Kitanglad range — the second-highest peaks in the Philippines.', null, null,
   '101310000', 'Northern Mindanao', 'Bukidnon', 'Lantapan', 'Kitanglad Range Natural Park HQ');

-- Categories. e1 keeps c1..c4; e2 uses the design's four distances (c5..c8); e3 c9/ca; e4 cb; e5 cc/cd.
insert into categories (id, org_id, event_id, code, label, distance_km, base_price, slots_total, slots_taken) values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','100k','100K Ultra',100,350000,100,0),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','50k','50K',50,250000,150,0),
  ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','21k','21K',21,150000,200,0),
  ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','10k','10K',10,100000,200,0),
  ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e2','100k','100K Ultra',100,450000,200,158),
  ('00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e2','50k','50K Trail',50,350000,150,62),
  ('00000000-0000-0000-0000-0000000000c7','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e2','21k','21K Half',21,220000,200,80),
  ('00000000-0000-0000-0000-0000000000c8','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e2','10k','10K Fun Run',10,120000,250,40),
  ('00000000-0000-0000-0000-0000000000c9','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000e3','50k','50K',50,320000,120,10),
  ('00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000e3','21k','21K',21,180000,180,5),
  ('00000000-0000-0000-0000-0000000000cb','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000e4','21k','21K',21,120000,150,0),
  ('00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000e5','100k','100K',100,420000,100,88),
  ('00000000-0000-0000-0000-0000000000cd','00000000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-0000000000e5','42k','42K Sky',42,260000,120,96);

-- e1 add-ons + custom form fields (kept for the register flow + backend tests).
insert into addons (id, org_id, event_id, name, price) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','Event Singlet',60000),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','Finisher Package',120000);

insert into form_fields (id, org_id, event_id, key, label, type, required, options, sort_order) values
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','blood_type','Blood type','select',true, array['A','B','AB','O'],1),
  ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','running_club','Running club','text',false,null,2),
  ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','shirt_size','Shirt size','select',true, array['S','M','L','XL'],3);

-- Provisioned admin for the web console (survives db reset). Password: password123
-- crypt()/gen_salt() come from pgcrypto. Qualified with the extensions schema so this
-- works both locally and on hosted Supabase (where extensions isn't on the search_path).
do $$
declare admin_id uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', admin_id, 'authenticated', 'authenticated',
    'admin@racepace.test', extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), admin_id, admin_id::text,
    jsonb_build_object('sub', admin_id::text, 'email', 'admin@racepace.test', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into user_roles (user_id, role, org_id)
  values (admin_id, 'admin', '00000000-0000-0000-0000-0000000000a1');
end $$;
