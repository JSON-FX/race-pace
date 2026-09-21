-- A provider 4xx or a failure before checkout creation proves that no hosted
-- session exists. Release only that narrow state. Network and provider 5xx
-- outcomes remain pending because PayMongo checkout creates are not replay-safe.
create function public.release_rejected_paymongo_checkout(
  p_registration_id uuid,
  p_reason text
) returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.registrations%rowtype;
  p public.payments%rowtype;
begin
  if p_reason is null or btrim(p_reason) = '' then return 'invalid_reason'; end if;
  perform pg_advisory_xact_lock(hashtextextended('single_capture:' || p_registration_id::text, 0));
  select * into r from public.registrations where id = p_registration_id for update;
  select * into p from public.payments where registration_id = p_registration_id for update;
  if r.id is null or p.id is null then return 'not_found'; end if;
  if r.status <> 'pending' or p.status <> 'pending' then return 'already_final'; end if;
  if p.provider <> 'paymongo' or p.provider_ref is not null or p.checkout_url is not null
    then return 'provider_state_mismatch'; end if;
  if exists (
    select 1 from public.single_payment_captures c
    where c.registration_id = p_registration_id
  ) then return 'capture_pending'; end if;

  update public.payments set status = 'failed' where id = p.id;
  update public.registrations set status = 'expired', expires_at = null where id = r.id;
  perform public.record_paymongo_expiry_attempt(
    p_registration_id,
    null,
    'create_rejected',
    jsonb_build_object('reason', left(p_reason, 100))
  );
  return 'released';
end $$;

revoke all on function public.release_rejected_paymongo_checkout(uuid,text)
  from public,anon,authenticated;

grant execute on function public.release_rejected_paymongo_checkout(uuid,text)
  to service_role;
