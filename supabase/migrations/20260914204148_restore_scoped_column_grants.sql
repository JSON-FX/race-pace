
-- PostgreSQL REVOKE on a table also clears matching column grants. Restore the
-- explicit column contract after removing broad table access.
grant update (read_at) on table public.notifications to authenticated;
grant update (banner_url, commission_flat_cents, commission_rate, commission_type, fee_mode, logo_url, name, refund_fee_cents, refund_policy) on table public.organizations to authenticated;
