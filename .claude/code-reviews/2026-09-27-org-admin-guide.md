# Technical review: organization admin Guide

Review performed against the complete local changes in `codex/org-guide-prototypes`, based on `1188768`. New application, migration, and test files were read in full. Existing auth/role/navigation/Storage patterns and source synchronization were checked. Proposal assets were already reviewed during the five-choice design pass.

## Stats before review/report artifacts

- Files modified: 6
- Files added: 38
- Files deleted: 0
- New text lines in untracked source/docs: 2152

## Findings and disposition

Code review passed. No unresolved technical issues detected.

Authorization is enforced by database and Storage policies in addition to page/action guards. Admin reads are shared across organizations only for published teaching content. Editors and field staff retain no Guide access. Exact metadata path matching prevents draft or orphan signing. Explicit table grants and existing auth helpers avoid privileged function grant drift.

Mutation validation bounds metadata and binds uploaded paths to the guide ID. Actions verify uploaded objects and returned saved rows. Immutable upload paths survive uncertain metadata responses for retry. Optional thumbnail failure preserves a usable recording. Object cleanup is deliberately excluded from this slice and recorded in the specification.

The implementation preserves Fieldnotes adapters and installed primitives. AppShell supplies real navigation. Browser verification found tablet overflow from the shell's minimum content width; `min-w-0` fixes it at the owning flex item. Modal opener restoration, invalid replacement handling, portrait thumbnail proportions, and reduced-motion play centering were checked during implementation.

## Evidence

- Backend: 98 files, 777 tests pass, including new guide role/Storage coverage and function-grants audit.
- Web: 123 files, 988 tests pass, including 52 new guide checks and navigation coverage.
- Site: 65 files, 483 tests pass.
- Web/site/shared typechecks, both app builds, and diff whitespace check pass.
- Fresh isolated replay: 158 expected/applied migrations; zero retired push jobs or legacy vault keys.
- Saved application browser check passes at 1440/820/390 pixels with real signed playback, search/reset, focus restoration, mobile Guide navigation, and reduced motion.

No hosted release or production data mutation is claimed.
