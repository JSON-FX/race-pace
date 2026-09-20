-- Event changes are event-level service messages. Only paid registrations are
-- confirmed attendees, and a helper with several participants needs one
-- event message rather than one copy per participant.
create or replace function public.transactional_email_event_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_type text;
  v_payload jsonb := '{}'::jsonb;
  v_changed text[] := '{}'::text[];
  v_change_key text;
begin
  if old.status is distinct from 'cancelled' and new.status = 'cancelled' then
    v_type := 'event_cancelled';
    v_payload := jsonb_build_object('status_note',new.status_note);
    v_change_key := 'cancelled';
  elsif new.event_date is distinct from old.event_date
     or new.end_date is distinct from old.end_date then
    v_type := 'event_rescheduled';
    v_payload := jsonb_build_object(
      'previous_event_date',old.event_date,
      'event_date',new.event_date,
      'previous_end_date',old.end_date,
      'end_date',new.end_date
    );
    v_change_key := concat_ws(':','rescheduled',coalesce(new.event_date::text,'none'),coalesce(new.end_date::text,'none'));
  else
    if new.name is distinct from old.name then v_changed := array_append(v_changed,'name'); end if;
    if new.place is distinct from old.place then v_changed := array_append(v_changed,'place'); end if;
    if new.venue is distinct from old.venue then v_changed := array_append(v_changed,'venue'); end if;
    if new.region_name is distinct from old.region_name then v_changed := array_append(v_changed,'region_name'); end if;
    if new.province_name is distinct from old.province_name then v_changed := array_append(v_changed,'province_name'); end if;
    if new.city_name is distinct from old.city_name then v_changed := array_append(v_changed,'city_name'); end if;
    if new.description is distinct from old.description then v_changed := array_append(v_changed,'description'); end if;
    if new.schedule is distinct from old.schedule then v_changed := array_append(v_changed,'schedule'); end if;
    if new.inclusions is distinct from old.inclusions then v_changed := array_append(v_changed,'inclusions'); end if;
    if new.flag_off is distinct from old.flag_off then v_changed := array_append(v_changed,'flag_off'); end if;
    if new.elevation_gain_m is distinct from old.elevation_gain_m then v_changed := array_append(v_changed,'elevation_gain_m'); end if;
    if new.cutoff_hours is distinct from old.cutoff_hours then v_changed := array_append(v_changed,'cutoff_hours'); end if;
    if new.registration_closes_at is distinct from old.registration_closes_at then v_changed := array_append(v_changed,'registration_closes_at'); end if;
    if new.kit_edit_closes_at is distinct from old.kit_edit_closes_at then v_changed := array_append(v_changed,'kit_edit_closes_at'); end if;
    if new.check_in_required is distinct from old.check_in_required then v_changed := array_append(v_changed,'check_in_required'); end if;
    if new.status_note is distinct from old.status_note then v_changed := array_append(v_changed,'status_note'); end if;
    if cardinality(v_changed) = 0 then return new; end if;
    v_type := 'event_updated';
    v_payload := jsonb_build_object('changed_fields',to_jsonb(v_changed));
    v_change_key := 'updated:' || txid_current()::text;
  end if;

  insert into public.transactional_email_jobs(
    type,user_id,registration_id,event_id,dedup_key,payload
  )
  select v_type,recipient.user_id,recipient.registration_id,new.id,
    concat_ws(':',v_type,new.id::text,recipient.user_id::text,v_change_key),v_payload
  from (
    select distinct on (coalesce(r.booked_by_user_id,r.user_id))
      coalesce(r.booked_by_user_id,r.user_id) as user_id,
      r.id as registration_id
    from public.registrations r
    where r.event_id = new.id
      and r.status = 'paid'
      and coalesce(r.booked_by_user_id,r.user_id) is not null
    order by coalesce(r.booked_by_user_id,r.user_id),r.created_at,r.id
  ) recipient
  on conflict (dedup_key) do nothing;
  return new;
end $$;

revoke all on function public.transactional_email_event_change()
  from public,anon,authenticated,service_role;
