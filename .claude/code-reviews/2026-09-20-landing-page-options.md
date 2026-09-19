# Code review: Course Atlas landing page

## Result

Code review passed. No technical issues detected.

## Stats

- Files Modified: 14
- Files Added: 33
- Files Deleted: 0
- New lines: 2,487 across tracked and new text files
- Deleted lines: 194

## Review scope

- Five isolated landing-page concepts and their non-indexed comparison routes.
- Course Atlas promotion to `/`, the original race-browsing home at `/home`, and the full catalog at `/events`.
- Four generated Course Atlas section backgrounds and responsive image treatment.
- Shared shadcn calls to action, journey cards, metadata, and route behavior.
- Photo-only pointer parallax, touch fallback, reduced-motion behavior, and decorative image semantics.
- Browser-feedback changes covering overlays, journey styling, checkpoint spacing, and the QR Ph footer mark.
- A responsive organizer signup section with compact footer transitions and a white, forest-green form card.
- A dedicated organizer-inquiry Edge Function and Reply-To support in the shared email transport.
- Mobile layout, touch targets, focus states, horizontal overflow, and browser errors.

## Security and privacy review

- No secrets, credentials, external scripts, or remote image hosts were added.
- The public form calls one dedicated Edge Function and never receives an email-provider credential.
- The function uses a fixed Race Pace recipient, strict length validation, HTML escaping, subject-line normalization, a 4 KB request limit, and a hidden honeypot.
- Delivery failures return generic client errors; provider details stay in server logs.
- Generated images contain no text, sponsor marks, readable brands, or identifiable faces.
- QR Ph artwork is stored locally and contains no script or external resource references.
- The five-option design-study routes remain excluded from search indexing.

## Performance review

- The root hero uses one 230 KB source WebP through `next/image` with preload priority.
- The three below-fold Course Atlas images use `next/image` lazy loading and responsive sizing.
- Pointer motion is scoped to each section and batches transform writes within one animation frame.
- Touch devices and reduced-motion preferences receive static backgrounds without `will-change`.
- Desktop and 390 px mobile views measured zero horizontal overflow.

## Validation evidence

- All 426 site tests passed across 53 files.
- Site TypeScript check passed.
- All 17 focused organizer-inquiry and email-transport tests passed.
- `/` and `/home` both returned HTTP 200 from the local server.
- Desktop and 390×844 Course Atlas views rendered without application console errors.
- The organizer section has no horizontal overflow at the mobile breakpoint.
- The final footer kept all five accepted-payment marks on one desktop row and wrapped safely on mobile.
- `git diff --check` passed.
- The full backend/shared suite passed 710 of 714 tests. Four environment-dependent tests failed because the current database lacks the expected `muspo` test user and one seeded organization; none exercises the changed inquiry code.
