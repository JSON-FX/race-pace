# Coming Soon category registration fee omission

Date: 2026-09-30. Local browser report; no GitHub issue was supplied.
Base: `origin/staging` at `faba58b58be1f2d0772914701438d6f1ffca94ef`.

## Assessment

| Metric | Value | Evidence |
| --- | --- | --- |
| Severity | Low | Runners cannot compare later entry prices, but reservation terms and payment authorization remain intact. |
| Complexity | Low | The required category price already reaches one presentation component. |
| Confidence | High | The category article omits `base_price`; open events already display it. |

## Reproduction and root cause

The owner supplied a screenshot of the Coming Soon page for Kibalabag Trail Ultra 2027. Its category sections show requirements, inclusions and reservation fees, with no registration fee. Source inspection confirms the omission.

1. `app/events/[id]/page.tsx:86` passes fetched categories to ComingSoonEventPage.
2. `lib/events.ts:84` already selects `base_price` in integer centavos.
3. `ComingSoonEventPage.tsx:275–280` renders each category's requirements and reservation action, but never renders `base_price`.
4. The shared reservation action is not the correct owner: it omits reservation-disabled categories and also serves open events.

This is an original presentation omission, not a query or backend failure. Read-only PIV investigators independently checked the rendering and pricing semantics. No external issue comment is required or authorized.

## Price semantics and acceptance

The catalog price is non-null and nonnegative. The editor initializes a new category at zero and clearing Price also saves zero. No distinct unknown-price flag exists. For this Coming Soon request's “if available” condition, display configured positive prices only. Omit zero/default prices without calling the category free or inventing an announcement state.

- Show Registration fee and the category's formatted peso amount above its reservation action.
- Keep registration and reservation fees separately labeled; never add or subtract them for this display.
- Show the entry fee even when reservation and screening are disabled.
- Keep existing review/hold rules, reservation routing, deadlines and open inclusions unchanged.
- Reuse the current price formatter and layout; no query, schema, provider or shared component changes.

## Implementation and validation plan

1. Add meaningful failing regression cases to `ComingSoonEventPage.test.tsx`: independent category amounts; plain, screening-only and reservation variants; separate reservation fee; zero/default suppression.
2. Add the positive-price block in the existing article's right column. Verify source has not drifted from this investigation.
3. Run focused tests, runner suite/typecheck/build, and Fieldnotes source audit. Check the actual local runner page at desktop, tablet and phone widths using Browser.
4. Review the complete changed files and save results in `.claude/reports/` and `.claude/code-reviews/`. Update the docs ledger. No commit or release was requested.

Existing official controls and the selected open inclusion checklist remain unchanged. This is a small addition to an existing composition; it does not need a new design direction.
