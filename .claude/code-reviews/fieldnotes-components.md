# Fieldnotes component technical review

Reviewed against staging `1188768f33ea4999407774c15fc3146d8e72cc25` on 2026-09-27. Implementation remains uncommitted in the isolated worktree.

## Stats at review

- Files modified: 213
- Files added: 101 (before this review artifact)
- Files deleted: 0
- New lines in tracked diff: 1682
- Deleted lines in tracked diff: 5527
- Lines in new files: 65172; most audit/reconciliation volume is generated source metadata.

## Scope and method

Reviewed shared primitives/adapters, source hashes and dependencies, app reexports, scoped CSS, control substitutions, accessible relationships, modal focus, native form contracts, loading locks, and preservation of domain handlers. Used application suites, shared behavior tests, backend contracts, source reconciliation, consuming-page browser checks and isolated production builds. No backend, migration, provider mapping or amount-calculation source was changed.

## Verified findings, fixed

- **Medium — modal focus:** a menu item disappears when its dialog opens. The initial implementation stored that detached item. `packages/ui/src/lib/modal-focus.ts` now resolves the persistent trigger from the menu's `aria-labelledby` relationship. The new failing test passed after the fix; Browser verified the actual cancellation flow.
- **Medium — hidden control geometry:** canonical Input dimensions expanded hidden scanner/GPX controls. The shared stylesheet restores visually-hidden dimensions. SidebarInset also needs `min-w-0` for contained table scrolling. The 108-state matrix has zero document overflow.
- **Medium — active navigation:** several migrated Button links lost active colors. Explicit active variants retain their current-page announcement and visible state.
- **Medium — gallery geometry:** a Button default height collapsed the image trigger. Dedicated gallery dimensions now retain automatic height; actual pointer opening and Escape return focus pass.
- **Medium — outline contrast:** an outline control inside a dark section inherited light text despite its own light background. The primitive now declares its semantic foreground.
- **Low — React keys:** keys on nested Link children did not key their new Button wrappers. Keys now live on the outer composition.
- **Low — stale E2E selectors:** exact password-sign-in selectors avoid the Google action, and the non-admin heading assertion now matches existing page copy.

## Conclusion

Code review passed after the listed corrections. No outstanding technical defect was reproduced within the reviewed scope. This conclusion is bounded by the source/route coverage and provider limitations in [the verification report](../../docs/specs/fieldnotes-components-verification.md). Hosted release validation remains separate.
