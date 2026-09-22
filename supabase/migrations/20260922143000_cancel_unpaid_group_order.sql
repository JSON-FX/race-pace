-- A group booking can return to the roster only before provider dispatch. Once
-- PayMongo may hold a payable session, cancellation would turn a late capture
-- into reconciliation instead of a ticket. Keep that boundary atomic here.
create function public.booking_order_cancel(p_actor uuid, p_order uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_order public.booking_orders%rowtype;
begin
  if p_actor is null or p_order is null then
    raise exception 'invalid_input' using errcode='22023';
  end if;

  perform 1 from auth.users
    where id=p_actor and email_confirmed_at is not null and not coalesce(is_anonymous,false)
    for share;
  if not found then raise exception 'booking_email_unverified' using errcode='42501'; end if;

  select * into v_order from public.booking_orders
    where id=p_order and booked_by_user_id=p_actor for update;
  if not found then raise exception 'order_not_found' using errcode='42501'; end if;
  if v_order.status='cancelled' then
    return jsonb_build_object('order_id',v_order.id,'status','cancelled');
  end if;
  if v_order.status<>'pending' then
    raise exception 'order_not_cancellable' using errcode='22023';
  end if;

  perform 1 from public.booking_payment_attempts
    where booking_order_id=p_order order by id for update;
  if exists(
    select 1 from public.booking_payment_attempts a
    left join public.booking_payment_dispatches d on d.attempt_id=a.id
    left join public.booking_payment_captures c on c.attempt_id=a.id
    where a.booking_order_id=p_order
      and (a.status not in ('prepared','failed','expired') or d.attempt_id is not null or c.id is not null)
  ) then
    raise exception 'payment_already_started' using errcode='22023';
  end if;

  perform 1 from public.registrations
    where booking_order_id=p_order order by id for update;
  if exists(select 1 from public.registrations
    where booking_order_id=p_order and status not in ('pending','expired'))
  then raise exception 'order_entries_changed' using errcode='22023'; end if;

  update public.booking_payment_attempts set status='expired'
    where booking_order_id=p_order and status='prepared';
  update public.registrations set status='cancelled',expires_at=null
    where booking_order_id=p_order and status in ('pending','expired');
  update public.booking_orders set status='cancelled',expires_at=null where id=p_order;

  return jsonb_build_object('order_id',p_order,'status','cancelled');
end $$;

revoke all on function public.booking_order_cancel(uuid,uuid) from public,anon,authenticated;
grant execute on function public.booking_order_cancel(uuid,uuid) to service_role;
