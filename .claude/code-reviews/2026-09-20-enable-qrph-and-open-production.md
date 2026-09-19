# Code review: Enable QR Ph and open production

## Result

No unresolved findings.

## Review scope

- Production launch-gate removal in both Next.js applications.
- Staging crawler protection after the production gate removal.
- PayMongo method identifiers and server allowlists.
- Single and group checkout request construction.
- Database constraints, security-definer function grants, and rate-card visibility.
- Admin method presentation and filters.
- Tests covering provider request shape, database preparation, and grants.

## Security review

- No secret values or credentials were added to tracked files.
- QR Ph is accepted only through explicit server-side allowlists.
- Provider checkout URL validation remains unchanged.
- Client-computed totals remain display-only.
- Signed webhook and provider capture checks remain the payment authority.
- Staging continues to emit noindex, nofollow, noarchive, nosnippet, and noimageindex.

## Accounting review

QR Ph uses the existing PayMongo capture and ledger flow. The migration exposes its seeded rate only for estimates and forecasts. Actual captured processor fees remain the source for payments, refunds, settlement, and payout reporting.

## Validation evidence

- 1,995 automated tests passed across site, admin, and backend/shared suites.
- Site and admin TypeScript checks passed.
- Database lint returned only existing unrelated warnings.
- Site and admin production builds passed from the exact implementation commit.
