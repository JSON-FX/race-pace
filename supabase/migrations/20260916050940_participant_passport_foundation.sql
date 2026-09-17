-- Additive identity foundation. Checkout remains self-only until every money,
-- ticket and roster consumer is migrated. Never infer split names from legacy names.
create table public.runner_passports (
  id uuid primary key default gen_random_uuid(),
  claimed_user_id uuid unique references auth.users(id) on delete set null,
  created_by_user_id uuid references auth.users(id) on delete set null,
  first_name text check (length(first_name) <= 100),
  last_name text check (length(last_name) <= 100),
  team_name text check (length(team_name) <= 150),
  date_of_birth date,
  gender text check (gender in ('Male', 'Female')),
  contact_number text check (length(contact_number) <= 32),
  emergency_contact_name text check (length(emergency_contact_name) <= 200),
  emergency_contact_number text check (length(emergency_contact_number) <= 32),
  emergency_contact_relationship text check (length(emergency_contact_relationship) <= 100),
  participant_email text check (length(participant_email) <= 254),
  shirt_size text,
  blood_type text,
  legacy_full_name text,
  legacy_bib_name text,
  legacy_gender text,
  legacy_emergency_contact text,
  created_at timestamptz not null default now()
);
create index runner_passports_creator_idx on public.runner_passports(created_by_user_id);

create table public.passport_managers (
  passport_id uuid not null references public.runner_passports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (passport_id, user_id)
);
create index passport_managers_user_idx on public.passport_managers(user_id);
alter table public.runner_passports enable row level security;
alter table public.passport_managers enable row level security;
revoke all on public.runner_passports, public.passport_managers from public, anon, authenticated;
grant all on public.runner_passports, public.passport_managers to service_role;
grant select on public.runner_passports, public.passport_managers to authenticated;
grant update (first_name,last_name,team_name,date_of_birth,gender,contact_number,
  emergency_contact_name,emergency_contact_number,emergency_contact_relationship,
  participant_email,shirt_size,blood_type) on public.runner_passports to authenticated;

create policy passport_managers_read_own on public.passport_managers
  for select to authenticated using (user_id = (select auth.uid()));
create policy passports_read_accessible on public.runner_passports
  for select to authenticated using (
    claimed_user_id = (select auth.uid()) or exists (
      select 1 from public.passport_managers m
      where m.passport_id = runner_passports.id and m.user_id = (select auth.uid())
    )
  );
create policy passports_update_accessible on public.runner_passports
  for update to authenticated using (
    claimed_user_id = (select auth.uid()) or exists (
      select 1 from public.passport_managers m
      where m.passport_id = runner_passports.id and m.user_id = (select auth.uid())
    )
  ) with check (
    claimed_user_id = (select auth.uid()) or exists (
      select 1 from public.passport_managers m
      where m.passport_id = runner_passports.id and m.user_id = (select auth.uid())
    )
  );

-- A stable client-generated request UUID makes creation retry-safe. No owner or
-- manager id comes from the request; collision with another actor is refused.
create function public.passport_create_managed(p_passport_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_created uuid;
begin
  if v_actor is null or not exists (
    select 1 from auth.users where id = v_actor and not is_anonymous
  ) then raise exception 'unauthorized' using errcode = '42501'; end if;
  insert into public.runner_passports(id,created_by_user_id)
    values(p_passport_id,v_actor) on conflict(id) do nothing returning id into v_created;
  if v_created is not null then
    insert into public.passport_managers(passport_id,user_id) values(v_created,v_actor);
  elsif not exists (
    select 1 from public.runner_passports p join public.passport_managers m on m.passport_id=p.id
    where p.id=p_passport_id and p.created_by_user_id=v_actor and m.user_id=v_actor
  ) then raise exception 'unavailable_passport' using errcode = '42501'; end if;
  return p_passport_id;
end $$;
revoke all on function public.passport_create_managed(uuid) from public, anon, authenticated;
grant execute on function public.passport_create_managed(uuid) to authenticated, service_role;

-- Keep original values for explicit correction. A migrated Passport deliberately
-- lacks split names/contact fields and therefore cannot pass future completeness.
insert into public.runner_passports(claimed_user_id,created_by_user_id,
  date_of_birth,gender,shirt_size,blood_type,legacy_full_name,legacy_bib_name,
  legacy_gender,legacy_emergency_contact)
select u.id,u.id,p.date_of_birth,
  case when p.gender in ('Male','Female') then p.gender end,
  p.shirt_size,p.blood_type,p.full_name,p.bib_name,p.gender,p.emergency_contact
from auth.users u left join public.profiles p on p.id=u.id;

create function public.passport_provision_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.runner_passports(claimed_user_id,created_by_user_id)
    values(new.id,new.id) on conflict(claimed_user_id) do nothing;
  return new;
end $$;
revoke all on function public.passport_provision_account() from public, anon, authenticated;
grant execute on function public.passport_provision_account() to service_role;
create trigger passport_provision_account after insert on auth.users
  for each row execute function public.passport_provision_account();

alter table public.registrations
  add column participant_passport_id uuid references public.runner_passports(id),
  add column booked_by_user_id uuid references auth.users(id) on delete set null;
create index registrations_passport_idx on public.registrations(participant_passport_id);
create index registrations_booker_idx on public.registrations(booked_by_user_id);
update public.registrations r set participant_passport_id=p.id,booked_by_user_id=r.user_id
  from public.runner_passports p where p.claimed_user_id=r.user_id;

-- Compatibility bridge, deliberately self-only. Existing checkout still assumes
-- user_id is the runner; reject an assisted row until that complete path is replaced.
create function public.registration_passport_bridge()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_passport uuid;
begin
  select id into v_passport from public.runner_passports where claimed_user_id=new.user_id;
  if v_passport is null then raise exception 'missing_self_passport'; end if;
  if (new.participant_passport_id is not null and new.participant_passport_id<>v_passport)
    or (new.booked_by_user_id is not null and new.booked_by_user_id<>new.user_id)
  then raise exception 'assisted_registration_not_enabled'; end if;
  new.participant_passport_id := v_passport;
  new.booked_by_user_id := new.user_id;
  return new;
end $$;
revoke all on function public.registration_passport_bridge() from public, anon, authenticated;
grant execute on function public.registration_passport_bridge() to service_role;
create trigger registration_passport_bridge before insert or update of
  user_id,participant_passport_id,booked_by_user_id on public.registrations
  for each row execute function public.registration_passport_bridge();
