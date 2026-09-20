-- This migration has only run locally during feature development and remains
-- safe to edit before any hosted rollout. Generated after 20260920240000 was
-- already applied locally and remotely.
-- The CLI-generated timestamp was behind that recorded migration, so this
-- version follows the migration ledger instead of creating an out-of-order
-- production migration.

alter table public.events add column slug text;
alter table public.events add column slug_locked_at timestamptz;

alter table public.events add constraint events_slug_format check (
  slug is null or (
    char_length(slug) between 1 and 80
    and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  )
);

create unique index events_slug_unique
  on public.events(slug)
  where slug is not null;

-- Existing table-level grants already cover future columns. Keep the new
-- column explicit anyway: this repository audits new-column access at the
-- migration that introduces it rather than trusting inherited table grants.
grant select (slug) on public.events to anon, authenticated;
grant select (slug_locked_at) on public.events to authenticated;
grant insert (slug), update (slug) on public.events to authenticated;

create function public.event_keep_slug_stable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.slug_locked_at := case
      when new.status <> 'draft' and new.slug is not null then statement_timestamp()
      else null
    end;
    return new;
  end if;

  -- The timestamp remembers that this row was published even if an organizer
  -- later moves it back to draft. A legacy published event with no slug may
  -- still receive its first address during rollout, then becomes locked.
  if (old.slug_locked_at is not null or (old.status <> 'draft' and old.slug is not null))
    and new.slug is distinct from old.slug then
    raise exception 'event_slug_locked' using errcode = '22023';
  end if;

  new.slug_locked_at := old.slug_locked_at;
  if new.slug_locked_at is null and new.status <> 'draft' and new.slug is not null then
    new.slug_locked_at := statement_timestamp();
  end if;
  return new;
end
$$;

revoke all on function public.event_keep_slug_stable() from public, anon, authenticated;
grant execute on function public.event_keep_slug_stable() to service_role;

create trigger event_keep_slug_stable
before insert or update of slug, status on public.events
for each row execute function public.event_keep_slug_stable();

-- Production already has this real event. Scope the backfill to its immutable
-- id and verify the expected title before touching the new field. Other
-- environments normally have no matching row and perform no data update.
do $$
declare
  current_name text;
  current_slug text;
begin
  select name, slug into current_name, current_slug
  from public.events
  where id = '3f29e7df-fe90-44a6-bfa4-219ffeaad816';

  if found then
    if btrim(current_name) <> 'Yalabyalam Backyard Ultra' then
      raise exception 'yalabyalam_event_title_mismatch';
    end if;
    if current_slug is not null and current_slug <> 'yalabyalam-backyard-ultra' then
      raise exception 'yalabyalam_event_slug_conflict';
    end if;
    update public.events
    set slug = 'yalabyalam-backyard-ultra'
    where id = '3f29e7df-fe90-44a6-bfa4-219ffeaad816'
      and slug is null;
  end if;
end
$$;
