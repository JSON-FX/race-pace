-- Organizer price edits apply to unpaid checkouts. A PayMongo session is
-- immutable, so the edge function first expires it and creates a replacement;
-- this RPC performs the local hand-off as one locked transaction.
create table public.payment_checkout_revisions (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations(id) on delete cascade,
  old_provider_ref text not null,
  new_provider_ref text not null unique,
  old_amount integer not null,
  new_amount integer not null,
  old_request jsonb,
  new_request jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.payment_checkout_revisions enable row level security;
revoke all on public.payment_checkout_revisions from public,anon,authenticated;
grant select,insert on public.payment_checkout_revisions to service_role;

create or replace function public.guard_payment_checkout_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.checkout_request is distinct from old.checkout_request
     and current_setting('racepace.allow_checkout_reprice',true) is distinct from 'on' then
    raise exception 'checkout_request_immutable';
  end if;
  return new;
end $$;

create function public.replace_pending_checkout_pricing(
  p_registration_id uuid,
  p_old_session_id text,
  p_new_session_id text,
  p_checkout_url text,
  p_total integer,
  p_payment_amount integer,
  p_platform_fee integer,
  p_checkout_request jsonb
) returns text language plpgsql security invoker set search_path = '' as $$
declare r public.registrations%rowtype; p public.payments%rowtype; expected_total integer;
begin
  if p_old_session_id !~ '^cs_[A-Za-z0-9_-]+$'
     or p_new_session_id !~ '^cs_[A-Za-z0-9_-]+$'
     or p_checkout_url not like 'https://checkout.paymongo.com/%'
     or p_total < 0 or p_payment_amount < p_total or p_platform_fee < 0 then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('single_capture:'||p_registration_id::text,0));
  select * into r from public.registrations where id=p_registration_id for update;
  select * into p from public.payments where registration_id=p_registration_id for update;
  if r.id is null or p.id is null then return 'not_found'; end if;
  if r.status<>'pending' or p.status<>'pending' then return 'already_final'; end if;
  if p.provider<>'paymongo' or p.provider_ref is distinct from p_old_session_id then return 'mismatch'; end if;
  if exists(select 1 from public.single_payment_captures where registration_id=p_registration_id)
    then return 'capture_pending'; end if;

  select c.base_price + coalesce(sum(a.price),0)::integer into expected_total
  from public.categories c
  left join public.registration_addons ra on ra.registration_id=r.id
  left join public.addons a on a.id=ra.addon_id
  where c.id=r.category_id
  group by c.base_price;
  if expected_total is null or expected_total<>p_total then return 'prices_changed'; end if;

  perform set_config('racepace.allow_checkout_reprice','on',true);
  insert into public.payment_checkout_revisions(
    registration_id,old_provider_ref,new_provider_ref,old_amount,new_amount,old_request,new_request
  ) values (r.id,p.provider_ref,p_new_session_id,p.amount,p_payment_amount,p.checkout_request,p_checkout_request);
  update public.registration_addons ra set price=a.price
    from public.addons a where ra.registration_id=r.id and a.id=ra.addon_id;
  update public.registrations set total_amount=p_total where id=r.id;
  update public.payments set provider_ref=p_new_session_id,checkout_url=p_checkout_url,
    amount=p_payment_amount,checkout_platform_fee=p_platform_fee,
    checkout_request=p_checkout_request where id=p.id;
  return 'replaced';
end $$;

revoke all on function public.replace_pending_checkout_pricing(uuid,text,text,text,integer,integer,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.replace_pending_checkout_pricing(uuid,text,text,text,integer,integer,integer,jsonb)
  to service_role;
