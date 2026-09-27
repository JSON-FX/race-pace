# Fieldnotes browser annotations

Status: implemented and locally verified; ready for the second browser review. Continuation of the component revamp in its isolated worktree.

## Contract

Address all 23 browser comments using the selected Fieldnotes source. Preserve page sections, workflows, provider values, authorization, native form names, required validation, and server rendering. Local preview only; no hosted release. The later explicit request authorizes replacing local events with two complete fixtures and generated images.

## Ordered tasks and validation

1. Shared Fieldnotes Calendar/DatePicker and styled FormSelect, preserving native submission. Validate package types and adapter interaction tests.
2. Runner avatars, card alignment, status dots, footer, reservations, step numbers, payment options and CTA. Validate Runner tests/types and consuming pages.
3. Admin canvas options, payment method/date columns, real totals, plain radios, notice and searchable organization picker. Validate Admin tests/types and consuming pages.
4. Reconcile source hashes and audit. Run both application suites, shared checks, isolated builds, bounded responsive browser review and PIV review. Record every annotation disposition.

## Annotation checklist

| Comments | Correction |
| --- | --- |
| 1–2 | Fieldnotes avatar and 70px Passport chooser rows |
| 3 | Calendar/Popover DatePicker with styled month/year menus |
| 4 | Shared styled Select enhancement for dedicated native menus |
| 5 | Larger identity avatar |
| 6 | Forest border on bookings empty state |
| 7–8 | Equal-height rail cards with aligned distance row |
| 9–10 | Event badges without dots |
| 11 | Readable interface footer typography |
| 12 | Linked reservation Card with left-aligned details |
| 13–14 | Larger journey step numbers |
| 15 | Aligned compact payment choices |
| 16 | Real Fieldnotes Button for reserve/notify anchors |
| 17 | Full-width radio rows for workspace canvas |
| 18–19 | Consistent logo boxes; separate paid-date column |
| 20 | Account total and unique managed Passport total from existing authorized result |
| 21 | Plain commission radios |
| 22 | Calm Fieldnotes provider verification Alert |
| 23 | Searchable organization Command/Popover |

## Completion

All 23 annotations have corrections. Shared checks, both application suites and typechecks, isolated builds, source reconciliation and technical review pass. See [the annotation verification report](../specs/fieldnotes-annotations-verification.md) for current evidence and data-dependent limits.

The local app containers bind this implementation worktree. Their environment files now have stable paths in the original checkout. The local Edge Runtime was repaired from the current staging function snapshot after its former checkout disappeared. Local Supabase retains exactly two newly detailed events. The pre-cleanup database backup and generated imagery remain in the original checkout's ignored `.local/event-review-20260927/` directory.

## Second review: nine annotations

Complete and locally verified. Use only the existing `race-pace` containers, bound to this worktree.

1. Filled Notify CTA; prominent hero and closing reservation anchors; smaller description text.
2. Consolidate linked reservation Card layout and padding on its component root. Remove the duplicate Profile sign-out control.
3. Replace fee type with the existing Fieldnotes Select. Preserve draft values, explicit Save, and all financial calculations.
4. Keep organization IDs on fee/refund warnings; names and warning text are not unique identities. Cover duplicate names with regression tests.
5. Run both app suites/types, current-container end-to-end checks, responsive Browser review, source audit, and technical review.

The later three CTA annotations supersede the initial light treatment: all three actions use the forest-green Fieldnotes Button. Hero and closing actions use compact 240px desktop widths, centered labels/arrows, and 60px/64px heights. Browser verification also found and fixed Users date hydration using the existing Philippine formatter. A date-only birthday stays on its calendar day. See the second-review section in the verification report.

## Open event facts and participant prices

Complete: each course fact uses the canonical Fieldnotes default Badge. Assisted-registration prices use a 17px interface font. Both use the requested forest green with white text. Exact centavo amounts and registration links are preserved. The Runner full suite, types and isolated build pass. Browser review found and repaired an unpositioned parallax Image parent.

The subsequent layout annotation is complete: participant options now form full-width divided rows. Category names, prices and arrows align without an empty grid cell. The 37 existing event tests, Runner types, focused design detector and whitespace check pass after this final layout change. The full suite/build preceded this styling-only follow-up. Only the existing `race-pace` container stack was used.
