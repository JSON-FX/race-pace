-- Event-based payout statements. Design 2026-08-06 §8, §9.1.
--
-- Race Pace is the merchant of record: every payment lands in the platform's
-- PayMongo account and the organizer is settled afterwards. The settlement unit
-- is an EVENT, not a calendar period — a month boundary would split one race
-- weekend's money across two statements.

create table if not exists payout_statements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  event_id         uuid not null references events(id) on delete cascade,
  gross_cents      bigint not null,
  commission_cents bigint not null,
  refunds_cents    bigint not null,
  net_owed_cents   bigint not null,
  status           text not null default 'open' check (status in ('open','paid')),
  reference        text,
  note             text,
  opened_by        uuid not null references auth.users(id),
  opened_at        timestamptz not null default now(),
  paid_at          timestamptz,
  paid_by          uuid references auth.users(id)
);

-- At most one OPEN statement per event. Paid ones accumulate as history, which is
-- what lets a later top-up statement collect money that arrived after an earlier
-- settlement — and what makes opening a statement mid-registration safe.
create unique index if not exists payout_statements_one_open_per_event
  on payout_statements (event_id) where status = 'open';

create index if not exists payout_statements_org_idx on payout_statements (org_id);

-- Two stamps, not one.
--
-- payout_statement_id says "these earnings have been transferred". It is what
-- makes double-payment structurally impossible regardless of WHEN a statement is
-- opened: the next statement only sees rows that are still unstamped.
--
-- payout_clawback_id says "this refund has been recovered". Without it, every
-- later statement would re-subtract the same refund forever.
alter table payments
  add column if not exists payout_statement_id uuid references payout_statements(id),
  add column if not exists payout_clawback_id  uuid references payout_statements(id);

create index if not exists payments_payout_statement_idx on payments (payout_statement_id);
create index if not exists payments_payout_clawback_idx  on payments (payout_clawback_id);

alter table payout_statements enable row level security;

drop policy if exists payout_statements_super_admin on payout_statements;
create policy payout_statements_super_admin on payout_statements
  for all using (auth_is_super_admin()) with check (auth_is_super_admin());

-- SELECT only for authenticated, and RLS narrows that to super admins. Every
-- write goes through the two security-definer RPCs below, which run as owner —
-- so there is deliberately no INSERT/UPDATE/DELETE grant here. That is tighter
-- than the older tables in this schema, which carry Supabase's default blanket
-- grants and rely on RLS alone.
grant select on payout_statements to authenticated;

-- service_role gets the full set. Tables created inside a migration do NOT
-- inherit the default privileges that dashboard-created tables get, so without
-- this every service-role read fails with "permission denied for table
-- payout_statements" — including the test suite and any future admin tooling.
grant all on payout_statements to service_role;

-- Open a statement for one event.
--
-- Amounts key on the STAMP, not on payment status alone. Keying on status was the
-- original (wrong) design: an entry refunded BEFORE its payout is no longer
-- 'paid', so it contributed 0 to gross while still subtracting its full
-- net_to_org — inventing a debt for money the organizer was never given.
--
--   earn     = unsettled money we now owe        (paid/partial, no statement stamp)
--   clawback = already-transferred money, since  (refunded, HAS a statement stamp,
--              refunded, not yet recovered        no clawback stamp)
--
-- A refund therefore lands in exactly one of those, or in neither. Never both.
create or replace function public.payout_open_statement(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_gross   bigint;
  v_comm    bigint;
  v_refunds bigint;
  v_id      uuid;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select e.org_id into v_org from public.events e where e.id = p_event_id;
  if v_org is null then raise exception 'event_not_found'; end if;

  select
    coalesce(sum(p.amount)       filter (where p.status in ('paid','partially_refunded')
                                           and p.payout_statement_id is null), 0),
    coalesce(sum(p.platform_fee) filter (where p.status in ('paid','partially_refunded')
                                           and p.payout_statement_id is null), 0),
    coalesce(sum(p.net_to_org)   filter (where p.status = 'refunded'
                                           and p.payout_statement_id is not null
                                           and p.payout_clawback_id is null), 0)
  into v_gross, v_comm, v_refunds
  from public.payments p
  join public.registrations r on r.id = p.registration_id
  where r.event_id = p_event_id;

  insert into public.payout_statements
    (org_id, event_id, gross_cents, commission_cents, refunds_cents, net_owed_cents, opened_by)
  values
    (v_org, p_event_id, v_gross, v_comm, v_refunds, v_gross - v_comm - v_refunds, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Mark paid AND stamp every row the statement covered, in one transaction.
--
-- Two round trips would let a crash between them produce a statement marked paid
-- whose payments are still unstamped — and the next statement would then pay the
-- same money again. Same reasoning as confirm_payment_tx.
create or replace function public.payout_mark_paid(
  p_statement_id uuid, p_reference text, p_note text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event  uuid;
  v_status text;
begin
  if not public.auth_is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select s.event_id, s.status into v_event, v_status
    from public.payout_statements s where s.id = p_statement_id for update;
  if v_event is null then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;

  update public.payments p
     set payout_statement_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status in ('paid','partially_refunded')
     and p.payout_statement_id is null;

  update public.payments p
     set payout_clawback_id = p_statement_id
    from public.registrations r
   where r.id = p.registration_id
     and r.event_id = v_event
     and p.status = 'refunded'
     and p.payout_statement_id is not null
     and p.payout_clawback_id is null;

  update public.payout_statements
     set status = 'paid', paid_at = now(), paid_by = auth.uid(),
         reference = p_reference, note = p_note
   where id = p_statement_id;

  return 'paid';
end;
$$;

revoke all on function public.payout_open_statement(uuid)             from public;
revoke all on function public.payout_mark_paid(uuid, text, text)      from public;
grant execute on function public.payout_open_statement(uuid)          to authenticated;
grant execute on function public.payout_mark_paid(uuid, text, text)   to authenticated;
