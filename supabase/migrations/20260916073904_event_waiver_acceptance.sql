-- Null preserves legacy events during rollout. Selecting a version is explicit
-- and irreversible through the organizer API; replacement requires another version.
alter table public.events add column waiver_version_id uuid;
alter table public.events add constraint event_waiver_same_org foreign key(org_id,waiver_version_id)
 references public.organizer_waiver_versions(org_id,id);
alter table public.registrations add column waiver_version_id uuid;
alter table public.registrations add constraint registration_waiver_same_org foreign key(org_id,waiver_version_id)
 references public.organizer_waiver_versions(org_id,id);
alter table public.registrations add column waiver_acceptance jsonb;

create function public.event_select_waiver(p_event_id uuid,p_version_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
 select org_id into v_org from public.events where id=p_event_id for update;
 if auth.uid() is null or v_org is null or not (public.auth_is_super_admin() or exists (
   select 1 from public.user_roles where user_id=auth.uid() and org_id=v_org and role='admin'
 )) then raise exception 'not_authorized' using errcode='42501'; end if;
 if p_version_id is null or not exists(select 1 from public.organizer_waiver_versions where id=p_version_id and org_id=v_org)
 then raise exception 'invalid_waiver_version' using errcode='22023'; end if;
 update public.events set waiver_version_id=p_version_id where id=p_event_id;
end $$;
revoke all on function public.event_select_waiver(uuid,uuid) from public,anon;
grant execute on function public.event_select_waiver(uuid,uuid) to authenticated,service_role;

create function public.registration_record_waiver()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_version uuid; v_hash text; v_passport public.runner_passports;
begin
 if TG_OP='UPDATE' then
  if new.waiver_version_id is distinct from old.waiver_version_id or new.waiver_acceptance is distinct from old.waiver_acceptance
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
 -- Current cutover is self-only. Never claim helper acceptance is personal.
 if v_passport.claimed_user_id is distinct from new.user_id or new.user_id is distinct from new.booked_by_user_id or new.user_id is null
 then raise exception 'assisted_registration_not_enabled' using errcode='22023'; end if;
 select content_hash into v_hash from public.organizer_waiver_versions where id=v_version;
 new.waiver_accepted_at := statement_timestamp();
 new.waiver_acceptance := jsonb_build_object(
  'version_id',v_version,'content_hash',v_hash,'participant_passport_id',new.participant_passport_id,
  'booking_actor_id',new.booked_by_user_id,'accepting_name',concat_ws(' ',v_passport.first_name,v_passport.last_name),
  'capacity','participant','method','signed_in_self','accepted_at',new.waiver_accepted_at);
 return new;
end $$;
revoke all on function public.registration_record_waiver() from public,anon,authenticated;
grant execute on function public.registration_record_waiver() to service_role;
-- Trigger order matters: the existing Passport bridge establishes identity first.
create trigger z_registration_record_waiver before insert or update of waiver_version_id,waiver_acceptance,waiver_accepted_at
 on public.registrations for each row execute function public.registration_record_waiver();
