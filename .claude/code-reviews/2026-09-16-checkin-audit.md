# Check-in audit review

Reviewed scope: new race-day audit migration, check-in Edge transaction integration, scoped history component and tests, registration drawer labels, backend audit tests and grants allowlist. Earlier unrelated working-tree changes were preserved.

The registration lock is acquired before eligibility and insert/delete, matching the refund transaction lock order. Insert conflict and absent-delete paths produce no extra audit. Actor identity comes from the verified Edge user for the service-only RPC and auth.uid() for undo. Scoped history uses auth_can_check_in_event; no new client mutation grants exist. SQL functions have empty search paths and explicit revoke/grant statements.

Code review passed for this slice. New history displays persistent staff UUIDs and roles without exposing unrelated registration fields. Full admin: 760 tests in 94 files. Focused live backend plus complete function-grant audit: 11 tests. Admin typecheck and diff check passed. Computer confirmed check-in then undo leaves two visible history entries while restoring the runner to not checked in.

Limits: historical actions before this migration cannot be reconstructed. History UI shows latest 50; complete audit export remains future reporting work. Full money/backend suite was not rerun because no payment code changed. Kit release awaits the separate pilot policy answer.
