# Code review: mixed-category group checkout

## Result

Code review passed after one documentation correction and one additional database assertion. No unresolved technical issues were detected.

## Stats

- Files modified: 18
- Files added: 8
- Files deleted: 0
- New-file lines: 1,223

## Review scope

- Per-participant category selection for the signed-in runner and managed Race Passports.
- Atomic mixed-category reservation with stable category locking and per-category capacity checks.
- One PayMongo payment with per-registration quote lines, allocations, ticket tokens, and refunds.
- Participant-category display in the payment page and group ticket email.
- The Trail Roster selection interface and the Trail Ledger payment review.
- Official ShadCN Item, Checkbox, Select, Card, Badge, Button, Separator, and Skeleton composition.
- GCash, Maya, QR Ph, Visa, and Mastercard payment marks.
- Legacy same-category request compatibility and nullable mixed-order category headers.
- Responsive behavior, accessible labels, keyboard-capable controls, and payment error states.

## Security and data-integrity review

- Mixed bookings remain limited to one organization and one event.
- The database validates category ownership and registration-to-order scope.
- Reservation, payment confirmation, and refunds lock categories in stable identifier order.
- A full category rolls back the entire reservation instead of creating a partial order.
- Captured payments still require exact provider identity, amount, currency, mode, and ticket tokens.
- Each paid registration receives a distinct signed ticket token.
- Partial refunds release slots only for the refunded registrations' categories.
- Replaced security-definer functions retain explicit service-role-only grants.
- No secrets, remote scripts, production data, or live payment operations were added.

## Validation evidence

- The full site suite passed 461 tests across 61 files.
- Site TypeScript validation passed.
- The production site build passed.
- The full web suite passed 909 tests across 116 files.
- Web TypeScript validation and the production web build passed.
- The backend and shared suite passed 750 tests across 93 files.
- A clean local database reset applied all 146 migrations.
- The local migration assertion script passed.
- Focused group payment tests passed 48 cases.
- Focused grant, order, and reservation tests passed 26 cases.
- A local mixed-category order reserved two Passports in two categories under one order.
- Payment preparation produced one combined attempt and two registration quote lines.
- Group fulfillment produced two distinct ticket tokens and category-aware email output.
- The local ticket QR function returned a valid 512 by 512 PNG.
- Desktop and mobile browser checks found no horizontal overflow or application errors.
- The ShadCN payment Select opened with all four methods and their correct provider marks.
- `git diff --check` passed.

## Release note

The feature was rebased onto `origin/staging` at `5ad5614`. The complete local suite then passed on the integrated revision before hosted staging deployment.
