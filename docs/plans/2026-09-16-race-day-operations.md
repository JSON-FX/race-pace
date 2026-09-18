# Race-day operations implementation plan

Status: check-in audit and agreed kit workflow complete locally. Hosted rollout pending.

## Scope and existing decisions

Web/admin pilot only. Reuse registration_audit, existing scoped staff roles, check-in station design, and integer-money registration state. Existing refund changes remain untouched. No production deployments or commits.

The check-in audit has no open product decisions: retain current check-in/undo permissions, append immutable history only for actual changes, and preserve replay-safe behavior. Race-kit policy is a separate dependency: asked whether whole-kit runner collection, pending-refund block, and admin-only reversal with a reason are acceptable. User confirmed the recommended defaults: one complete kit, runner-only collection, pending-refund block, admin reversal with a reason.

## Task 1: atomic check-in audit

Create a follow-up migration defining service-only checkin_record_tx(registration,event,actor). Lock registration before checking paid state and event. Recheck staff scope from user_roles. Insert once and append checked_in audit in the same transaction. Replace checkin_undo with the same registration-first lock, DELETE RETURNING, and checkin_undone audit only on a real deletion. Preserve original actor IDs in history. Add a scoped, read-only checkin_history RPC exposing only operational audit fields.

Update the existing check-in Edge Function to call the transaction after verifying the ticket, retaining error/duplicate contracts. Add history to the station using caller-scoped RPC, limited recent rows and explicit error state. Existing registration history should use friendly labels for new actions.

Validation: local SQL apply in a transaction; focused backend tests for check-in, duplicate, undo twice, audit actor, row scope, client mutation denial; function grants audit; admin tests/typecheck and Computer check-in/undo/history.

## Task 2: race kits — implemented

Create kit_releases with a unique active registration_id and immutable release snapshot. Dedicated release authorization includes admin/editor/claiming with event_scope; claiming gains no broad registration/payment access. Atomic RPCs and an Edge Function validate paid state, selected event and reviewed kit snapshot, prevent duplicates, record release/reversal audits, and serialize with refunds and shirt changes. Expose only runner name, bib name, category, shirt/addons and release state to staff. Runner sees own collection status and cannot change shirt after release.

Restore claiming role in both role constant copies. Add release_kits capability, role resolution, login home and navigation. Create /race-kits with event selection, searchable paginated roster, review/confirm workflow, correction workflow and full filtered CSV. Preserve token validation for scans and support manual lookup.

Validation: role/nav/home tests, kit policy/RLS/concurrency/grants tests, runner edit lock, station tests, CSV escaping and pagination tests, site/admin tests and typechecks, Computer release/duplicate/reversal/runner status. Document actual evidence and remaining hardware/invitation limits.

## References

- supabase/migrations/20260808100100_registration_audit.sql
- supabase/migrations/20260807090600_page_support_rpcs.sql
- supabase/migrations/20260808100200_update_registration_fields_tx.sql
- supabase/migrations/20260914213000_registration_identity_snapshots.sql
- apps/web/lib/capabilities.ts, queries/roles.ts, routes.ts, nav-items.ts
- apps/site/components/RaceKitCard.tsx
- https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker
- https://supabase.com/docs/guides/database/postgres/row-level-security

Research: current Supabase changelog checked 2026-09-16. No relevant change to SQL transaction/RLS patterns; explicit grants required on exposed functions and tables.
