-- Two demo events under one organizer: one TRAIL, one ROAD.
--
-- Deliberately one of each discipline, because the public site branches on it:
-- `trail` renders the elevation-profile layout, `fun_run` renders the
-- route-ribbon layout. Two registerable events also exercise the home page's
-- multi-event grid; drop to one and the home page switches to the immersive
-- single-event landing (see homeMode() in apps/site/lib/home.ts).
--
-- Every column added in 20260806090000 / 20260806140000 is populated on
-- purpose. Left null, both layouts render in their minimal state and you cannot
-- see the designs — which IS the state a fresh organizer starts in, so being
-- able to compare populated vs empty matters.

insert into organizations (id, name, slug, brand_color, commission_rate, description) values
  ('00000000-0000-0000-0000-0000000000a1', 'Race Pace', 'race-pace', '#159A55', 0.10,
   'Trail, road, and community races across Davao and the Mt Apo highlands.');

-- PSGC codes come from psgc_cities (migration ..140100).
--   e1 City of Digos (Davao Del Sur) · e2 City of Davao (Davao Del Sur).
insert into events (
  id, org_id, name, place, region, event_date, status, discipline,
  elevation_gain_m, cutoff_hours, description, flag_off, inclusions, schedule,
  hero_image_url, gallery,
  city_psgc_code, region_name, province_name, city_name, venue
) values
  -- ── TRAIL → elevation-profile layout ───────────────────────────────────
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
   'Apo Sky Ultra 2026', 'Mt Apo', 'Davao', '2026-11-14', 'open', 'trail',
   4200, 20,
   'The flagship 100K around Mt Apo — technical ridgelines, mossy forest, and a summit sunrise. Four distances share the same trailhead and the same finish arch.',
   '03:00',
   array['Race kit, bib, and timing chip','Six aid stations with hot food','Medical sweep and marshal coverage','Finisher medal and summit certificate'],
   '[{"time":"02:00","label":"Baggage drop and gear check open"},
     {"time":"02:45","label":"Assembly — 100K and 50K"},
     {"time":"03:00","label":"Gun start, 100K and 50K"},
     {"time":"05:00","label":"Gun start, 21K and 10K"},
     {"time":"23:00","label":"Final cut-off, 100K"}]'::jsonb,
   'https://images.unsplash.com/photo-1551632811-561732d1e306?auto=format&fit=crop&w=2000&q=75',
   array['https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1600&q=70',
         'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?auto=format&fit=crop&w=1600&q=70',
         'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1600&q=70'],
   '112403000', 'Davao Region', 'Davao Del Sur', 'City of Digos', 'Kapatagan Base Camp'),

  -- ── ROAD → route-ribbon layout ─────────────────────────────────────────
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1',
   'Davao Sunrise Run 2026', 'Davao City', 'Davao', '2026-10-04', 'open', 'fun_run',
   42, 3,
   'One flat loop through closed city roads, finished before the heat. Water every 2.5 km, pacers on the 10K, and the last finisher gets the same medal as the first.',
   '04:30',
   array['Singlet, bib, and timing chip','Finisher medal for every distance','Water and bananas every 2.5 km','Baggage counter and free race photos'],
   '[{"time":"03:30","label":"Baggage counter and warm-up open"},
     {"time":"04:15","label":"Assembly — line up by distance"},
     {"time":"04:30","label":"Gun start, 21K and 10K"},
     {"time":"04:45","label":"Gun start, 5K and 3K"},
     {"time":"07:30","label":"Awarding and raffle"}]'::jsonb,
   'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=2000&q=75',
   array['https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=1600&q=70',
         'https://images.unsplash.com/photo-1571008887538-b36bb32f4571?auto=format&fit=crop&w=1600&q=70'],
   '112402000', 'Davao Region', 'Davao Del Sur', 'City of Davao', 'People''s Park');

-- Per-distance gain / cut-off / blurb are the columns added in 20260806090000.
-- The event-level figures stay the headline; these are what a runner actually
-- decides on once a 100K and a 10K sit on the same page.
--
-- The ROAD event leaves cut-off null on purpose — fun runs rarely publish one,
-- and the site omits any fact it has no value for rather than printing a zero.
-- Its 10K also ships with slots_taken high enough to show the scarcity state
-- without inventing it.
insert into categories (
  id, org_id, event_id, code, label, distance_km, base_price, slots_total, slots_taken,
  elevation_gain_m, cutoff_hours, blurb
) values
  -- Apo Sky Ultra (trail)
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','100k','100K Ultra',100,350000,100,0,
   4200, 20.0, 'The full loop and the summit sunrise. Qualifier required.'),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','50k','50K',50,250000,150,0,
   2400, 12.0, 'Ridgeline and mossy forest, turning back below the summit.'),
  ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','21k','21K',21,150000,200,0,
   1100, 6.0, 'A first trail half — steep in places, never technical.'),
  ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','10k','10K',10,100000,200,0,
   480, 3.0, 'Forest road and one climb. Good for a first time on trail.'),

  -- Davao Sunrise Run (road)
  ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','21k','21K',21,150000,300,0,
   42, null, 'Half marathon. Road shoes, race belt, one gel.'),
  ('00000000-0000-0000-0000-0000000000c6','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','10k','10K',10,100000,400,358,
   28, null, 'Chasing a personal best on a flat, closed course.'),
  ('00000000-0000-0000-0000-0000000000c7','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','5k','5K',5,80000,500,0,
   12, null, 'The step up. Comfortable for anyone jogging twice a week.'),
  ('00000000-0000-0000-0000-0000000000c8','00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','3k','3K',3,60000,600,0,
   6, null, 'Kids, families, and anyone running their first event.');

-- Add-ons and custom questions on the TRAIL event only, so the registration
-- wizard exercises both branches: e1 has add-ons and event questions, e2 has
-- neither and must render cleanly without them.
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
