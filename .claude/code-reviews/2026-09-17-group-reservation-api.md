# Review — atomic group reservation API

Scope: this reservation slice only. Earlier uncommitted Passport and admin revisions have their own review artifacts.

Code scope: seven new files (migration, endpoint, mirrored schemas, validation helper, two test files), plus schema exports and the legacy checkout guard. Documentation reviewed separately.

## Fixed finding

Severity: high
File: supabase/functions/registrations-checkout/index.ts
Issue: the legacy upsert path could revive an expired ordered registration using its internal idempotency key, then create an individual provider charge.
Resolution: reject the reserved `group:` namespace before legacy writes/provider calls. Integration coverage checks HTTP 409, unchanged expired status and no payment row. The existing payment-session order guard also remains covered.

## Review findings

No remaining technical issues detected in this bounded slice. Reviewed authorization, service-only execution grants, tenant scope, saved Passport validation and race protection, organizer waiver evidence, server pricing, duplicate entry enforcement, legacy/group shared capacity locking, all-or-nothing transaction behavior, immutable request terms and replay/expiry semantics.

The RPC intentionally uses SECURITY DEFINER for auth.users verification; service_role cannot read that table directly. EXECUTE is revoked from PUBLIC, anon and authenticated. The edge derives the actor from getUser and permits no client actor or amount fields. Full function-grant audit passes.

The form-fields SHARE table lock is deliberate: row locks cannot prevent a newly inserted required question. The bounded transaction contains no provider calls. Concurrent reservations can share that lock. Configuration edits may briefly wait; revisit with an event configuration revision counter if measured contention warrants it.

## Release boundary

Not a review approval for full group checkout or deployment. The endpoint defaults to disabled, and the running local endpoint returns group_checkout_not_available. No group payment attempts, financial allocations, refund coordinator, grouped QR delivery or public UI is enabled. Subsequent work must coordinate order/line expiry and cancellation, and replace the legacy payment guard only after order-aware money handling exists.
