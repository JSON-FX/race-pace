-- #2 registered (new pending row) and #1 paid (insert-as-paid or status->paid).
-- security definer so it can insert into notifications regardless of caller. Design §6.1.
create or replace function fn_notify_on_registration() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_name from events where id = new.event_id;
    if new.status = 'paid' then
      insert into notifications (user_id, type, title, body, data)
      values (new.user_id, 'paid', 'Payment received',
              'You''re confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    else
      insert into notifications (user_id, type, title, body, data)
      values (new.user_id, 'registered', 'You''re registered',
              'Complete payment to secure your slot for ' || coalesce(v_name,'the event') || '.',
              jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
    end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from 'paid' and new.status = 'paid' then
    select name into v_name from events where id = new.event_id;
    insert into notifications (user_id, type, title, body, data)
    values (new.user_id, 'paid', 'Payment received',
            'You''re confirmed for ' || coalesce(v_name,'the event') || '. Your ticket is ready.',
            jsonb_build_object('event_id', new.event_id, 'registration_id', new.id));
  end if;
  return new;
end; $$;

create trigger trg_registrations_notify after insert or update on registrations
  for each row execute function fn_notify_on_registration();
