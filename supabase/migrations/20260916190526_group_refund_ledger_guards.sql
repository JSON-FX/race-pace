-- Follow-up after local application: lock the refund identity and money snapshot,
-- including service-role writes, while allowing provider evidence/state updates.
create function public.booking_refund_ledger_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare q booking_refund_requests; a booking_payment_allocations; c booking_payment_captures;
begin
 if tg_table_name='booking_refund_requests' then
   if tg_op='UPDATE' then
     if (to_jsonb(new)-array['status','provider_refund_id','provider_resource','completed_at']) is distinct from
        (to_jsonb(old)-array['status','provider_refund_id','provider_resource','completed_at']) then raise exception 'refund_terms_immutable'; end if;
     if old.provider_refund_id is not null and new.provider_refund_id is distinct from old.provider_refund_id then raise exception 'refund_identity_immutable'; end if;
   else
     select * into c from booking_payment_captures where id=new.capture_id;
     if not found or c.state<>'fulfilled' or c.org_id<>new.org_id or c.booking_order_id<>new.booking_order_id
       or c.payment_id<>new.payment_id or (c.capture->'livemode') is distinct from to_jsonb(new.livemode)
       then raise exception 'refund_scope_mismatch'; end if;
   end if;
 else
   if tg_op='UPDATE' then raise exception 'refund_terms_immutable'; end if;
   select * into q from booking_refund_requests where id=new.request_id;
   select * into a from booking_payment_allocations where capture_id=new.capture_id and registration_id=new.registration_id;
   if q.id is null or a.registration_id is null or q.status<>'submitting' or q.org_id<>new.org_id
     or a.org_id<>new.org_id or q.capture_id<>new.capture_id or a.net_to_org_cents is null
     or new.refund_amount::bigint+new.retained_net<>a.net_to_org_cents then raise exception 'refund_scope_mismatch'; end if;
 end if;
 return new;
end $$;
create trigger booking_refund_requests_guard before insert or update on public.booking_refund_requests
for each row execute function public.booking_refund_ledger_guard();
create trigger booking_refund_lines_guard before insert or update on public.booking_refund_lines
for each row execute function public.booking_refund_ledger_guard();
revoke all on function public.booking_refund_ledger_guard() from public,anon,authenticated;
grant execute on function public.booking_refund_ledger_guard() to service_role;
