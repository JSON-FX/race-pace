-- Expo push tokens per device. Mobile upserts its own token on login. Design §5.3.
create table device_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,
  platform   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index device_tokens_user_idx on device_tokens (user_id);

alter table device_tokens enable row level security;
create policy "device_tokens_read_own"   on device_tokens for select using (user_id = auth.uid());
create policy "device_tokens_insert_own" on device_tokens for insert with check (user_id = auth.uid());
create policy "device_tokens_update_own" on device_tokens for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "device_tokens_delete_own" on device_tokens for delete using (user_id = auth.uid());

grant select, insert, update, delete on device_tokens to authenticated;
grant all on device_tokens to service_role;
