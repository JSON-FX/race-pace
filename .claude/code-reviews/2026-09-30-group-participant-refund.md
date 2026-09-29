# Group participant refund routing review

Reviewed the complete change against the existing group refund endpoint, strict request schema, claim transaction, provider reconciliation service, and participant slot/ticket release transaction.

- The authenticated server action retains the caller session and invokes the guarded endpoint. No service-role shortcut or feature-flag bypass is introduced.
- Every group request explicitly selects one registration and retains its registration UUID as the actor-scoped idempotency key across retries and dialog reopen.
- The server preview supplies the confirmation amount. Submission sends expected_amount, which the transaction rechecks.
- Existing previews expose only that a request exists. The UI offers a status check, not a new refund. Pending and uncertain outcomes never rotate keys. Authoritative failed/review-required outcomes direct the organizer to platform support.
- Group statuses are normalized explicitly; HTTP 200 alone cannot produce a success message. Unsupported notes are hidden. Legacy single-payment behavior remains covered.
- Group-specific copy explains participant ticket cancellation and slot release even when fees are retained. Sibling participants are excluded from the request.

No unresolved code findings. Hosted staging selected-participant refund and sibling preservation remain release gates.

Validation: 35 focused action/component tests; 1,017 admin tests; 522 runner tests; 827 backend/shared-contract tests; 13 shared UI tests; both app and shared UI typechecks; Fieldnotes audit; both isolated builds. The unchanged 177-migration replay was already verified for the parent proof fix; exact-branch CI repeats replay before staging merge.
