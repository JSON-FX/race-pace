-- New version exercised only in isolated local resets; not applied to hosted projects.
-- Runner names enter through Passport edits, legacy profiles and several checkout
-- paths. Normalize at storage, including frozen display labels, without rewriting
-- waiver/audit evidence or Google-owned Auth metadata.
create function public.person_name_title_case(p_name text)
returns text language plpgsql immutable strict parallel safe security invoker set search_path = '' as $$
declare v_name text; v_result text := ''; v_part text; v_upper text; v_suffix text;
begin
  v_name := pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(
    pg_catalog.normalize(p_name, 'NFC'), U&'[[:space:]\FEFF]+', ' ', 'g')));
  -- initcap treats apostrophes as part of a word (O'neill). Explicit letter
  -- runs handle both apostrophe styles and hyphens while preserving punctuation.
  for v_part in select m[1] from pg_catalog.regexp_matches(v_name,
    '[[:alpha:]][^[:punct:][:space:][:digit:][:cntrl:]]*|.', 'g') m loop
    v_upper := pg_catalog.upper(pg_catalog.left(v_part, 1));
    v_result := v_result || pg_catalog.left(v_upper, 1) || pg_catalog.lower(pg_catalog.substr(v_upper, 2))
      || pg_catalog.substr(v_part, 2);
  end loop;
  v_suffix := pg_catalog.substring(v_result, '[^ ]+$');
  if pg_catalog.lower(pg_catalog.rtrim(v_suffix, '.')) in ('ii','iii','iv','v','vi','vii','viii','ix','x') then
    v_result := pg_catalog.left(v_result, pg_catalog.length(v_result) - pg_catalog.length(v_suffix))
      || pg_catalog.upper(v_suffix);
  end if;
  return pg_catalog.normalize(v_result, 'NFC');
end $$;
revoke all on function public.person_name_title_case(text) from public, anon, authenticated;
-- Invoker triggers need this pure text operation; it reads no private data.
grant execute on function public.person_name_title_case(text) to authenticated, service_role;

create function public.normalize_runner_names()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_key text;
begin
  case tg_table_name
    when 'profiles' then
      new.full_name := public.person_name_title_case(new.full_name);
    when 'runner_passports' then
      new.first_name := public.person_name_title_case(new.first_name);
      new.last_name := public.person_name_title_case(new.last_name);
      new.legacy_full_name := public.person_name_title_case(new.legacy_full_name);
    when 'registrations' then
      foreach v_key in array array['first_name','last_name','full_name'] loop
        if pg_catalog.jsonb_typeof(new.custom_data -> v_key) = 'string' then
          new.custom_data := pg_catalog.jsonb_set(new.custom_data, array[v_key],
            pg_catalog.to_jsonb(public.person_name_title_case(new.custom_data ->> v_key)), false);
        end if;
      end loop;
    when 'event_reservation_places', 'prescreening_applications' then
      new.participant_name := public.person_name_title_case(new.participant_name);
    else raise exception 'unsupported_runner_name_table';
  end case;
  return new;
end $$;
revoke all on function public.normalize_runner_names() from public, anon, authenticated;
grant execute on function public.normalize_runner_names() to service_role;

create trigger normalize_runner_names before insert or update of full_name on public.profiles
  for each row execute function public.normalize_runner_names();
create trigger normalize_runner_names before insert or update of first_name,last_name,legacy_full_name on public.runner_passports
  for each row execute function public.normalize_runner_names();
-- Run after the reserved-Passport attachment and other BEFORE triggers.
create trigger zzz_normalize_runner_names before insert or update of custom_data on public.registrations
  for each row execute function public.normalize_runner_names();
create trigger normalize_runner_names before insert or update of participant_name on public.event_reservation_places
  for each row execute function public.normalize_runner_names();
create trigger normalize_runner_names before insert or update of participant_name on public.prescreening_applications
  for each row execute function public.normalize_runner_names();

-- Existing runner name repair. This migration executes transactionally: the
-- ALTER TABLE lock blocks concurrent writes until the bridge is restored.
-- Firing the bridge here could erase a legacy-only profile or overwrite its
-- unrelated birth/contact fields. Repair each stored label independently.
alter table public.runner_passports disable trigger passport_sync_self_profile;
update public.runner_passports set
  first_name = public.person_name_title_case(first_name),
  last_name = public.person_name_title_case(last_name),
  legacy_full_name = public.person_name_title_case(legacy_full_name)
where first_name is distinct from public.person_name_title_case(first_name)
   or last_name is distinct from public.person_name_title_case(last_name)
   or legacy_full_name is distinct from public.person_name_title_case(legacy_full_name);
alter table public.runner_passports enable trigger passport_sync_self_profile;

update public.profiles set full_name = public.person_name_title_case(full_name)
where full_name is distinct from public.person_name_title_case(full_name);

update public.registrations r set custom_data = r.custom_data
where exists (select 1 from unnest(array['first_name','last_name','full_name']) k
  where pg_catalog.jsonb_typeof(r.custom_data -> k) = 'string'
    and r.custom_data ->> k is distinct from public.person_name_title_case(r.custom_data ->> k));

update public.event_reservation_places set participant_name = public.person_name_title_case(participant_name)
where participant_name is distinct from public.person_name_title_case(participant_name);
update public.prescreening_applications set participant_name = public.person_name_title_case(participant_name)
where participant_name is distinct from public.person_name_title_case(participant_name);
