# Code review — ticket signing fail closed

Scope: `supabase/functions/_shared/ticket.ts`, `_shared/confirm.ts`, `check-in/index.ts`, the two focused tests and the check-in test fixture. The large unrelated working tree was excluded from this review.

One finding was fixed before deployment: the initial secret guard followed a conditional payment-amount correction. Moving it immediately after the registration-status checks now prevents any write when configuration is missing. The final scoped diff does not change fee formulas, paid replay, ticket payloads, tenant authorization or webhook signature checks.

Code review passed. No remaining technical issues detected in this scope. Staging success-path check-in passed; the absent-secret branch has an isolated regression test but was not exercised by removing the staging secret.
