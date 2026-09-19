-- Applied to the staging project on 2026-09-20; never edit this migration in place.
-- Durable counters prevent organizer-inquiry spam across Edge Function isolates.
-- Only salted hashes are stored; raw addresses and email values never enter this table.
create table public.organizer_inquiry_rate_limits (
  key_hash text primary key check (length(key_hash) = 64),
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0),
  updated_at timestamptz not null default now()
);

alter table public.organizer_inquiry_rate_limits enable row level security;
create index organizer_inquiry_rate_limits_updated_at_idx
  on public.organizer_inquiry_rate_limits (updated_at);
revoke all on public.organizer_inquiry_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.organizer_inquiry_rate_limits to service_role;

create or replace function public.consume_organizer_inquiry_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempts integer;
begin
  if length(p_key_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit input' using errcode = '22023';
  end if;

  delete from public.organizer_inquiry_rate_limits
  where updated_at < now() - interval '7 days';

  insert into public.organizer_inquiry_rate_limits as limits (
    key_hash,
    window_started_at,
    attempts,
    updated_at
  ) values (
    p_key_hash,
    now(),
    1,
    now()
  )
  on conflict (key_hash) do update set
    window_started_at = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else limits.window_started_at
    end,
    attempts = case
      when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else limits.attempts + 1
    end,
    updated_at = now()
  returning attempts into v_attempts;

  return v_attempts <= p_limit;
end;
$$;

revoke all on function public.consume_organizer_inquiry_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_organizer_inquiry_limit(text, integer, integer)
  to service_role;
