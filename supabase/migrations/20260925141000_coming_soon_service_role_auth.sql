-- The Edge Functions invoke these RPCs as service_role, which cannot read
-- auth.users directly in the local and hosted Supabase role model. Keep their
-- existing service-role-only EXECUTE grants and fixed empty search paths.
alter function public.reserve_event_place(uuid, uuid, uuid, text) security definer;
alter function public.subscribe_coming_soon(uuid, uuid, text) security definer;
