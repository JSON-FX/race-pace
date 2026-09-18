-- Keep legacy self-registration prefill current during the participant cutover.
-- Managed Passports never write the helper's profile, and bib names are preserved.
create function public.passport_sync_self_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.claimed_user_id is not null then
    insert into public.profiles(id,full_name,date_of_birth,gender,emergency_contact,shirt_size,blood_type)
    values(new.claimed_user_id,
      nullif(pg_catalog.concat_ws(' ',nullif(new.first_name,''),nullif(new.last_name,'')),''),
      new.date_of_birth,new.gender,
      nullif(pg_catalog.concat_ws(' — ',nullif(new.emergency_contact_name,''),nullif(new.emergency_contact_number,'')),''),
      new.shirt_size,new.blood_type)
    on conflict(id) do update set full_name=excluded.full_name,date_of_birth=excluded.date_of_birth,
      gender=excluded.gender,emergency_contact=excluded.emergency_contact,
      shirt_size=excluded.shirt_size,blood_type=excluded.blood_type;
  end if;
  return new;
end $$;
revoke all on function public.passport_sync_self_profile() from public, anon, authenticated;
grant execute on function public.passport_sync_self_profile() to service_role;
create trigger passport_sync_self_profile after update of first_name,last_name,date_of_birth,
  gender,emergency_contact_name,emergency_contact_number,shirt_size,blood_type
  on public.runner_passports for each row execute function public.passport_sync_self_profile();
