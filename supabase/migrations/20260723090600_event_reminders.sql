-- #3 event N days away. Reminder days are the array below. Deduped per (event,user,days)
-- so the daily cron is safe to re-run. Design §6.4.
create or replace function fn_enqueue_event_reminders() returns void
  language plpgsql security definer set search_path = public as $$
declare d int;
begin
  foreach d in array array[7,1] loop
    insert into notifications (user_id, type, title, body, data, dedup_key)
    select r.user_id, 'event_reminder',
           case when d = 1 then '1 day to go' else d || ' days to go' end,
           e.name || case when d = 1 then ' is tomorrow. Get your gear ready.' else ' is coming up. Get ready.' end,
           jsonb_build_object('event_id', e.id),
           'reminder:' || e.id || ':' || r.user_id || ':' || d
    from events e
    join registrations r on r.event_id = e.id and r.status = 'paid'
    where e.status = 'open' and e.event_date = current_date + d
    on conflict (dedup_key) do nothing;
  end loop;
end; $$;

grant execute on function fn_enqueue_event_reminders() to service_role;

-- Daily at 01:00 UTC (~09:00 PH). pg_cron ships on Supabase (local + hosted).
create extension if not exists pg_cron;
select cron.schedule('event-reminders-daily', '0 1 * * *', $$ select fn_enqueue_event_reminders(); $$);
