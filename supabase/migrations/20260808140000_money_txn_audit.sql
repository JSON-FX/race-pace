-- Task 5: write registration_audit rows from the money RPCs. Task-5-brief.md.
--
-- Filename note: the brief specified 20260808120000_money_txn_audit.sql, but that stamp is
-- already used by 20260808120000_fix_function_grants_default_privileges.sql (applied earlier
-- the same day, in the security-lockdown series). This migration is stamped 20260808140000 —
-- after the latest existing 2026-08-08 migration (20260808130000) — to avoid a filename
-- collision and preserve migration ordering.
--
-- Both function bodies below were pasted verbatim from
--   select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.proname in ('confirm_payment_tx','refund_registration_tx');
-- run against the linked hosted project (whaqarofxdlzxrelbcrq), NOT from any migration file or
-- from this plan — see the trap warning at the top of task-5-brief.md. Signatures were confirmed
-- against pg_get_function_identity_arguments beforehand:
--   confirm_payment_tx(p_registration_id uuid, p_method text, p_fee integer, p_net integer,
--                       p_token text, p_raw jsonb)
--   refund_registration_tx(p_registration_id uuid, p_refunded_by uuid, p_note text,
--                           p_provider_refund jsonb, p_refunded_amount integer,
--                           p_retained_fee integer, p_retained_net integer)
-- Both matched what the live pg_get_functiondef body carried exactly, so no reconciliation
-- against the source migrations was needed.
--
-- The only edits to each body: extend the existing `select ... into` (no second query added)
-- to also fetch org_id/event_id/total_amount (confirm) or org_id/event_id (refund, which
-- already selects payments.amount into v_amount for its own logic), and insert one
-- registration_audit row immediately before the function's success-path `return`. Nothing else
-- changed: not the signature, not the argument names, not the existing logic, not
-- `security definer`, not `set search_path`, not the `for update` row lock.
--
-- `jsonb_build_object` is called unqualified deliberately — it lives in pg_catalog, which is
-- always on the search path, and `public.jsonb_build_object` does not exist. plpgsql resolves
-- function names at execution time, so a wrongly-qualified call would only fail the first time
-- the success path actually runs, not at migration-apply time.
create or replace function public.confirm_payment_tx(p_registration_id uuid, p_method text, p_fee integer, p_net integer, p_token text, p_raw jsonb)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_status public.registration_status;
  v_category uuid;
  v_org uuid;
  v_event uuid;
  v_amount int;
begin
  select status, category_id, org_id, event_id, total_amount
    into v_status, v_category, v_org, v_event, v_amount
    from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'paid' then return 'already'; end if;
  if v_status <> 'pending' then return 'not_pending'; end if;  -- refunded/cancelled: never re-confirm (replay-safe)

  update public.payments
     set status = 'paid', method = p_method, platform_fee = p_fee,
         net_to_org = p_net, raw = p_raw
   where registration_id = p_registration_id;

  update public.registrations
     set status = 'paid', ticket_token = p_token
   where id = p_registration_id;

  update public.categories set slots_taken = slots_taken + 1 where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_role)
  values (p_registration_id, v_org, v_event, 'paid',
          jsonb_build_object('method', p_method, 'amount', v_amount), 'system');

  return 'paid';
end;
$function$
;

create or replace function public.refund_registration_tx(p_registration_id uuid, p_refunded_by uuid, p_note text, p_provider_refund jsonb, p_refunded_amount integer DEFAULT NULL::integer, p_retained_fee integer DEFAULT 0, p_retained_net integer DEFAULT 0)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_status   public.registration_status;
  v_category uuid;
  v_org      uuid;
  v_event    uuid;
  v_raw      jsonb;
  v_amount   int;
  v_partial  boolean;
begin
  select r.status, r.category_id, r.org_id, r.event_id
    into v_status, v_category, v_org, v_event
    from public.registrations r where r.id = p_registration_id for update;
  if not found then return 'not_found'; end if;
  if v_status = 'refunded' then return 'already'; end if;
  if v_status <> 'paid' then return 'not_paid'; end if;

  select p.amount, p.raw into v_amount, v_raw
    from public.payments p where p.registration_id = p_registration_id;

  -- p_refunded_amount null means "refund everything", which keeps the four-arg
  -- behaviour for any caller that has not been taught about policy yet.
  v_partial := p_refunded_amount is not null and p_refunded_amount < v_amount;

  if v_partial then
    -- The entry SURVIVES a partial refund — the runner keeps their place, so the
    -- registration stays 'paid' and the slot stays taken. Only the payment row
    -- changes, and it changes to describe the smaller sale that remains.
    update public.payments
       set status          = 'partially_refunded',
           refunded_amount = p_refunded_amount,
           amount          = v_amount - p_refunded_amount,
           platform_fee    = p_retained_fee,
           net_to_org      = p_retained_net,
           raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                   'refunded_at', now(),
                   'refunded_by', p_refunded_by,
                   'note', p_note,
                   'partial', true,
                   -- `amount` is now the retained figure, so the original is
                   -- recoverable only from here.
                   'original_amount', v_amount,
                   'provider_refund', p_provider_refund)
     where registration_id = p_registration_id;
    return 'partially_refunded';
  end if;

  update public.registrations set status = 'refunded' where id = p_registration_id;

  -- A fully refunded row KEEPS its original amount/platform_fee/net_to_org. That
  -- is deliberate and load-bearing: payout_open_statement reads net_to_org off
  -- refunded rows to size a clawback. See 20260807090300_payout_statements.sql.
  update public.payments
     set status = 'refunded',
         refunded_amount = v_amount,
         raw = coalesce(v_raw, '{}'::jsonb) || jsonb_build_object(
                 'refunded_at', now(),
                 'refunded_by', p_refunded_by,
                 'note', p_note,
                 'provider_refund', p_provider_refund)
   where registration_id = p_registration_id;

  update public.categories set slots_taken = greatest(slots_taken - 1, 0) where id = v_category;

  insert into public.registration_audit
    (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
  values (p_registration_id, v_org, v_event, 'refunded',
          jsonb_build_object('amount', v_amount, 'note', p_note), p_refunded_by, 'admin');

  return 'refunded';
end;
$function$
;

-- Belt-and-braces re-assertion. `create or replace` preserves existing privileges (verified
-- below in the post-migration ACL check), so this should be a no-op — but given that these are
-- the two functions the hosted-project exploit in 20260808110000_lock_down_function_grants.sql
-- targeted, assert the lockdown explicitly rather than assume the replace left it alone.
revoke execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb)
  from anon, authenticated;
revoke execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int)
  from anon, authenticated;
