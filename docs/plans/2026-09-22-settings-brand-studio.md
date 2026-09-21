# Settings Brand Studio implementation

Status: implemented locally on `codex/settings-brand-studio` from current `origin/staging`.

## Scope

Implement the approved Brand Studio settings design in `apps/web` while preserving every existing settings workflow.
Add a reusable searchable combobox for form-backed selections and use it for event waiver assignment.

## Tasks

1. Add a generic Shadcn Popover and Command combobox with form submission and interaction tests.
2. Compose the settings page around the approved identity preview, section rail, and responsive card grid.
3. Restyle profile, check-in, branding, waiver publishing, assignment, and history without changing their actions.
4. Extend page and form tests for permissions, retained behavior, and searchable selection.
5. Run the focused admin tests, full admin test suite, and admin TypeScript check.

## Validation

- Focused settings and shared combobox tests: 15 passed.
- Full admin suite: 116 files and 909 tests passed.
- Admin TypeScript check: passed.
- Site suite: 60 files and 458 tests passed; site TypeScript check passed.
- Repository CI assertions: passed for 145 migrations and the legacy push-job audit.
- Root backend tests were not a UI regression signal in this worktree. They require the ignored Edge Function environment file and a running configured function stack; 83 files and 667 tests passed before the environment-dependent failures.
- The local browser reached the real login gate. Automated visual inspection stopped at bot verification without bypassing authentication.

## Acceptance

- The page matches the approved Brand Studio hierarchy in light and dark themes.
- Event and waiver choices are searchable Popover controls.
- The searchable combobox is generic and available under `components/ui`.
- Existing Server Actions receive the same field names and values.
- Non-admin read-only behavior and no-organization behavior remain intact.
- Focus, keyboard selection, empty results, responsive layout, and disabled states are covered.
