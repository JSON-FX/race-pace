-- Follow-up to 20260806190000_admin_kpi_aggregates.sql (admin visual parity V6).
--
-- 1) PUBLIC EXECUTE revoke, missed by the original migration
-- -----------------------------------------------------------
-- `admin_registration_aggregates` and `admin_payment_aggregates` were created with
-- `grant execute ... to authenticated` but never an explicit `revoke ... from public`
-- first. Postgres grants EXECUTE on newly-created functions to PUBLIC by default —
-- `pg_proc.proacl` on both still carries the implicit `=X/postgres` entry alongside
-- the explicit `authenticated=X/postgres` one this migration's predecessor added.
-- `anon` is currently blocked from calling these only incidentally: the views they
-- read (`admin_registrations_v`, `admin_payments_v`, see 20260804120000_admin_list_views.sql)
-- are `security invoker` and RLS on the underlying tables has no anon-readable policy,
-- so an anon caller gets zero rows back rather than an error — not because the RPC
-- itself is unreachable. Same class of gap as 20260806203000's
-- `fn_enqueue_event_reminders` finding; same fix: revoke PUBLIC explicitly and rely
-- on the `authenticated` grant (already present) plus RLS as the real boundary.
--
-- Signatures/behaviour are unchanged — this is a grants-only migration.
revoke execute on function public.admin_registration_aggregates(uuid, text, text, text) from public;
revoke execute on function public.admin_payment_aggregates(uuid, text, text, text)      from public;

-- 2) Missing org_id indexes
-- --------------------------
-- `admin_registration_aggregates`/`admin_payment_aggregates` (and the
-- `admin_registrations_v`/`admin_payments_v` views the Registrations/Payments pages
-- list from) filter on `org_id`, but `registrations`/`payments`
-- (20260718183018_registrations_payments.sql) only ever indexed `event_id`/
-- `user_id` and `registration_id` respectively — every org_id predicate seq-scans
-- the whole table on every KPI-row load and every Registrations/Payments page view.
create index if not exists registrations_org_id_idx on public.registrations(org_id);
create index if not exists payments_org_id_idx on public.payments(org_id);
