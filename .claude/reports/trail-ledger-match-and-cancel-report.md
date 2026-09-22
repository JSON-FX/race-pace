# Implementation report: Trail Ledger alignment and cancellation

**Plan:** `.claude/plans/trail-ledger-match-and-cancel.md`
**Branch:** `codex/trail-ledger-match-and-cancel`
**Status:** Complete locally; hosted staging verification pending.

## Summary

The group payment page now follows the approved Trail Ledger layout. It keeps the actual event, participants, categories, prices, payment method, and order state from the database.

Pending bookings now offer **Change participants**. The ShadCN confirmation dialog explains that cancellation releases held spots and returns the runner to the Trail Roster. The user can then select only themselves or create a different group.

## Implementation

- Updated the Trail Ledger card width, spacing, borders, participant rows, assurance copy, and payment summary.
- Added mixed-category count handling without losing per-runner category labels.
- Added a reusable ShadCN Alert Dialog component.
- Added the authenticated `group-order-cancel` Edge Function.
- Added the service-role-only `booking_order_cancel` database routine.
- Expired prepared attempts and cancelled pending registrations in one transaction.
- Blocked cancellation after provider dispatch, capture, or payment state advancement.
- Removed the saved browser payment reference before returning to the roster.

## Validation

- Site: 462 tests passed, TypeScript passed, production build passed.
- Admin: 909 tests passed, TypeScript passed, production build passed.
- Backend/shared: 753 tests passed across 93 files.
- Focused group-payment suite: 52 tests passed.
- Database reset and migration replay passed.
- Desktop and mobile browser review passed without horizontal overflow.
- The cancellation dialog and return path were exercised locally.
- Whitespace validation passed.

## Release boundary

No staging or production service was changed. The new migration and Edge Function must follow the repository's staging-first release workflow before production promotion.
