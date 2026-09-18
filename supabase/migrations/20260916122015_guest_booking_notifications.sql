-- Guest messages go to the recorded booker, never an unverified Passport email.
-- Preserve existing self-reminder dedup keys; guest reminders use registration IDs.
CREATE OR REPLACE FUNCTION public.admin_registration_emails(p_event_id uuid)
 RETURNS TABLE(registration_id uuid, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id, u.email::text
  from public.registrations r
  join public.events e on e.id = r.event_id
  join auth.users u on u.id = coalesce(r.booked_by_user_id,r.user_id)
  where r.event_id = p_event_id
    and public.auth_can_admin_org(e.org_id);
$function$
;
CREATE OR REPLACE FUNCTION public.fn_enqueue_event_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d int;
begin
  foreach d in array array[7,1] loop
    insert into public.notifications (user_id, type, title, body, data, dedup_key)
    select coalesce(r.user_id,r.booked_by_user_id), 'event_reminder',
           case when d = 1 then '1 day to go' else d || ' days to go' end,
           case when r.user_id is null then coalesce(nullif(r.custom_data->>'full_name',''),'Participant') || ' · ' else '' end || e.name || case when d = 1 then ' is tomorrow. Get your gear ready.' else ' is coming up. Get ready.' end,
           jsonb_build_object('event_id', e.id,'registration_id',r.id),
           'reminder:' || e.id || ':' || coalesce(r.user_id::text,'participant:' || r.id::text) || ':' || d
    from public.events e
    join public.registrations r on r.event_id = e.id and r.status = 'paid'
    where coalesce(r.user_id,r.booked_by_user_id) is not null and e.status = 'open' and e.event_date = current_date + d
    on conflict (dedup_key) do nothing;
  end loop;
end; $function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_on_checkin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid; v_name text;
begin
  select coalesce(r.user_id,r.booked_by_user_id) into v_uid from public.registrations r where r.id = new.registration_id;
  select name into v_name from public.events where id = new.event_id;
  if v_uid is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_uid, 'checked_in', 'Participant checked in',
            'Checked in at ' || coalesce(v_name,'the event') || '. Enjoy your race.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.registration_id));
  end if;
  return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_on_event_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'UPDATE' and old.status is distinct from 'cancelled' and new.status = 'cancelled' then
    insert into public.notifications (user_id, type, title, body, data)
    select coalesce(r.user_id,r.booked_by_user_id), 'event_cancelled', 'Event cancelled',
           new.name || ' has been cancelled.', jsonb_build_object('event_id', new.id,'registration_id',r.id)
    from public.registrations r where coalesce(r.user_id,r.booked_by_user_id) is not null and r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and new.original_date is distinct from old.original_date and new.original_date is not null then
    insert into public.notifications (user_id, type, title, body, data)
    select coalesce(r.user_id,r.booked_by_user_id), 'event_rescheduled', 'Event rescheduled',
           new.name || ' has a new date. Check the details.', jsonb_build_object('event_id', new.id,'registration_id',r.id)
    from public.registrations r where coalesce(r.user_id,r.booked_by_user_id) is not null and r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from 'completed' and new.status = 'completed' then
    insert into public.notifications (user_id, type, title, body, data)
    select coalesce(r.user_id,r.booked_by_user_id), 'event_completed', 'Event completed: ' || new.name,
           'Thanks for joining. See you at the next race.', jsonb_build_object('event_id', new.id,'registration_id',r.id)
    from public.registrations r where coalesce(r.user_id,r.booked_by_user_id) is not null and r.event_id = new.id and r.status = 'paid';
  end if;

  -- newly published (draft/insert -> open): broadcast to all users, deduped per (event,user).
  if (tg_op = 'INSERT' and new.status = 'open')
     or (tg_op = 'UPDATE' and old.status is distinct from 'open' and new.status = 'open') then
    insert into public.notifications (user_id, type, title, body, data, dedup_key)
    select p.id, 'event_created', 'New event',
           new.name || ' was just listed. Take a look.',
           jsonb_build_object('event_id', new.id),
           'event_created:' || new.id || ':' || p.id
    from public.profiles p
    on conflict (dedup_key) do nothing;
  end if;

  return new;
end; $function$
;
CREATE OR REPLACE FUNCTION public.fn_notify_on_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text;
begin
  if coalesce(new.user_id,new.booked_by_user_id) is null then return new; end if;
  if tg_op = 'INSERT' then
    select name into v_name from public.events where id = new.event_id;
    if new.status = 'paid' then
      insert into public.notifications (user_id, type, title, body, data)
      values (coalesce(new.user_id,new.booked_by_user_id), 'paid', 'Payment received',
              coalesce(nullif(new.custom_data->>'full_name',''),'Participant') || ' is confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    else
      insert into public.notifications (user_id, type, title, body, data)
      values (coalesce(new.user_id,new.booked_by_user_id), 'registered', 'Registration created',
              'Complete payment for ' || coalesce(nullif(new.custom_data->>'full_name',''),'the participant') || ' at ' || coalesce(v_name,'the event') || '.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from 'paid' and new.status = 'paid' then
    select name into v_name from public.events where id = new.event_id;
    insert into public.notifications (user_id, type, title, body, data)
    values (coalesce(new.user_id,new.booked_by_user_id), 'paid', 'Payment received',
            coalesce(nullif(new.custom_data->>'full_name',''),'Participant') || ' is confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
  end if;
  return new;
end; $function$
;

revoke all on function public.fn_enqueue_event_reminders(),public.fn_notify_on_checkin(),public.fn_notify_on_event_change(),public.fn_notify_on_registration() from public,anon,authenticated;
grant execute on function public.fn_enqueue_event_reminders(),public.fn_notify_on_checkin(),public.fn_notify_on_event_change(),public.fn_notify_on_registration() to service_role;
revoke all on function public.admin_registration_emails(uuid) from public,anon;
grant execute on function public.admin_registration_emails(uuid) to authenticated,service_role;
