-- Hosted/local audit found decrement_slot executable by anon/authenticated only
-- on hosted. The original migration revoked PUBLIC, leaving any named-role
-- grants from Supabase provisioning intact. Preserve the intended service-only
-- contract without changing the SECURITY INVOKER body or any category policies.
revoke execute on function public.decrement_slot(uuid) from public, anon, authenticated;
grant execute on function public.decrement_slot(uuid) to service_role;
