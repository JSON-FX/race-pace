-- A guest has a Passport, not an invented Auth user. The recorded booker owns
-- the transaction. Guest entry still requires an explicit published waiver.
alter table public.registrations alter column user_id drop not null;
alter table public.registrations add column waiver_acceptance_method text not null default 'signed_in_self'
 check(waiver_acceptance_method in ('signed_in_self','participant_on_helper_device'));
create or replace function public.registration_passport_bridge()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_passport public.runner_passports;
begin
 if new.participant_passport_id is null then
  select * into v_passport from public.runner_passports where claimed_user_id=new.user_id;
 else
  select * into v_passport from public.runner_passports where id=new.participant_passport_id;
 end if;
 if v_passport.id is null then raise exception 'passport_not_found'; end if;
 new.booked_by_user_id:=coalesce(new.booked_by_user_id,new.user_id);
 if new.user_id is distinct from v_passport.claimed_user_id then raise exception 'participant_account_mismatch'; end if;
 if new.booked_by_user_id is null then raise exception 'booking_actor_required'; end if;
 if v_passport.claimed_user_id is distinct from new.booked_by_user_id then
  if v_passport.claimed_user_id is not null or not exists(select 1 from public.passport_managers where passport_id=v_passport.id and user_id=new.booked_by_user_id)
  then raise exception 'participant_not_accessible' using errcode='42501'; end if;
  if new.waiver_version_id is null or new.waiver_acceptance_method<>'participant_on_helper_device'
  then raise exception 'participant_acceptance_required' using errcode='22023'; end if;
 end if;
 new.participant_passport_id:=v_passport.id;
 return new;
end $$;
revoke all on function public.registration_passport_bridge() from public,anon,authenticated;
grant execute on function public.registration_passport_bridge() to service_role;
CREATE OR REPLACE FUNCTION public.registration_record_waiver()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_version uuid; v_hash text; v_passport public.runner_passports;
begin
 if TG_OP='UPDATE' then
  if new.waiver_acceptance_method is distinct from old.waiver_acceptance_method or new.waiver_version_id is distinct from old.waiver_version_id or new.waiver_acceptance is distinct from old.waiver_acceptance
  then raise exception 'waiver_evidence_immutable' using errcode='22023'; end if;
  new.waiver_accepted_at := old.waiver_accepted_at;
  return new;
 end if;
 -- Serializes against version selection, so a stale tab cannot win the gap
 -- between the Edge read and insertion of its reservation.
 select waiver_version_id into v_version from public.events where id=new.event_id for share;
 if v_version is distinct from new.waiver_version_id then
  raise exception 'waiver_version_changed' using errcode='22023';
 end if;
 if v_version is null then new.waiver_acceptance := null; return new; end if;
 select * into v_passport from public.runner_passports where id=new.participant_passport_id;
 if new.user_id is distinct from v_passport.claimed_user_id then
  raise exception 'participant_account_mismatch' using errcode='22023';
 end if;
 if new.user_id is distinct from new.booked_by_user_id and new.waiver_acceptance_method<>'participant_on_helper_device' then
  raise exception 'participant_acceptance_required' using errcode='22023';
 end if;
 select content_hash into v_hash from public.organizer_waiver_versions where id=v_version;
 new.waiver_accepted_at := statement_timestamp();
 new.waiver_acceptance := jsonb_build_object(
  'version_id',v_version,'content_hash',v_hash,'participant_passport_id',new.participant_passport_id,
  'booking_actor_id',new.booked_by_user_id,'accepting_name',concat_ws(' ',v_passport.first_name,v_passport.last_name),
  'capacity','participant','method',case when new.user_id=new.booked_by_user_id then 'signed_in_self' else 'participant_on_helper_device' end,'accepted_at',new.waiver_accepted_at);
 return new;
end $function$;
revoke all on function public.registration_record_waiver() from public,anon,authenticated;
grant execute on function public.registration_record_waiver() to service_role;
drop trigger z_registration_record_waiver on public.registrations;
create trigger z_registration_record_waiver before insert or update of waiver_version_id,waiver_acceptance,waiver_accepted_at,waiver_acceptance_method
 on public.registrations for each row execute function public.registration_record_waiver();
