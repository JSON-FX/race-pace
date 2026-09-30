# Organization discounts implementation

Source: approved chat plan and `docs/specs/2026-09-30-organization-discounts.md`.
Branch: `codex/org-discounts`, isolated from staging `70fc678`.

1. Add additive organization/code/redemption schema, admin-only access, atomic application and free confirmation. Validate migration replay and integration tests for concurrency, access, and accounting.
2. Integrate deferred web single checkout and group preparation/confirmation. Preserve native callers and uncertain provider outcomes. Validate payment/refund/pre-screening regression suites.
3. Build Fieldnotes admin and per-Passport checkout components with Storybook states. Add payment/registration columns and exports. Validate app typechecks and tests.
4. Run full local CI, PIV review, and desktop/tablet/mobile browser acceptance. Record outcomes and remaining release gates in the implementation report and launch progress. No production changes belong to implementation.

Financial policy: integer centavos; percentage savings round to nearest centavo; flat savings cap at eligible base; 100% forces full coverage; each zero-total participant has zero commission/processing fees. Paid discounted entries below provider minimum or with insufficient absorbed-fee coverage fail clearly. Existing fixed commission clamp remains.

Safe lifecycle: applying reserves a redemption; changing undispatched quotes releases/replaces it atomically; dispatched/uncertain attempts cannot change. Explicitly expire and verify old sessions before restarting a legacy checkout. Successful settlements consume reservations once. Provider expiry is required before releasing uncertain uses. Preserve original totals and per-registration snapshots.

## Completion

All four implementation phases completed locally. See [implementation report](../../.claude/reports/2026-09-30-organization-discounts-report.md) for 2,406 passing tests, 178 replayed migrations, both production builds, browser evidence, review fixes, and release limits. Existing code terms are immutable from creation; deactivate and replace to change an offer. Hosted staging and provider acceptance remain before release.
