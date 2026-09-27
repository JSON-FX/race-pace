# Race Pace Fieldnotes UI

One implementation of Fieldnotes primitives for Runner and Admin. The package contains 39 canonical UI modules plus the shared mobile hook, semantic status, field relationships and single-choice composition.

## Source contract

`SOURCE_SYNC.json` pins the exact uncommitted Storybook Hub source through SHA-256 hashes. The Hub base commit identifies ancestry only. Original source hashes and application-adapted hashes are separate. `adaptedFiles` records the RGB stylesheet and compatibility adapters. The Hub working tree remains authoritative and was not modified by this migration.

Import primitives from `@race-pace/ui/ui/button` (or another primitive path). Existing application `components/ui` paths remain thin reexports. Import `@race-pace/ui/fieldnotes.css` once in each application stylesheet and register this package's source with Tailwind. Both Next applications transpile the package.

## Boundaries

Tokens live on component roots and portal content through `data-rp-ui="fieldnotes"`. They use RGB channels because the applications consume `rgb(var(--token))`. SidebarProvider and SidebarInset do not scope colors to the whole page. Page canvases, section typography, layouts, map engines and ticket artwork remain application concerns.

The Button API retains `asChild`, refs, submission types and a loading lock. Card's `asChild` extension preserves linked cards without adding wrapper DOM. Modal content remembers programmatic openers and menu triggers. ChoiceGroup preserves provider values and native form names. FieldFrame links labels, hints and errors. Native hidden/file inputs remain native controls.

Default control targets are 44px. Compact sizes are explicit. Checkbox, radio, switch and slider glyphs retain their canonical dimensions with expanded pointer targets. Reduced-motion overrides and phone-sized overlay bounds are component-scoped.

## Verification and future syncs

Run `node scripts/audit-fieldnotes-components.mjs --verify`, `pnpm --filter @race-pace/ui typecheck` and `pnpm --filter @race-pace/ui test`. The audit rejects duplicate primitives, unresolved recognized controls and changes that do not match the recorded adapted hashes.

For a future Hub sync, review source changes, retain only needed primitives/dependencies, document compatibility adaptations, update the reviewed hashes, and rerun consuming application checks. Do not copy catalog demonstration data into either application.

FormSelect enhances native dedicated menus after hydration. It preserves the real native field for submission, reset, refs and required validation. DatePicker composes the canonical Calendar and Popover, uses local civil dates and includes styled month/year menus. The calendar uses explicit compact 36px cells to fit a 320px viewport.
