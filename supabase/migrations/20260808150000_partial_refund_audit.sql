-- Task 5b: close a gap left by 20260808140000_money_txn_audit.sql. That migration made
-- refund_registration_tx write a registration_audit row on its full-refund success path
-- (before `return 'refunded'`) but missed the function's OTHER success path: partial refund
-- (before `return 'partially_refunded'`). A partial refund moves real money — it changes
-- payments.status, refunded_amount, platform_fee and net_to_org — yet produced no audit row,
-- so the admin timeline would show a full refund but stay silent about a partial one.
--
-- The function body below was pasted verbatim from
--   select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.proname='refund_registration_tx'
-- run against the linked hosted project (whaqarofxdlzxrelbcrq). It matched what
-- 20260808140000_money_txn_audit.sql already carries exactly — no drift since that migration
-- applied. Signature was confirmed against pg_get_function_identity_arguments beforehand, and
-- confirmed to be the only overload of this name in public:
--   refund_registration_tx(p_registration_id uuid, p_refunded_by uuid, p_note text,
--                           p_provider_refund jsonb, p_refunded_amount integer,
--                           p_retained_fee integer, p_retained_net integer)
-- `create or replace function` matches on this argument signature; getting it wrong would
-- create a SECOND function instead of replacing this one, and a newly-created function
-- inherits Supabase's default privileges that grant EXECUTE to PUBLIC — reopening the
-- payment-bypass gap that 20260808110000_lock_down_function_grants.sql closed.
--
-- The only edit to the body: insert one registration_audit row immediately before the
-- partial-refund path's `return 'partially_refunded'`, mirroring the existing insert on the
-- full-refund path. org_id/event_id are sourced from v_org/v_event — the same locals the
-- existing insert uses, populated by the `for update` select at the top of the function.
-- actor_id/actor_role mirror the full-refund insert too: p_refunded_by / 'admin'. detail
-- carries the refunded amount (p_refunded_amount, not v_amount — v_amount is the pre-refund
-- total, not what was actually refunded on this path) and p_note, both already in scope from
-- the update statement immediately above. Nothing else changed: not the signature, not the
-- arithmetic, not the retained-fee handling, not the lock, not the status guards, not
-- `security definer`/`set search_path`.
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

    insert into public.registration_audit
      (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
    values (p_registration_id, v_org, v_event, 'partially_refunded',
            jsonb_build_object('amount', p_refunded_amount, 'note', p_note), p_refunded_by, 'admin');

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

-- Belt-and-braces re-assertion, same as 20260808140000_money_txn_audit.sql used for both
-- functions it touched. `create or replace` preserves existing privileges (verified below in
-- the post-migration ACL check), so this should be a no-op — but this function was one of the
-- two targets of the hosted-project exploit in 20260808110000_lock_down_function_grants.sql,
-- so assert the lockdown explicitly rather than assume the replace left it alone.
revoke execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int)
  from anon, authenticated;
