# Durable race-day check-in history

Check-in and reversal each append a registration_audit entry in the same transaction as the operational change. An unchanged duplicate or repeated undo creates no new entry. Existing check-ins before this migration are not backfilled as newly performed actions.

The audit retains registration, organization, event, staff UUID, staff role and time. A reversal also stores the original check-in ID, original time and original staff UUID. Staff UUIDs are historical identities and follow the audit table's existing no-foreign-key policy, so offboarding does not rewrite history.

The service-only checkin_record_tx function locks the registration, rechecks staff scope, selected event and paid status, inserts once, and writes checked_in. checkin_undo uses the same registration-first lock, derives its actor from the caller's auth.uid(), deletes the operational row and writes checkin_undone only if one existed. This serializes with refund transactions that lock the same registration.

The check-in station shows the latest 50 audit entries using checkin_history. That read function checks the existing event-scoped authorization helper and returns only operational fields. It grants no broader registration, payment or medical-data access to marshals. Earlier entries remain in the database; full history export is a later reporting slice.

No new audit-table mutation grants are added. The admin's registration drawer also renders friendly labels for these two actions. The runner's existing read-own audit policy remains unchanged.

Local rollout order: migration, check-in Edge Function, admin. Hosted rollout has not been performed.
