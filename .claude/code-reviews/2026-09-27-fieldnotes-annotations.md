# Fieldnotes annotations technical review

Date: 2026-09-27. Reviewed the annotation corrections in the existing isolated component-revamp worktree. No new backend schema, provider mapping or financial calculation source was added.

## Working-tree statistics

The combined uncommitted revamp has 225 tracked files in its diff, 1894 added lines and 5615 removed lines. There are 108 untracked files, including generated audit metadata. These figures include the first revamp; annotation changes are a continuation.

## Method

Read the shared form adapters, Calendar, choice and field compositions, scoped token CSS, organization picker, count aggregation, payment columns, link cards, dedicated avatar controls and affected app styles. Compared against the selected Fieldnotes source snapshot and preservation contract. Used meaningful adapter tests, both app suites, source reconciliation, consuming-page Browser checks and isolated builds. Final phone-fit changes received focused existing tests, typecheck, build and browser readback.

## Findings fixed

- Medium: the hidden native select preceded its visible trigger inside an implicit label. The visible Select now precedes the hidden native control; the new regression case passes.
- Medium: a fully enhanced date picker would lose usable pre-hydration submission. Server HTML now renders the native date field with its original form contract, then enhances after mount.
- Medium: long waiver titles expanded a phone grid's minimum size. Collapsible roots and triggers now allow shrinking; titles truncate inside the intended disclosure width.
- Medium: migrated Admin bottom-nav controls inherited Button typography, SVG padding and intrinsic widths. Explicit compact sizing, zero basis and bounded labels restore equal cells. Browser confirms document width 320px and five 62.4px cells.
- Low: style changes require adapted-source hashes to advance. The reviewed snapshot is refreshed; audit verification reports zero drift or unresolved controls.

## Result

Review passes after these corrections. The manual design detector reported no findings. No outstanding source defect was reproduced in the reviewed scope. Limits are explicit: one E2E case lacks credentials; cleanup removed final populated reservation states; provider and hosted release verification remain separate. See [current verification](../../docs/specs/fieldnotes-annotations-verification.md).
