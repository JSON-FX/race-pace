# Implementation Report — Race Bib single registration

**Plan:** `docs/plans/2026-09-23-race-bib-single-registration.md`

**Branch:** `codex/register-single-race-bib`

**Status:** COMPLETE locally; staging release pending

## Summary

The approved Race Bib design now wraps the live Details, Kit, Confirm, and Pay steps. It uses current race and Passport data, the saved runner avatar, the existing payment artwork, and the existing checkout guards. The generated dark trail image is optimized as a 165 KB WebP.

## Tasks completed

- Shared photographic masthead, progress rail, task card, and price summary in `apps/site/components/registration/RaceBib.tsx` and its styles.
- Responsive Passport, kit, review, waiver, and action layouts in `RegisterWizard.tsx` and its styles.
- Responsive payment summary, existing method logos, and secure checkout presentation in `PayPanel.tsx` and its styles.
- Read-only race location mapping, the selected preview, design specification, tests, and roadmap updates.

## Tests added

- `RegisterWizard.test.tsx`: saved profile avatar and missing-photo initials fallback.
- `PayPanel.test.tsx`: exact existing QR Ph, GCash, Maya, Visa, and Mastercard artwork paths.
- Existing wizard assertions now use the approved step headings and payment action.

## Validation results

- Runner site: 463 tests passed; typecheck and production build passed.
- Admin site: 909 tests passed; typecheck and production build passed.
- Backend and shared: 754 tests passed. A fresh local database reset replayed all 147 migrations, and the migration assertion passed.
- Focused registration and payment tests: 31 passed.
- Visual review: 375, 390, 768, 1024, 1265, and 1440 pixel widths showed no horizontal overflow. Details, Kit, Confirm, and Pay were inspected in the browser.
- `git diff --check`: passed.

## Deviations from the plan

The preview's fictional photo pack and sample profile image stay in documentation. The live page shows only configured add-ons and the runner's own saved photo. Numeric category labels use “Individual entry” beside the distance to avoid repeating the same number.

## Issues encountered

The first backend test attempt lacked `SUPABASE_FUNCTIONS_ENV_FILE`. Re-running with the same local fake-function environment passed all 754 tests. No production or hosted staging data was changed during local checks.
