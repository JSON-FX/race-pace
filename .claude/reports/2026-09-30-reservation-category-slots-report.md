# Category slots implementation

The Reservations workspace now reads category metadata with the existing availability RPC after active-organization event validation. The section sits below the four checkout summaries and above the roster. Cards show total, general and reservation slots left with configured capacity. Missing availability and disabled reservations stay explicit.

No backend source, payment, provider or dependency change. Existing canonical ledger handles holds, group places, converted entries and closed reservation windows. Read-only production baseline: 70k 139/100/39; 42k 135/100/35; 25k 241/150/91; 13k 95/50/45; 7k 79/30/49 (total/general/reservation). These are timestamp-specific counts, not fixtures.

Admin typecheck and Fieldnotes source audit passed. The first typecheck caught Supabase's untyped RPC return override; the final typed response follows the existing site query pattern. Admin production build, Hub typecheck and all four catalog builds passed. Impeccable detector reported no findings. Bounded reference review passed at 1440, 768, 390 and 320px. Actual production desktop and 390px phone reads passed; every displayed category count matched a fresh canonical RPC read, and live search did not change capacity. Both production apps and both staging apps are Ready at the reviewed source with their respective database identities. Protected Git reconciliation is tracked in the release evidence. Additional local test suites are explicitly waived by the owner for this urgent session release; required GitHub checks remain enforced.

Storybook changes are limited to its incumbent Reservations proposal and preserve unrelated dirty catalog work. Its fixtures are illustrative; application counts come only from the canonical RPC.

[Release evidence](../../docs/operations/reservation-category-slots-release-20260930.md) records the owner-authorized direct production exception, exact deployments, successful required CI and unchanged font-loader retry. No production data or financial action was created.
