# Payment safety review

**Scope:** PayMongo refund resolution, group checkout URL validation, capture-review notifications, pending-registration DELETE policy, and focused tests.

**Review result:** No outstanding technical issue found in the scoped local diff.

The settled capture lookup is restricted to the claimed registration and must match the frozen checkout session before use. The legacy checkout lookup accepts only a paid `pay_` payment. The new DELETE helper bypasses the recursive payment read policy but grants execution only to authenticated and service roles. Its policy still checks the caller's own user ID and excludes ordered or provider-backed pending rows. Capture notification errors cannot roll back financial evidence.

Hosted PayMongo capture replay, provider-confirmed nonempty expiry, and push delivery remain unverified integration cases. Do not treat this local review as production approval.
