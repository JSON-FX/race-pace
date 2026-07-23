-- #4 cancelled/rescheduled/created + #5 completed. Design §6.2.
create or replace function fn_notify_on_event_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from 'cancelled' and new.status = 'cancelled' then
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_cancelled', 'Event cancelled',
           new.name || ' has been cancelled.', jsonb_build_object('event_id', new.id)
    from registrations r where r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and new.original_date is distinct from old.original_date and new.original_date is not null then
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_rescheduled', 'Event rescheduled',
           new.name || ' has a new date. Check the details.', jsonb_build_object('event_id', new.id)
    from registrations r where r.event_id = new.id and r.status in ('pending','paid');
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from 'completed' and new.status = 'completed' then
    insert into notifications (user_id, type, title, body, data)
    select r.user_id, 'event_completed', 'You completed ' || new.name || '!',
           'Thanks for joining. See you at the next race.', jsonb_build_object('event_id', new.id)
    from registrations r where r.event_id = new.id and r.status = 'paid';
  end if;

  -- newly published (draft/insert -> open): broadcast to all users, deduped per (event,user).
  if (tg_op = 'INSERT' and new.status = 'open')
     or (tg_op = 'UPDATE' and old.status is distinct from 'open' and new.status = 'open') then
    insert into notifications (user_id, type, title, body, data, dedup_key)
    select p.id, 'event_created', 'New event',
           new.name || ' was just listed. Take a look.',
           jsonb_build_object('event_id', new.id),
           'event_created:' || new.id || ':' || p.id
    from profiles p
    on conflict (dedup_key) do nothing;
  end if;

  return new;
end; $$;

create trigger trg_events_notify after insert or update on events
  for each row execute function fn_notify_on_event_change();
