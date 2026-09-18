-- Generated through the CLI and ordered after the already-applied 11:40
-- migration. An unbound provider checkout is deliberately never retried:
-- PayMongo's sandbox created distinct sessions for an identical request and
-- Idempotency-Key. Alert platform staff when the expiry worker first sees it.
create function public.notify_unbound_paymongo_checkout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.outcome <> 'missing_session_ref' or
     (tg_op = 'UPDATE' and old.outcome = 'missing_session_ref') then
    return new;
  end if;

  -- Notification failure must not undo the attempt log or release the hold.
  begin
    insert into public.notifications(user_id,type,title,body,data,dedup_key)
    select distinct ur.user_id,'payment_review'::public.notification_type,
      'Checkout needs review',
      'A PayMongo checkout has no saved session. Keep its slot held until the provider confirms the outcome.',
      jsonb_build_object(
        'event_id',r.event_id,'registration_id',r.id,
        'reason','missing_session_ref'
      ),
      'checkout-unbound:'||r.id::text||':'||ur.user_id::text
    from public.registrations r
    cross join public.user_roles ur
    where r.id = new.registration_id and ur.role = 'super_admin'
    on conflict (dedup_key) do nothing;
  exception when others then
    raise warning 'unbound checkout notification failed for %: %', new.registration_id, sqlerrm;
  end;
  return new;
end $$;

create trigger paymongo_unbound_checkout_notify
after insert or update of outcome on public.provider_session_expiry_attempts
for each row execute function public.notify_unbound_paymongo_checkout();

revoke all on function public.notify_unbound_paymongo_checkout()
  from public,anon,authenticated,service_role;
