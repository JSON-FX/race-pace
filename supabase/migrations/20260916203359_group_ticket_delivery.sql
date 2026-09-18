-- Email is an at-least-once side effect. A crashed SMTP sender may be retried;
-- the existing paid registrations/tokens must never be recreated for delivery.
alter table public.booking_order_deliveries
 add column lease_token uuid,
 add column lease_until timestamptz,
 add column attempts integer not null default 0,
 add column next_attempt_at timestamptz not null default now(),
 add column sent_at timestamptz,
 add column last_error text;
create function public.booking_delivery_claim(p_limit integer default 10)
returns setof public.booking_order_deliveries language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit<1 or p_limit>25 then raise exception 'invalid_batch_size'; end if;
 return query
 with eligible as (
 select d.booking_order_id from public.booking_order_deliveries d
 where d.state='pending' and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<=now())
 order by d.created_at,d.booking_order_id for update skip locked limit p_limit
 ) update public.booking_order_deliveries d set lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=d.attempts+1
 from eligible e where d.booking_order_id=e.booking_order_id returning d.*;
end $$;
create function public.booking_delivery_finish(p_order uuid,p_lease uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.booking_order_deliveries set state=case when p_error is null then 'sent' else 'pending' end,
 sent_at=case when p_error is null then now() else null end,
 last_error=case when p_error is null then null else left(p_error,100) end,
 next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7)))::integer),
 lease_token=null,lease_until=null
 where booking_order_id=p_order and state='pending' and lease_token=p_lease and lease_until>now();
 return found;
end $$;
revoke all on function public.booking_delivery_claim(integer),public.booking_delivery_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.booking_delivery_claim(integer),public.booking_delivery_finish(uuid,uuid,text) to service_role;
