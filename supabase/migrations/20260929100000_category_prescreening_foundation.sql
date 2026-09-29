-- Additive foundation. Admissions are introduced separately so deployment can
-- expand the schema before replacing either application's checkout contract.
alter table public.categories
  add column reservation_enabled boolean not null default false,
  add column reservation_slots integer not null default 0,
  add column reservation_fee_cents integer,
  add column reservation_sales_close_at timestamptz,
  add column entry_payment_deadline_at timestamptz,
  add column inclusions text[] not null default '{}',
  add column prescreening_enabled boolean not null default false,
  add column prescreening_requirement text,
  add constraint category_reservation_allocation check (reservation_slots between 0 and slots_total),
  add constraint category_reservation_fee check (reservation_fee_cents is null or reservation_fee_cents > 0),
  add constraint category_reservation_settings check (not reservation_enabled or
    (reservation_slots > 0 and reservation_fee_cents is not null and
     reservation_sales_close_at is not null and entry_payment_deadline_at is not null and
     entry_payment_deadline_at > reservation_sales_close_at)),
  add constraint category_prescreening_requirement check (not prescreening_enabled or
    (prescreening_requirement is not null and length(btrim(prescreening_requirement)) between 1 and 4000));

-- Every existing distance used the same event inclusions. Copy the exact array;
-- retain the event copy while old clients still read it.
update public.categories c set inclusions=coalesce(e.inclusions,'{}'::text[])
from public.events e where e.id=c.event_id;

-- Composite keys make tenant/category identity a database invariant even for
-- service-role calls. UUID uniqueness alone does not enforce tenant ownership.
alter table public.categories add constraint categories_prescreening_scope unique (id,event_id,org_id);
alter table public.events add constraint events_prescreening_scope unique (id,org_id);

create table public.prescreening_uploads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  event_id uuid not null,
  category_id uuid not null,
  participant_passport_id uuid not null references public.runner_passports(id),
  booked_by_user_id uuid not null references auth.users(id),
  object_path text not null unique,
  content_type text check (content_type in ('image/jpeg','image/png','image/webp')),
  size_bytes integer check (size_bytes between 1 and 10000000),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(category_id,event_id,org_id) references public.categories(id,event_id,org_id),
  constraint prescreening_upload_path check (object_path=org_id::text||'/'||booked_by_user_id::text||'/'||id::text),
  constraint prescreening_upload_verified check (verified_at is null or (content_type is not null and size_bytes is not null)),
  unique(id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id)
);

create table public.prescreening_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  event_id uuid not null,
  booked_by_user_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  checkout_intent text not null check (checkout_intent in ('entry','reservation')),
  request_snapshot jsonb not null,
  status text not null default 'reviewing' check (status in ('reviewing','ready','completed','cancelled','expired')),
  payment_ready_at timestamptz,
  payment_deadline_at timestamptz,
  booking_order_id uuid unique references public.booking_orders(id),
  event_reservation_id uuid unique references public.event_reservations(id),
  created_at timestamptz not null default now(),
  foreign key(event_id,org_id) references public.events(id,org_id),
  unique(booked_by_user_id,idempotency_key),
  unique(id,org_id,event_id,booked_by_user_id),
  constraint prescreening_payment_window check (
    (payment_ready_at is null and payment_deadline_at is null) or
    (payment_ready_at is not null and payment_deadline_at=payment_ready_at+interval '72 hours')),
  constraint prescreening_checkout_path check (booking_order_id is null or event_reservation_id is null)
);

create table public.prescreening_applications (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  org_id uuid not null,
  event_id uuid not null,
  category_id uuid not null,
  participant_passport_id uuid not null references public.runner_passports(id),
  booked_by_user_id uuid not null references auth.users(id),
  participant_name text not null,
  is_managed boolean not null,
  screening_required boolean not null,
  requirement_snapshot text,
  proof_upload_id uuid unique,
  explanation text check (length(explanation)<=4000),
  decision text not null check (decision in ('pending','approved','not_required','rejected')),
  rejection_reason text check (length(rejection_reason)<=4000),
  reviewed_by_user_id uuid references auth.users(id),
  reviewed_at timestamptz,
  -- A terminal release is explicit. Time passing alone cannot release a review
  -- hold or an unresolved provider checkout.
  released_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(batch_id,org_id,event_id,booked_by_user_id)
    references public.prescreening_batches(id,org_id,event_id,booked_by_user_id),
  foreign key(category_id,event_id,org_id) references public.categories(id,event_id,org_id),
  foreign key(proof_upload_id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id)
    references public.prescreening_uploads(id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id),
  unique(batch_id,participant_passport_id),
  constraint prescreening_proof_required check (
    (screening_required and requirement_snapshot is not null and proof_upload_id is not null and decision<>'not_required') or
    (not screening_required and decision='not_required' and proof_upload_id is null)),
  constraint prescreening_review_record check (
    (decision in ('pending','not_required') and reviewed_by_user_id is null and reviewed_at is null) or
    (decision in ('approved','rejected') and reviewed_by_user_id is not null and reviewed_at is not null)),
  constraint prescreening_rejection_reason check (decision<>'rejected' or
    (rejection_reason is not null and length(btrim(rejection_reason))>0 and released_at is not null))
);
create unique index prescreening_one_live_application on public.prescreening_applications(event_id,participant_passport_id)
  where released_at is null;
create index prescreening_review_queue on public.prescreening_applications(org_id,created_at) where decision='pending' and released_at is null;
create index prescreening_category_holds on public.prescreening_applications(category_id) where released_at is null;
create index prescreening_batch_applications on public.prescreening_applications(batch_id);
create index prescreening_booker_batches on public.prescreening_batches(booked_by_user_id,created_at desc);
create index prescreening_due_batches on public.prescreening_batches(payment_deadline_at) where status='ready';

alter table public.registrations add column prescreening_application_id uuid references public.prescreening_applications(id);
alter table public.event_reservation_places
  add column category_id uuid,
  add column prescreening_application_id uuid references public.prescreening_applications(id),
  add column reservation_fee_cents integer check (reservation_fee_cents>=0),
  add column platform_fee_cents integer check (platform_fee_cents>=0),
  add column entry_payment_deadline_at timestamptz,
  add foreign key(category_id,event_id,org_id) references public.categories(id,event_id,org_id);
create index registrations_prescreening_application on public.registrations(prescreening_application_id) where prescreening_application_id is not null;
create index reservation_places_category on public.event_reservation_places(category_id) where status='held';

alter table public.prescreening_uploads enable row level security;
alter table public.prescreening_batches enable row level security;
alter table public.prescreening_applications enable row level security;
-- Proof uploads can precede submission. Organizers only see submitted proof;
-- the signed-view endpoint checks the application and reviewer permissions.
create policy prescreening_upload_booker on public.prescreening_uploads for select to authenticated
  using (booked_by_user_id=auth.uid());
create policy prescreening_batch_read on public.prescreening_batches for select to authenticated
  using (booked_by_user_id=auth.uid() or public.auth_can_admin_org(org_id));
create policy prescreening_application_read on public.prescreening_applications for select to authenticated
  using (booked_by_user_id=auth.uid() or public.auth_can_admin_org(org_id));
grant select on public.prescreening_uploads,public.prescreening_batches,public.prescreening_applications to authenticated;
grant all on public.prescreening_uploads,public.prescreening_batches,public.prescreening_applications to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('prescreening-proofs','prescreening-proofs',false,10000000,array['image/jpeg','image/png','image/webp']);
create policy prescreening_proof_insert on storage.objects for insert to authenticated with check (
  bucket_id='prescreening-proofs' and exists (
    select 1 from public.prescreening_uploads u where u.object_path=name and u.booked_by_user_id=auth.uid()
      and u.verified_at is null and u.created_at>now()-interval '24 hours'
  )
);
-- No SELECT/UPDATE/DELETE object policy: signed URLs come from an authorized
-- server operation. Uploaded objects cannot be replaced after verification.
