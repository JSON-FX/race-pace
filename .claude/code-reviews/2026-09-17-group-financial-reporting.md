# Group financial reporting review

Reviewed the new reporting migration, role-filtered financial projection, widened report views, payout wrappers, financial tests, and this slice's web query/export/nullable-money changes. Earlier Passport, refund and payment changes retain their separate reviews.

SQL review independently checked authorization, helper grants, snapshot refresh/stamping, and shared-capture double counting. No blocking finding remained in the implemented slice. React review checked server/client boundaries, independent parallel reads, stable table identity, nullable rendering and existing controls.

Resolved findings:
- Commission requested all open event IDs in one URL. The in-app browser reproduced `URI too long`. Reads now chunk IDs, paginate categories and compare minimum prices across chunks. Regression test covers 205 IDs split into 100/100/5.
- Test fixtures omitted waiver/capability requirements. Corrected without relaxing application authorization.

Validation: 587 backend/shared tests; 853 web tests; web typecheck; whitespace checks. Local security advisors reported only existing mutable search paths on increment_slot/decrement_slot. Those remain tracked readiness work rather than changes to this report slice.

No hosted changes or real provider transactions reviewed. Public activation remains blocked by recovery/delivery/reconciliation/UI and sandbox acceptance. Known report limits: group refund timestamps blank; anomaly detail UI pending; existing organization/event summary pagination limits unchanged. See implementation report for full scope and evidence.
