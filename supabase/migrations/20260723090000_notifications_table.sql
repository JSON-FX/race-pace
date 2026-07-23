-- Facebook-style notification inbox. Rows are created by DB triggers (Phase 2);
-- clients only read their own and toggle read_at. See push-notifications design §5.2.
create type notification_type as enum (
  'registered','paid','event_reminder','event_cancelled',
  'event_rescheduled','event_created','checked_in','event_completed'
);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         notification_type not null,
  title        text not null,
  body         text not null,
  data         jsonb not null default '{}'::jsonb,   -- { event_id?, registration_id? }
  read_at      timestamptz,                          -- null = unread
  push_sent_at timestamptz,                          -- null = device push pending
  dedup_key    text unique,                          -- nulls distinct; guards reminders/broadcast
  created_at   timestamptz not null default now()
);
create index notifications_user_created_idx on notifications (user_id, created_at desc);
create index notifications_user_unread_idx on notifications (user_id) where read_at is null;
create index notifications_push_pending_idx on notifications (created_at) where push_sent_at is null;

alter table notifications enable row level security;

create policy "notifications_read_own" on notifications
  for select using (user_id = auth.uid());
-- Clients may only flip read_at on their own rows (column grant below enforces which columns).
create policy "notifications_update_own" on notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Data API grants: select + a column-scoped update. No insert for clients (triggers/service insert).
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
grant all on notifications to service_role;

-- Live in-app inbox: this is the project's first realtime consumer.
alter publication supabase_realtime add table notifications;
