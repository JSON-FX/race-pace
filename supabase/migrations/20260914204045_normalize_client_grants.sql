-- Hosted provisioning left named anon/authenticated grants which migrations that
-- revoked only PUBLIC did not remove. Pin the already-tested local client contract.
-- These are table-level grants only: deliberate column grants (organization terms,
-- profiles, etc.) remain intact. Service-role backend grants are preserved.
revoke delete, insert, update on table public.addons from anon;
revoke delete, insert, select, update on table public.admin_event_reg_counts_v from anon;
revoke delete, insert, update on table public.admin_event_reg_counts_v from authenticated;
revoke delete, insert, select, update on table public.admin_event_totals_v from anon;
revoke delete, insert, update on table public.admin_event_totals_v from authenticated;
revoke delete, insert, select, update on table public.admin_org_totals_v from anon;
revoke delete, insert, update on table public.admin_org_totals_v from authenticated;
revoke delete, insert, select, update on table public.admin_payments_v from anon;
revoke delete, insert, update on table public.admin_payments_v from authenticated;
revoke delete, insert, select, update on table public.admin_registrations_v from anon;
revoke delete, insert, update on table public.admin_registrations_v from authenticated;
revoke delete, insert, update on table public.categories from anon;
revoke delete, insert, select, update on table public.checkins from anon;
revoke delete, insert, update on table public.checkins from authenticated;
revoke delete, insert, select, update on table public.device_tokens from anon;
revoke delete, insert, update on table public.events from anon;
revoke delete, insert, update on table public.form_fields from anon;
revoke delete, insert, update on table public.form_fields from authenticated;
revoke delete, insert, select, update on table public.notifications from anon;
revoke delete, insert, update on table public.notifications from authenticated;
revoke delete, insert, update on table public.organizations from anon;
revoke delete, insert on table public.organizations from authenticated;
revoke delete, insert, select, update on table public.payments from anon;
revoke delete, insert, update on table public.payments from authenticated;
revoke delete, insert, select, update on table public.payout_statements from anon;
revoke delete, insert, update on table public.payout_statements from authenticated;
revoke delete, insert, select, update on table public.processor_rate_drift_v from anon;
revoke delete, insert, update on table public.processor_rate_drift_v from authenticated;
revoke delete, insert, select, update on table public.processor_rates from anon;
revoke delete, insert, update on table public.processor_rates from authenticated;
revoke delete, insert, select, update on table public.profiles from anon;
revoke delete on table public.profiles from authenticated;
revoke delete, insert, update on table public.psgc_cities from anon;
revoke delete, insert, update on table public.psgc_cities from authenticated;
revoke delete, insert, update on table public.psgc_provinces from anon;
revoke delete, insert, update on table public.psgc_provinces from authenticated;
revoke delete, insert, update on table public.psgc_regions from anon;
revoke delete, insert, update on table public.psgc_regions from authenticated;
revoke delete, insert, select, update on table public.registration_addons from anon;
revoke delete, insert, update on table public.registration_addons from authenticated;
revoke delete, insert, select, update on table public.registration_audit from anon;
revoke delete, insert, update on table public.registration_audit from authenticated;
revoke delete, insert, select, update on table public.registrations from anon;
revoke insert, update on table public.registrations from authenticated;
revoke delete, insert, update on table public.user_roles from anon;
revoke delete, insert, update on table public.user_roles from authenticated;

-- RLS predicates must be callable wherever their policies are evaluated. Local
-- auth_can_check_in_event lacked these named grants; hosted already had them.
grant execute on function public.auth_can_check_in_event(uuid, uuid)
  to anon, authenticated, service_role;
