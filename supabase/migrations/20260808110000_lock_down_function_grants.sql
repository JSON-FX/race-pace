-- CRITICAL SECURITY FIX. Proven exploitable against the hosted project with the public anon
-- key: an anonymous caller invoked `confirm_payment_tx` directly and turned a pending
-- registration into a paid one with a minted ticket_token, without paying.
--
-- Root cause: every migration in this repo that meant to lock a function down ends with
--   revoke all on function public.f(...) from public;
--   grant execute on function public.f(...) to service_role;
-- `revoke ... from public` only revokes the PUBLIC pseudo-role grant. Supabase's default
-- privileges separately GRANT EXECUTE to `anon` and `authenticated` on every function created
-- in `public`, and that grant is per-role — it is untouched by revoking PUBLIC. For tables this
-- is survivable because RLS is a second gate; functions have no RLS, so for a SECURITY DEFINER
-- function the grant is the only gate. The result: the ACL on every function below read
-- `anon=X/postgres, authenticated=X/postgres` regardless of the `revoke ... from public` line
-- its own migration already carried.
--
-- This migration was written against `pg_proc.proacl` for each function, not against the
-- migration source that created it — the source can drift from the live signature (see
-- `refund_registration_tx` below, whose original 4-arg form was `drop function`-ed and replaced
-- by a 7-arg overload in 20260807090400_refund_policy_tx.sql), and a signature mismatch makes
-- `revoke` a silent no-op that leaves the hole open. `pg_get_function_identity_arguments()`
-- against the linked hosted project is the ground truth used throughout.
--
-- A second, related finding from that same live-ACL check: six of the eighteen functions in
-- scope still carry an *un-revoked* PUBLIC grant (`=X/postgres` in proacl) — their own creating
-- migration never had a `revoke ... from public` line at all, so they never even got the
-- (insufficient) treatment described above. A PUBLIC grant is not shadowed by revoking a named
-- role: `has_function_privilege('anon', ...)` stays true for a role with EXECUTE revoked
-- directly as long as PUBLIC still holds it (verified empirically against this project before
-- writing this migration). Revoking anon/authenticated alone would therefore be cosmetic for
-- those six — this migration revokes PUBLIC too, everywhere it is still present, so the
-- anon/authenticated revokes below are not silently defeated by a PUBLIC grant sitting
-- underneath them.
--
-- Two of those six (admin_org_signups_daily, admin_payment_aggregates) are real,
-- directly-callable RPCs — the PUBLIC grant there was a live latent gap, defended in practice
-- only by RLS/table-grants on what they query (per the brief's empirical check: anon already
-- gets zero/empty rows from them today). The other four (fn_notify_on_checkin,
-- fn_notify_on_event_change, fn_notify_on_registration, rls_auto_enable) return `trigger` /
-- `event_trigger` — Postgres refuses to invoke those directly at all ("trigger functions can
-- only be called as triggers"), so their residual PUBLIC grant was inert, not exploitable; it is
-- cleaned up here anyway for the same reason 20260806203000 gave for hardening two of their
-- siblings defensively: leaving one of a matched set closed and the rest open is exactly how
-- this class of bug keeps regressing in this codebase.
--
-- Explicitly NOT touched: auth_can_admin_org, auth_can_check_in_event, auth_is_super_admin.
-- These are called from inside RLS policies, which evaluate as the querying role. Revoking
-- `authenticated` (or `anon`, for anon-readable tables whose policies reference them) EXECUTE
-- would break row-level security evaluation across the schema — turning this privilege fix into
-- an outage. Do not revoke EXECUTE on these three, ever, for any role.

-- ============================================================================================
-- Group A — genuinely exposed, service_role-only. No internal authorization check exists in
-- the function body; the grant was the only gate. Called only from edge functions running as
-- service_role (_shared/confirm.ts, _shared/refund.ts, payments-webhook/index.ts). No app code
-- calls these as anon or authenticated, and none should ever be able to.
-- ============================================================================================

revoke all on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb) from public;
revoke execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb)
  from anon, authenticated;
grant execute on function public.confirm_payment_tx(uuid, text, int, int, text, jsonb)
  to service_role;

-- Live signature is 7-arg (p_refunded_amount/p_retained_fee/p_retained_net added by
-- 20260807090400_refund_policy_tx.sql, which dropped the original 4-arg overload). The 4-arg
-- form no longer exists; a revoke naming it would error "function does not exist", not silently
-- no-op — but using the wrong signature here was exactly the failure mode to design out.
revoke all on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int)
  from public;
revoke execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int)
  from anon, authenticated;
grant execute on function public.refund_registration_tx(uuid, uuid, text, jsonb, int, int, int)
  to service_role;

-- ============================================================================================
-- Group B — client-called, and each already refuses unauthorized callers internally (verified
-- individually in the security audit this migration implements — see task-sec-brief.md). These
-- need `authenticated` EXECUTE, since the real apps call them; `anon` has no business reaching
-- any of them. Revoking `anon` here is defence in depth for most of these — the exception is
-- admin_org_signups_daily and admin_payment_aggregates, where PUBLIC still held EXECUTE (see
-- header) and closing that is a real gap close, not just belt-and-suspenders.
-- ============================================================================================

revoke all on function public.admin_cancel_registration(uuid) from public;
revoke execute on function public.admin_cancel_registration(uuid) from anon;
grant execute on function public.admin_cancel_registration(uuid) to authenticated;

revoke all on function public.admin_registration_emails(uuid) from public;
revoke execute on function public.admin_registration_emails(uuid) from anon;
grant execute on function public.admin_registration_emails(uuid) to authenticated;

-- Still had a live PUBLIC grant (its creating migration, 20260807090600_page_support_rpcs.sql,
-- never revoked it) — see header.
revoke all on function public.admin_org_signups_daily(uuid, int) from public;
revoke execute on function public.admin_org_signups_daily(uuid, int) from anon;
grant execute on function public.admin_org_signups_daily(uuid, int) to authenticated;

-- Still had a live PUBLIC grant (its creating migration, 20260807100000_payment_aggregates_by_
-- event.sql, granted authenticated/service_role explicitly but never revoked PUBLIC) — see
-- header.
revoke all on function public.admin_payment_aggregates(uuid, text, text, text, text) from public;
revoke execute on function public.admin_payment_aggregates(uuid, text, text, text, text)
  from anon;
grant execute on function public.admin_payment_aggregates(uuid, text, text, text, text)
  to authenticated;

revoke all on function public.admin_registration_aggregates(uuid, text, text, text) from public;
revoke execute on function public.admin_registration_aggregates(uuid, text, text, text)
  from anon;
grant execute on function public.admin_registration_aggregates(uuid, text, text, text)
  to authenticated;

revoke all on function public.checkin_events() from public;
revoke execute on function public.checkin_events() from anon;
grant execute on function public.checkin_events() to authenticated;

revoke all on function public.checkin_roster(uuid) from public;
revoke execute on function public.checkin_roster(uuid) from anon;
grant execute on function public.checkin_roster(uuid) to authenticated;

revoke all on function public.checkin_undo(uuid) from public;
revoke execute on function public.checkin_undo(uuid) from anon;
grant execute on function public.checkin_undo(uuid) to authenticated;

revoke all on function public.payout_mark_paid(uuid, text, text) from public;
revoke execute on function public.payout_mark_paid(uuid, text, text) from anon;
grant execute on function public.payout_mark_paid(uuid, text, text) to authenticated;

revoke all on function public.payout_open_statement(uuid) from public;
revoke execute on function public.payout_open_statement(uuid) from anon;
grant execute on function public.payout_open_statement(uuid) to authenticated;

revoke all on function public.update_registration_fields_tx(uuid, jsonb) from public;
revoke execute on function public.update_registration_fields_tx(uuid, jsonb) from anon;
grant execute on function public.update_registration_fields_tx(uuid, jsonb) to authenticated;

-- ============================================================================================
-- Group C — trigger, cron, and event-trigger functions no client should ever call directly.
-- Revoking anon/authenticated EXECUTE does not affect these firing: trigger and event-trigger
-- functions execute as part of the trigger mechanism, not as a client call, and Postgres refuses
-- to invoke a `returns trigger` / `returns event_trigger` function directly at all regardless of
-- grants. `fn_enqueue_event_reminders` is the one plain (`returns void`) function in this group
-- and IS directly callable — its creating migration (20260806203000) already revoked PUBLIC for
-- exactly that reason; this adds the anon/authenticated revoke it did not.
-- ============================================================================================

revoke execute on function public.fn_notify_on_checkin() from anon, authenticated;
revoke all on function public.fn_notify_on_checkin() from public;

revoke execute on function public.fn_notify_on_event_change() from anon, authenticated;
revoke all on function public.fn_notify_on_event_change() from public;

revoke execute on function public.fn_notify_on_registration() from anon, authenticated;
revoke all on function public.fn_notify_on_registration() from public;

revoke execute on function public.fn_enqueue_event_reminders() from anon, authenticated;

revoke execute on function public.rls_auto_enable() from anon, authenticated;
revoke all on function public.rls_auto_enable() from public;

-- ============================================================================================
-- Stop new functions inheriting the problem. This only governs objects created AFTERWARDS by
-- the same role that runs this migration, which is why every explicit revoke above is still
-- required for the functions that already exist.
-- ============================================================================================

alter default privileges in schema public revoke execute on functions from anon, authenticated;
