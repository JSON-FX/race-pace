-- Race Pace demo seed — 2 organizations, 20 events, all in Bukidnon.
--
-- WHY DATES ARE RELATIVE: the catalog distinguishes four states a runner can
-- see, and two of them are derived from TODAY, not from a status column:
--   * ongoing      — today falls inside [event_date, end_date]
--   * rescheduled  — original_date is set (see 20260720110000_marketplace_fields)
--   * cancelled    — status = 'cancelled'
--   * upcoming     — open/almost_full with a future date
-- Hard-coding absolute dates means the "ongoing" races stop being ongoing the
-- day after you write the seed, and the state is then untestable. Every date
-- below is an offset from current_date, so a `db reset` on any day produces
-- the same mix. See apps/site/lib/eventState.ts for the derivation.
--
-- Per org: 6 open, 1 almost_full, 1 ongoing, 1 cancelled, 1 completed —
-- with 2 of the open ones carrying an original_date (rescheduled).
-- Hero images are 20 DISTINCT objects in the public event-images bucket.

insert into organizations (id, name, slug, brand_color, commission_rate, description) values
  ('00000000-0000-0000-0000-00000000a001','Muspo','muspo','#159A55',0.06,
   'Mountain and ultra-trail racing out of Bukidnon. Kitanglad, Kalatungan, and every ridge in between.'),
  ('00000000-0000-0000-0000-00000000a002','RunWithPoint','runwithpoint','#FF6B4A',0.06,
   'Road racing across Bukidnon — from river-flat 5Ks to the Malaybalay full marathon.');

insert into events (
  id, org_id, name, discipline, status, event_date, end_date, original_date, status_note,
  elevation_gain_m, cutoff_hours, flag_off, venue,
  city_psgc_code, region_name, province_name, city_name, hero_image_url
) values
  ('00000000-0000-0000-0000-000000010009','00000000-0000-0000-0000-00000000a001','Valencia Twin Peaks','trail','completed',current_date - 47,null,null,null,
   2050,16,'04:30:00','Valencia City Sports Complex','101321000','Northern Mindanao','Bukidnon','City of Valencia','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/d200cb67-370c-4df5-82ed-4c4aee73b3b3.jpg'),
  ('00000000-0000-0000-0000-000000010005','00000000-0000-0000-0000-00000000a001','Kalatungan Traverse','ultra','closed',current_date - 1,current_date + 1,null,'Race in progress. Live results are posted at the finish arch in Pangantucan.',
   3120,30,'03:00:00','Kalatungan Mountain Range, Pangantucan','101316000','Northern Mindanao','Bukidnon','Pangantucan','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/28a77a6a-648b-47dd-b07a-a972317997b1.jpg'),
  ('00000000-0000-0000-0000-000000010001','00000000-0000-0000-0000-00000000a001','Dulang-Dulang Vertical','trail','almost_full',current_date + 37,null,null,null,
   1780,12,'05:00:00','Barangay Songco, Lantapan','101310000','Northern Mindanao','Bukidnon','Lantapan','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/394196c8-5728-4e5d-935c-e99276c30553.jpg'),
  ('00000000-0000-0000-0000-000000010008','00000000-0000-0000-0000-00000000a001','Maramag Valley Ultra','ultra','cancelled',current_date + 58,null,null,'Cancelled. The Pulangi crossing is unsafe after the August flooding and no alternate line clears the cut-offs. Full refunds have been processed.',
   2400,20,'04:00:00','Maramag Town Proper','101315000','Northern Mindanao','Bukidnon','Maramag','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/5b9ef4e9-2bfd-4b2b-8376-3f79bac05a97.jpg'),
  ('00000000-0000-0000-0000-000000010000','00000000-0000-0000-0000-00000000a001','Kitanglad Skyline Ultra','ultra','open',current_date + 72,null,null,null,
   2890,22,'04:00:00','Kitanglad Range Natural Park, Lantapan','101310000','Northern Mindanao','Bukidnon','Lantapan','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/d7d9c836-f407-4b75-b8ee-2bd83ad9143e.jpg'),
  ('00000000-0000-0000-0000-000000010002','00000000-0000-0000-0000-00000000a001','Malaybalay Highland Trail','trail','open',current_date + 93,null,null,null,
   1240,10,'05:30:00','Kaamulan Grounds, Malaybalay','101312000','Northern Mindanao','Bukidnon','City of Malaybalay','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/2407f578-6e02-4a9b-abc4-3a8356057398.jpg'),
  ('00000000-0000-0000-0000-000000010006','00000000-0000-0000-0000-00000000a001','Manolo Fortich Sky Race','trail','open',current_date + 107,null,current_date + 23,'Moved from 29 August after the Tagoloan bridge closure. Existing entries carry over automatically.',
   1350,11,'05:00:00','Dahilayan Adventure Park, Manolo Fortich','101314000','Northern Mindanao','Bukidnon','Manolo Fortich','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/0c1364d4-6c26-4084-98c2-114c3ee92f23.jpg'),
  ('00000000-0000-0000-0000-000000010003','00000000-0000-0000-0000-00000000a001','Impasugong Ridge Run','trail','open',current_date + 121,null,null,null,
   1610,14,'04:30:00','Impasug-Ong Municipal Plaza','101305000','Northern Mindanao','Bukidnon','Impasug-Ong','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/6e2e05ad-decd-4713-8d90-c29b77e3639f.jpg'),
  ('00000000-0000-0000-0000-000000010004','00000000-0000-0000-0000-00000000a001','Talakag Forest Loop','cross_country','open',current_date + 170,null,null,null,
   980,8,'06:00:00','Talakag Municipal Gym','101320000','Northern Mindanao','Bukidnon','Talakag','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/8391869f-7b40-47ce-bed0-be6dd580dd24.jpg'),
  ('00000000-0000-0000-0000-000000010007','00000000-0000-0000-0000-00000000a001','Sumilao Falls Trail','trail','open',current_date + 191,null,current_date + 51,'Moved from 26 September at the request of the Sumilao LGU. Same course, same inclusions.',
   1120,9,'05:30:00','Sumilao Municipal Hall','101319000','Northern Mindanao','Bukidnon','Sumilao','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a001/7541d08d-be55-4972-bc9c-6c2e3c50aefd.jpg'),
  ('00000000-0000-0000-0000-000000020009','00000000-0000-0000-0000-00000000a002','Baungon Sunrise 10K','road','completed',current_date - 33,null,null,null,
   60,3,'05:00:00','Baungon Municipal Oval','101301000','Northern Mindanao','Bukidnon','Baungon','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/a8de85f1-518f-44c2-be4f-9f2911deb0ea.jpg'),
  ('00000000-0000-0000-0000-000000020005','00000000-0000-0000-0000-00000000a002','Maramag Night Run','road','closed',current_date,current_date + 1,null,'Flag-off has passed. The course stays live until the 06:00 sweep.',
   90,5,'19:00:00','Maramag Municipal Gym','101315000','Northern Mindanao','Bukidnon','Maramag','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/3190f573-9905-4508-b568-185558e665e4.jpg'),
  ('00000000-0000-0000-0000-000000020000','00000000-0000-0000-0000-00000000a002','Pulangi River Run','road','open',current_date + 51,null,null,null,
   60,6,'05:00:00','Pulangi Riverside Park, Quezon','101317000','Northern Mindanao','Bukidnon','Quezon','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/df63f121-e229-4581-8fbc-2a52f610897e.jpg'),
  ('00000000-0000-0000-0000-000000020002','00000000-0000-0000-0000-00000000a002','Valencia Half Marathon','half_marathon','almost_full',current_date + 66,null,null,null,
   180,4,'04:30:00','Valencia City Hall','101321000','Northern Mindanao','Bukidnon','City of Valencia','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/c638883f-056e-4298-b02e-58db177e8f7a.jpg'),
  ('00000000-0000-0000-0000-000000020003','00000000-0000-0000-0000-00000000a002','Don Carlos Fun Run','fun_run','open',current_date + 101,null,null,null,
   40,3,'05:30:00','Don Carlos Municipal Oval','101304000','Northern Mindanao','Bukidnon','Don Carlos','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/733e6ad1-d063-4645-a049-721e41c6c2d6.jpg'),
  ('00000000-0000-0000-0000-000000020008','00000000-0000-0000-0000-00000000a002','San Fernando River Dash','road','cancelled',current_date + 114,null,null,'Cancelled. The riverside road remains closed for repair with no safe detour. Full refunds have been processed.',
   70,4,'05:00:00','San Fernando Municipal Hall','101318000','Northern Mindanao','Bukidnon','San Fernando','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/7bdfd18f-22b9-4eeb-aeae-6e790d34ab5b.jpg'),
  ('00000000-0000-0000-0000-000000020001','00000000-0000-0000-0000-00000000a002','Malaybalay City Marathon','marathon','open',current_date + 129,null,null,null,
   320,7,'04:00:00','Kaamulan Grounds, Malaybalay','101312000','Northern Mindanao','Bukidnon','City of Malaybalay','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/50397d0f-2447-442a-b099-dcec8c567be8.jpg'),
  ('00000000-0000-0000-0000-000000020006','00000000-0000-0000-0000-00000000a002','Kalilangan Loop Run','road','open',current_date + 136,null,current_date + 44,'Moved from 19 September to avoid a clash with the municipal fiesta. Entries carry over.',
   140,5,'05:00:00','Kalilangan Municipal Hall','101307000','Northern Mindanao','Bukidnon','Kalilangan','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/1d1af234-8ee6-4dcc-b415-39c036d76d97.jpg'),
  ('00000000-0000-0000-0000-000000020004','00000000-0000-0000-0000-00000000a002','Libona Dawn Dash','road','open',current_date + 157,null,null,null,
   110,4,'05:00:00','Libona Municipal Plaza','101311000','Northern Mindanao','Bukidnon','Libona','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/dd88eb9c-5b37-4459-8a5f-d51902ea0a14.jpg'),
  ('00000000-0000-0000-0000-000000020007','00000000-0000-0000-0000-00000000a002','Kibawe Barangay Run','fun_run','open',current_date + 178,null,current_date + 80,'Moved from 25 October after the LGU rescheduled the barangay assembly. Same route.',
   50,3,'05:30:00','Kibawe Town Plaza','101308000','Northern Mindanao','Bukidnon','Kibawe','https://whaqarofxdlzxrelbcrq.supabase.co/storage/v1/object/public/event-images/00000000-0000-0000-0000-00000000a002/c03900f7-26d5-4522-8b10-54c20520d96e.jpg');

insert into categories (
  id, org_id, event_id, code, label, distance_km, base_price, slots_total, slots_taken,
  elevation_gain_m, cutoff_hours, blurb
) values
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010000','65K','65K Skyline',65.00,380000,120,34,2890,22.0,'The full Kitanglad ridge. Qualifier required.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010000','35K','35K',35.00,240000,180,77,1520,14.0,'Half the ridge, all of the climb.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010000','18K','18K',18.00,150000,220,96,720,7.0,'The introduction to Kitanglad.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010001','28K','28K Vertical',28.00,210000,150,138,1780,12.0,'Straight up the second-highest peak in the country.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010001','14K','14K',14.00,140000,180,161,880,7.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010002','32K','32K',32.00,200000,200,58,1240,10.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010002','16K','16K',16.00,130000,250,91,600,6.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010002','8K','8K',8.00,90000,300,112,280,4.0,'First trail? Start here.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010003','42K','42K Ridge',42.00,260000,140,31,1610,14.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010003','21K','21K',21.00,170000,190,64,780,8.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010003','10K','10K',10.00,110000,240,88,340,5.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010004','22K','22K Loop',22.00,160000,180,22,980,8.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010004','11K','11K',11.00,110000,220,37,420,5.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010005','80K','80K Traverse',80.00,450000,90,90,3120,30.0,'Point to point across the whole range.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010005','50K','50K',50.00,320000,120,120,1980,20.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010006','36K','36K Sky',36.00,230000,160,49,1350,11.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010006','18K','18K',18.00,150000,200,73,650,6.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010007','30K','30K',30.00,195000,170,18,1120,9.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010007','15K','15K',15.00,125000,210,29,520,5.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010008','55K','55K Valley',55.00,330000,110,41,2400,20.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010008','25K','25K',25.00,180000,160,67,900,9.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010009','45K','45K Twin Peaks',45.00,280000,130,130,2050,16.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010009','20K','20K',20.00,160000,180,180,760,8.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020000','21K','21K',21.00,140000,300,86,60,4.0,'Flat and fast along the Pulangi.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020000','10K','10K',10.00,95000,400,142,30,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020000','5K','5K',5.00,65000,500,171,15,2.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020001','42K','42K Full Marathon',42.00,180000,350,97,320,7.0,'Certified loop through the city.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020001','21K','21K Half',21.00,130000,450,168,160,4.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020001','10K','10K',10.00,90000,600,214,70,2.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020002','21K','21K Half',21.00,125000,320,301,180,4.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020002','10K','10K',10.00,85000,380,349,80,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020003','10K','10K',10.00,70000,400,88,40,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020003','5K','5K',5.00,50000,500,121,20,2.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020003','3K','3K Family',3.00,35000,600,143,10,2.0,'Bring the whole family.'),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020004','15K','15K',15.00,105000,300,34,110,4.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020004','8K','8K',8.00,75000,380,52,50,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020004','4K','4K',4.00,45000,450,61,20,2.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020005','16K','16K Night',16.00,110000,280,280,90,5.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020005','8K','8K Night',8.00,80000,340,340,45,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020006','18K','18K Loop',18.00,115000,260,27,140,5.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020006','9K','9K',9.00,80000,320,44,70,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020007','10K','10K',10.00,65000,350,19,50,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020007','5K','5K',5.00,45000,420,31,25,2.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020008','12K','12K',12.00,90000,300,58,70,4.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020008','6K','6K',6.00,60000,360,79,30,2.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020009','10K','10K',10.00,70000,320,320,60,3.0,null),
  (gen_random_uuid(),'00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-000000020009','5K','5K',5.00,50000,380,380,25,2.0,null);

-- Add-ons and custom questions on ONE event only, so the registration wizard
-- exercises both branches: this event has both, every other event has neither
-- and must render cleanly without them.
insert into addons (id, org_id, event_id, name, price) values
  ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010009','Event Singlet',60000),
  ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010009','Finisher Package',120000);

insert into form_fields (id, org_id, event_id, key, label, type, required, options, sort_order) values
  ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010009','blood_type','Blood type','select',true, array['A','B','AB','O'],1),
  ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010009','running_club','Running club','text',false,null,2),
  ('00000000-0000-0000-0000-0000000000f3','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-000000010009','shirt_size','Shirt size','select',true, array['S','M','L','XL'],3);

-- Provisioned staff accounts. Password for all three: password123
--
-- ONE ACCOUNT PER ORGANIZATION, plus the platform operator — this mirrors the
-- tenancy model in docs/00-product-overview.md §8, where editor/admin/marshal
-- grants bind to a single org_id and only `super_admin` (org_id null) sees
-- across organizations.
--
-- An earlier seed gave one account `admin` on BOTH orgs so it could upload
-- hero images for each. That is precisely the cross-org account the model says
-- must not exist, and it made the console offer an org switcher to org staff.
-- A super admin can upload for any org anyway: auth_can_admin_org() short-
-- circuits on auth_is_super_admin().
--
--   admin@racepace.test        super_admin   platform-wide
--   muspo@racepace.test        admin         Muspo only
--   runwithpoint@racepace.test admin         RunWithPoint only
--
-- crypt()/gen_salt() come from pgcrypto. Qualified with the extensions schema so
-- this works both locally and on hosted Supabase (where extensions isn't on the
-- search_path).
do $$
declare
  plat  uuid := '00000000-0000-0000-0000-0000000000b1';
  muspo uuid := '00000000-0000-0000-0000-0000000000b2';
  rwp   uuid := '00000000-0000-0000-0000-0000000000b3';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
         v.email, extensions.crypt('password123', extensions.gen_salt('bf')),
         now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', ''
  from (values
    (plat,  'admin@racepace.test'),
    (muspo, 'muspo@racepace.test'),
    (rwp,   'runwithpoint@racepace.test')
  ) as v(id, email);

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  )
  select gen_random_uuid(), v.id, v.id::text,
         jsonb_build_object('sub', v.id::text, 'email', v.email, 'email_verified', true),
         'email', now(), now(), now()
  from (values
    (plat,  'admin@racepace.test'),
    (muspo, 'muspo@racepace.test'),
    (rwp,   'runwithpoint@racepace.test')
  ) as v(id, email);

  -- org_id null = platform-wide. Org admins are bound to exactly one org.
  insert into user_roles (user_id, role, org_id) values
    (plat,  'super_admin', null),
    (muspo, 'admin',       '00000000-0000-0000-0000-00000000a001'),
    (rwp,   'admin',       '00000000-0000-0000-0000-00000000a002');
end $$;
