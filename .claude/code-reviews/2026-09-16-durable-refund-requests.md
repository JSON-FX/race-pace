# Durable refund request review

Reviewed refund request migration, provider adapter/orchestration, signed webhook routing, admin pending feedback, and regression coverage. Existing readiness work remains in the working tree.

Finding fixed: a failed attempt A followed by B can produce two distinct successful provider refunds. Returning already for B hid that discrepancy after A settled. The correction retains review_required on B, preserves the original ledger, blocks further claims, and returns an error from the webhook and admin action. A repeated callback for the winning request remains harmless. Regression uses small partial refunds so both provider debits are possible.

Review covered registration → payment → request lock order, stable bounded provider idempotency, frozen amounts, timeout ownership, early callback persistence, terminal projection ordering, legacy adoption, service-only grants and RLS, and failure propagation. Follow-up review found no additional confirmed defects in the correction.

Operational limits: an external duplicate success requires manual provider/ledger reconciliation; the application detects it but does not invent a balancing entry. Unmatched inbox events need binding or an authenticated status check. No scheduler or production deployment is included. Final execution evidence is in docs/plans/2026-09-16-durable-refund-requests.md.
