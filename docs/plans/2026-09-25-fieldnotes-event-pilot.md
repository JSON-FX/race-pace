# Fieldnotes event pilot implementation

1. Start from current `origin/staging` in an isolated worktree. Preserve the existing dirty main checkout. Read the selected Hub design and the current runner/admin event code.
2. Apply scoped Fieldnotes tokens and typography to the public race list. Use a route-only card so home and rail cards remain unchanged. Keep URL filters and derived status semantics.
3. Apply scoped Fieldnotes tokens and table appearance to the admin event directory. Keep the existing data table, actions, authorization, and error handling.
4. Add matching runner/admin context stories to the Hub and record exact stylesheet synchronization in the design spec.
5. Run both app typechecks, affected tests, Storybook typecheck and build, then inspect responsive layouts and interactive states. Keep this as a local review checkpoint; use the staging-first release path only after the pilot is accepted.

## Runner search extension

1. Add a URL backed `q` term to the existing pure filter functions. Search race names, organizers, and location fields, then verify parsing, combinations, and round trips with `pnpm --filter site exec vitest run lib/__tests__/eventFilters.test.ts`.
2. Add a labeled search control above the runner chips. Preserve active filters on submit and retain search when a chip changes. Verify with `pnpm --filter site typecheck` and the local `/events` route.
3. Update the canonical runner pilot stylesheet and the live contextual Storybook story. Copy the stylesheet to the app and verify the SHA pair. Run `pnpm typecheck` and `pnpm build:all` in the Hub, rebuild Docker, and inspect desktop and phone widths.
4. Run the runner production build, check the local search and empty states, and record the result in the launch progress table.
