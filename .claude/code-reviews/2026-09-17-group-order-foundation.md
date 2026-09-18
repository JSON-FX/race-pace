# Review — group order foundation

Reviewed new migration, capacity/access tests, checkout error mapping and legacy payment-session guard.

- Order writes remain service-only; authenticated users receive SELECT under scoped RLS. Trigger functions explicitly revoke public/client execution and grant service execution.
- Order scope is checked against category and event ownership. Registration order identity cannot change.
- Concurrent capacity admission serializes on category; the guard queries actual live registrations, including pending holds, and excludes the current row.
- Existing active-to-paid transitions do not claim another slot. Expired-to-paid transitions require capacity.
- The group API and provider path are not exposed. Transactional multi-row rollback is tested, but a complete group reservation API remains next work.
- Validation findings were zero-capacity fixtures, corrected to explicit capacity; no enforcement was weakened to satisfy those tests.

No unaddressed finding within this internal foundation slice. Overall group-checkout readiness remains blocked by the documented reservation, payment, refund and delivery work.
