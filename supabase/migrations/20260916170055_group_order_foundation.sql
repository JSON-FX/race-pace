-- Internal foundation only. No public order mutation or group checkout endpoint.
create table public.booking_orders (
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id),
 event_id uuid not null references public.events(id),
 category_id uuid not null references public.categories(id),
 booked_by_user_id uuid not null references auth.users(id),
 idempotency_key uuid not null,
 status text not null default 'draft' check(status in ('draft','pending','paid','expired','cancelled','reconciliation_required')),
 currency text not null default 'PHP' check(currency='PHP'),
 expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(booked_by_user_id,idempotency_key)
);
alter table public.booking_orders enable row level security;
revoke all on public.booking_orders from public,anon,authenticated;
grant select on public.booking_orders to authenticated;
grant all on public.booking_orders to service_role;
create policy booking_orders_read_booker on public.booking_orders for select to authenticated
 using(booked_by_user_id=(select auth.uid()));
create policy booking_orders_read_admin on public.booking_orders for select to authenticated
 using(public.auth_can_admin_org(org_id));

create function public.booking_order_scope_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.categories c join public.events e on e.id=c.event_id
   where c.id=new.category_id and c.event_id=new.event_id and c.org_id=new.org_id and e.org_id=new.org_id)
 then raise exception 'order_scope_mismatch' using errcode='23514'; end if;
 if TG_OP='UPDATE' and (new.org_id,new.event_id,new.category_id,new.booked_by_user_id,new.idempotency_key)
   is distinct from (old.org_id,old.event_id,old.category_id,old.booked_by_user_id,old.idempotency_key)
 then raise exception 'order_identity_immutable' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.booking_order_scope_guard() from public,anon,authenticated;
grant execute on function public.booking_order_scope_guard() to service_role;
create trigger booking_order_scope_guard before insert or update on public.booking_orders
 for each row execute function public.booking_order_scope_guard();

alter table public.registrations add column booking_order_id uuid references public.booking_orders(id);
create index registrations_booking_order on public.registrations(booking_order_id) where booking_order_id is not null;
create function public.registration_order_scope_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.booking_order_id is distinct from old.booking_order_id
 then raise exception 'registration_order_immutable' using errcode='23514'; end if;
 if new.booking_order_id is not null and not exists(select 1 from public.booking_orders o
   where o.id=new.booking_order_id and o.org_id=new.org_id and o.event_id=new.event_id
     and o.category_id=new.category_id and o.booked_by_user_id=new.booked_by_user_id)
 then raise exception 'registration_order_scope_mismatch' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.registration_order_scope_guard() from public,anon,authenticated;
grant execute on function public.registration_order_scope_guard() to service_role;
create trigger y_registration_order_scope before insert or update on public.registrations
 for each row execute function public.registration_order_scope_guard();

-- Every admission uses the same category lock, including legacy single checkout.
-- slots_taken counts paid entries only; using it alone permits unpaid overselling.
create function public.registration_capacity_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_limit integer; v_count bigint;
begin
 if new.status not in ('pending','paid') or
   (new.status='pending' and new.expires_at is not null and new.expires_at<=now()) then return new; end if;
 if TG_OP='UPDATE' and old.category_id=new.category_id and
   (old.status='paid' or (old.status='pending' and (old.expires_at is null or old.expires_at>now())))
 then return new; end if;
 select slots_total into v_limit from public.categories where id=new.category_id for update;
 if not found then raise exception 'category_not_found' using errcode='23503'; end if;
 select count(*) into v_count from public.registrations r where r.category_id=new.category_id
   and r.id<>new.id and (r.status='paid' or (r.status='pending' and (r.expires_at is null or r.expires_at>now())));
 if v_count>=v_limit then raise exception 'category_capacity_exhausted' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function public.registration_capacity_guard() from public,anon,authenticated;
grant execute on function public.registration_capacity_guard() to service_role;
create trigger zz_registration_capacity before insert or update on public.registrations
 for each row execute function public.registration_capacity_guard();
