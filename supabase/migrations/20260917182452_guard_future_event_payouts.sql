-- The admin hides "Mark paid" for a live event, but the exposed RPC could still
-- stamp its payments. Enforce the same gate in Postgres. A negative statement is
-- a recovery from the organizer and remains actionable even during a live event.
create or replace function public.payout_mark_paid(
  p_statement_id uuid, p_reference text, p_note text, p_expected_revision integer
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  result text;
  ev uuid;
  v_net bigint;
  v_event_status text;
  v_last_day date;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(76120260917);
  if exists(select 1 from public.payout_statements where id = p_statement_id and status = 'paid') then
    return 'already';
  end if;

  select s.event_id, s.net_owed_cents, e.status::text, coalesce(e.end_date, e.event_date)
    into ev, v_net, v_event_status, v_last_day
    from public.payout_statements s
    join public.events e on e.id = s.event_id
   where s.id = p_statement_id
   for share of e;
  if ev is null then return 'not_found'; end if;

  -- A recovery can be recorded while the event runs. An outward payment must
  -- wait until completion or the day after the event's last Philippine date.
  if v_net >= 0 and not (
    v_event_status = 'completed'
    or coalesce(v_last_day < (now() at time zone 'Asia/Manila')::date, false)
  ) then
    return 'event_unfinished';
  end if;

  if public.group_payout_blockers(ev) > 0 then return 'unreconciled'; end if;
  result := public.payout_mark_paid_before_groups(
    p_statement_id, p_reference, p_note, p_expected_revision
  );
  if result <> 'paid' then return result; end if;

  update public.booking_payment_allocations a
     set payout_statement_id = p_statement_id,
         payout_clawback_id = case when exists (
           select 1 from public.booking_refund_lines l
           join public.booking_refund_requests q on q.id = l.request_id and q.status = 'succeeded'
           where l.capture_id = a.capture_id and l.registration_id = a.registration_id
         ) then p_statement_id else a.payout_clawback_id end
    from public.registrations r
   where r.id = a.registration_id and r.event_id = ev and a.payout_statement_id is null;

  update public.booking_payment_allocations a
     set payout_clawback_id = p_statement_id
    from public.registrations r
   where r.id = a.registration_id and r.event_id = ev
     and a.payout_statement_id is not null and a.payout_clawback_id is null
     and exists (
       select 1 from public.booking_refund_lines l
       join public.booking_refund_requests q on q.id = l.request_id and q.status = 'succeeded'
       where l.capture_id = a.capture_id and l.registration_id = a.registration_id
     );
  return result;
end $$;

revoke all on function public.payout_mark_paid(uuid,text,text,integer) from public, anon;
grant execute on function public.payout_mark_paid(uuid,text,text,integer) to authenticated, service_role;
