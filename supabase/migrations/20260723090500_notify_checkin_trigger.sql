-- #6 attendance scanned. Design §6.3.
create or replace function fn_notify_on_checkin() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_name text;
begin
  select r.user_id into v_uid from registrations r where r.id = new.registration_id;
  select name into v_name from events where id = new.event_id;
  if v_uid is not null then
    insert into notifications (user_id, type, title, body, data)
    values (v_uid, 'checked_in', 'You''re checked in',
            'Checked in at ' || coalesce(v_name,'the event') || '. Enjoy your race.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.registration_id));
  end if;
  return new;
end; $$;

create trigger trg_checkins_notify after insert on checkins
  for each row execute function fn_notify_on_checkin();
