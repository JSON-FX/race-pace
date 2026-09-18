-- What reset-hosted-data.sql clears, and what it deliberately keeps.
-- Printed by the `supabase-migrate-fresh` shell function before and after a
-- wipe, so the thing being destroyed is on screen before it is destroyed.
select 'auth.users'          as tbl, count(*) as n from auth.users
union all select 'user_roles',           count(*) from user_roles
union all select 'profiles',             count(*) from profiles
union all select 'organizations',        count(*) from organizations
union all select 'events',               count(*) from events
union all select 'categories',           count(*) from categories
union all select 'addons',               count(*) from addons
union all select 'form_fields',          count(*) from form_fields
union all select 'registrations',        count(*) from registrations
union all select 'registration_addons',  count(*) from registration_addons
union all select 'registration_audit',   count(*) from registration_audit
union all select 'payments',             count(*) from payments
union all select 'payout_statements',    count(*) from payout_statements
union all select 'checkins',             count(*) from checkins
union all select 'notifications',        count(*) from notifications
union all select 'device_tokens',        count(*) from device_tokens
union all select 'storage.objects',      count(*) from storage.objects
-- kept: reference data, restored by no seed and owned by no tenant
union all select 'processor_rates (kept)', count(*) from processor_rates
union all select 'psgc_cities (kept)',     count(*) from psgc_cities
order by 1;
