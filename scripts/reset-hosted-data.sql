-- Wipe every tenant row on a hosted Race Pace project, leaving exactly one way
-- back in: the platform super admin.
--
-- WHY THIS AND NOT `supabase db reset --linked`: a remote reset drops the public
-- schema and replays all 85 migrations against the live project. This repo's
-- rule is that an applied migration is never re-run there (see CLAUDE.md), so a
-- remote reset trades a data problem for a schema-drift problem. Everything
-- below touches DATA only — the migration ledger and the live schema are
-- untouched, which is why this is safe to run repeatedly.
--
-- KEPT ON PURPOSE:
--   * auth.users …0000b1 (admin@racepace.test) and its super_admin grant
--   * psgc_regions / psgc_provinces / psgc_cities — reference data, ~1,700 rows
--     that only exist because 20260720140100_psgc_data.sql inserted them
--   * processor_rates — reference data, same reasoning
--
-- STORAGE IS NOT TOUCHED HERE. Files live in S3, not Postgres; deleting the
-- storage.objects row hides a file from the API but leaves the bytes billing.
-- Empty the buckets from the dashboard, or via the Storage API with a secret key.
--
-- Run with:  supabase db query --linked -f scripts/reset-hosted-data.sql

begin;

-- processor_rates.created_by references auth.users with NO ACTION, so a rate
-- entered by an account we are about to delete would abort the delete below.
-- Reference data outlives the operator who typed it; the attribution does not.
update processor_rates
   set created_by = null
 where created_by is distinct from '00000000-0000-0000-0000-0000000000b1'::uuid;

-- One statement so the FKs between these tables never have to be satisfied
-- mid-flight. `cascade` reaches nothing outside this list — verified against
-- pg_constraint before this file was written.
truncate table
  registration_audit,
  registration_addons,
  checkins,
  payments,
  payout_statements,
  registrations,
  addons,
  form_fields,
  categories,
  events,
  notifications,
  device_tokens,
  user_roles,
  organizations
restart identity cascade;

-- Every account except the platform super admin. profiles, auth.identities,
-- auth.sessions and auth.refresh_tokens all cascade off auth.users.
delete from auth.users
 where id <> '00000000-0000-0000-0000-0000000000b1'::uuid;

-- user_roles was truncated above, so the survivor has to be re-granted or the
-- console has no administrator at all. org_id null = platform-wide.
insert into user_roles (user_id, role, org_id)
select '00000000-0000-0000-0000-0000000000b1'::uuid, 'super_admin', null
where exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000b1');

commit;
