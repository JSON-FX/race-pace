# PayMongo checkout retry did not replay the original session

## Finding

On 2026-09-18, two identical sandbox `POST /v1/checkout_sessions` requests with the same `Idempotency-Key` returned HTTP 200 with **different** `cs_` IDs. The same probe against `/v2/checkout_sessions` also returned different IDs. The request body and key were reused byte-for-byte within each pair. All four unpaid sessions were expired and a subsequent GET confirmed `status=expired` and zero payments. This is test-account evidence, not a claim about every PayMongo account or live mode.

PayMongo's [general idempotent-requests reference](https://docs.paymongo.com/reference/idempotent-requests) says a matching retry should return the first result for 24 hours. The observed checkout behavior contradicts that guarantee for this test account. Do not rely on the general documentation to justify an automatic checkout-create retry until PayMongo confirms the endpoint behavior and an account-specific test passes.

## Root cause and impact

`registrations-checkout` freezes its checkout request before the external POST. If that POST succeeds but its database update or response is lost, `payment-session` sees a pending payment without `provider_ref`. It previously retried creation with the frozen body and the same idempotency key. Because the observed checkout endpoint minted another session, this could leave an untracked active session alongside the one bound to the registration. The expiry worker cannot close an unbound session because it has no provider ID. It correctly keeps the slot reserved, but this also leaves a booking unresolved.

Severity: **high** for release readiness. The observed bug does not prove that an orphaned session was charged. It removes the safety assumption behind recovery and can create a second chargeable checkout object.

## Safe behavior and remaining work

- If a PayMongo payment has a bound `provider_ref`, reuse its saved checkout URL.
- If the create outcome is uncertain and no provider session is bound, fail closed. Do not issue another checkout-create POST automatically.
- Keep the reservation pending and show an operator-reconciliation error. Do not release the slot until the provider confirms no capture and all possible sessions are closed.
- Notify platform staff when the expiry worker finds an unbound session. The trigger is deployed to staging and passed a rollback-only test there: two attempts produced one notification while registration and payment stayed pending. Actual worker-to-notification delivery and a documented manual resolution path remain necessary before launch. Ask PayMongo to reconcile the observed test-account idempotency behavior with its documented contract.

Focused local tests cover both the unbound refusal and bound-session reuse. The scheduled staging worker closed a known expired provider session without minting a ticket. Authenticated staging refusal and a controlled late or duplicate paid capture remain unverified.
