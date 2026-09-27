# Second annotation review

Scope: eight existing application/test files changed in this follow-up, alongside plan, evidence and ledger updates. Earlier uncommitted Fieldnotes changes remain covered by their prior review. No new production module or backend code was added.

## Review

- Warning lists retain an organization ID and text. All three lists use stable IDs; distinct organizations with the same name keep their warnings. No data deduplication masks a warning.
- Commission Select stores `percent`/`fixed` only as the existing draft. Hidden action fields, organization ID, explicit Save, money arithmetic and independent fee mode remain intact. Keyboard review and form-value regression pass.
- Reservation Card root owns grid and padding so Slot child classes cannot compete with the default flex/padding. The existing reservation link, status and Philippine deadline are preserved.
- The Profile change removes only the duplicate lower logout control and its unused imports. Header logout remains.
- Coming Soon changes preserve anchors, notice submission, reservation lifecycle, provider selection and content. Scoped CTA sizing overrides the shared minimum without modifying canonical components. All three final actions use the requested forest green.
- The populated reservation exposed invalid old summary selectors. They now match the actual summary class, restoring the intended spacing.
- Users date helper preserves null/invalid guards and reuses the canonical fixed-zone formatter. Date-only birthdays are no longer converted to a runtime-local noon timestamp. This avoids both hydration differences and birthday day shifts.

## Evidence and findings

All 483 Runner and 943 Admin tests pass. Both types and isolated production builds pass. New regressions cover duplicate warning identities, unsaved fee-type values and a Philippine midnight boundary with date-only birthday preservation. Browser fresh logs on the reviewed routes are clean. Eight configured E2E cases pass across full/focused runs. The one missing-credential non-admin case and the initial empty-organization table failures are documented in the verification report.

Code review passed. No outstanding technical issues detected in the follow-up scope. No write to hosted data or provider, and no extra container stack.
