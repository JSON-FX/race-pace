# Fixed-price PayMongo checkout review

Status: staging implementation validated locally; production release blocked. Reviewed runner price display, single checkout creation/reuse, PayMongo capture confirmation, and the new fee-term migrations. The working tree contains unrelated unfinished changes, so this is a scoped review rather than a release review of the full branch.

## Validation

- Site: 44 files, 391 tests passed; typecheck passed; staging Vercel build Ready.
- Provider/group focused tests: 71 passed. Two focused backend tests passed for checkout reuse and fixed-price capture rejection.
- Staging: four changed Edge Functions Active. Browser read-back showed ₱100 total with ₱3 included, then the user completed PayMongo test GCash. The paid webhook, ledger, QR ticket and organizer settlement agree on ₱100 gross, ₱2.50 actual processor fee, ₱3 Race Pace fee and ₱94.50 organizer net.
- The earlier root backend suite had 9 failures because the local Edge process used a PayMongo test key while older tests expected the fake provider; it is not a green full-backend result for this snapshot.

## Findings

| Severity | Location | Issue | Required correction |
|---|---|---|---|
| P1 | `supabase/functions/payment-session/index.ts:148` | Reusing one URL prevents new orphan sessions on each tap, but the original PayMongo session remains chargeable after a local hold expires or an event closes. PayMongo says sessions do not auto-expire. | Explicitly expire the provider session when a reservation expires, is cancelled, is replaced, or is settled. Test late-capture races. |
| P1 partial | `supabase/functions/registrations-checkout/index.ts:266` | The request is now frozen before PayMongo creation. A stable key and exact-payload retry can recover a missing URL inside 23 hours. The controlled lost-response path is not yet live-tested, and the first attempt may remain uncertain after PayMongo's 24-hour idempotency window. | Live-test the recovery path. Record unresolved attempts for staff review and expire any provider session before the local reservation is retired. |
| P1 | `supabase/functions/_shared/confirm.ts:106` | Once the registration is paid, later paid callbacks return `already` without comparing the provider payment ID. A second captured payment could be unrecorded. A capture conflict at line 333 is only logged. | Store each captured provider payment ID in a unique reconciliation inbox, detect duplicates and amount mismatches, alert staff, and block affected payouts until resolved. |
| P1 | `docs/operations/launch-progress.md:28` | Fixed-price GCash now reconciles, but Maya/card, failure/retry, provider-session expiry and the live CSV bytes remain unverified. | Finish the sandbox method matrix with user payment handoff and compare provider, database, refund, report, export and settlement totals. |
| P2 | `apps/site/app/register/[categoryId]/RegisterWizard.tsx:337` | “Taxes and fees” includes a platform commission, but tax calculation and receipts are not implemented. The label may imply a tax treatment that has not been established. | Define tax treatment with accounting/legal review before a production release, then align labels and receipts. |

The fixed-price guard deliberately refuses a captured amount above the advertised total. It does not yet create a durable case or automatic refund, so this state requires manual investigation in staging. Do not promote this deployment to production until the P1 items are closed and verified.
