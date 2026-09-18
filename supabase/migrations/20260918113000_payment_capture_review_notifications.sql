-- This migration has only run through local db reset; it has not reached hosted.
-- A payout hold prevents transfer, but a captured charge needing review must
-- also reach a platform operator before they happen to open its settlement.
alter type public.notification_type add value if not exists 'payment_review';

create function public.notify_single_capture_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state <> 'reconciliation_required' or
     (tg_op = 'UPDATE' and old.state = 'reconciliation_required') then
    return new;
  end if;

  -- Alerting must never roll back the capture inbox. The unresolved row and
  -- payout hold remain durable even if notification delivery is unavailable.
  begin
    insert into public.notifications(user_id,type,title,body,data,dedup_key)
    select distinct ur.user_id,'payment_review'::public.notification_type,
      'Payment needs review',
      'A PayMongo capture requires reconciliation before this event can be paid out.',
      jsonb_build_object(
        'event_id',new.event_id,'registration_id',new.registration_id,
        'provider_payment_id',new.provider_payment_id,'reason',new.reason
      ),
      'payment-review:'||new.provider_payment_id||':'||ur.user_id::text
    from public.user_roles ur
    where ur.role = 'super_admin'
    on conflict (dedup_key) do nothing;
  exception when others then
    raise warning 'payment capture review notification failed for %: %', new.provider_payment_id, sqlerrm;
  end;
  return new;
end $$;

create trigger single_capture_review_notify
after insert or update of state on public.single_payment_captures
for each row execute function public.notify_single_capture_review();

revoke all on function public.notify_single_capture_review() from public,anon,authenticated,service_role;
