# Fieldnotes component contract

The approved migration replaces shared and dedicated UI primitives in Runner and Admin. Domain components retain their composition and business logic. Source inventory lives in `fieldnotes-components-audit.json`; the migration checklist lives in `fieldnotes-components-audit.md`.

## Authority

Hub: `/Users/jsonse/Documents/development/storybook-hub`. Active Fieldnotes `DESIGN.md`, `src/fieldnotes-next/theme.css`, live React gallery and `packages/race-pace-ui/src/ui/` own source and visual authority. Separate Dossier, Afterglow and Tideway proposals do not change this contract. A Hub commit alone does not identify its uncommitted source; the package sync manifest records exact source hashes.

## Integration

`@race-pace/ui` lives in this monorepo. Application `components/ui` modules are thin reexports. Shared source retains official component anatomy, APIs, refs and controlled state. Only used primitives and their transitive dependencies are copied. Domain labels and shared behavior adapters remain explicit.

Fieldnotes tokens apply on existing component roots and portal content. Component variables retain the application's RGB-channel convention, and direct CSS color references use valid wrapped color variables. No application root palette or page font changes. Controls use Apple interface type; overlay titles follow Fieldnotes; money uses tabular interface figures. Ordinary controls meet 44px target guidance. Compact variants are explicit. Keyboard focus and reduced motion remain visible and usable.

## Preserve

Native names, hidden inputs, form submission, required values, server table state, registration drafts, waiver acceptance, passport restrictions, payment methods, amount calculations, busy locks, check-in safeguards, uploads, crop transforms, QR printing, theme/canvas preference and role-based navigation. Maps, SVG charts, hero photography, ticket artwork and CAPTCHA remain dedicated renderers.

## Highest-priority fixes

ShirtSizeSheet and CourseDrawEditor modal semantics; RacesList tabs and commission radio keyboard behavior; Field hint/error associations; EventCombobox active descendant; keyboard upload buttons; bounded crop dialog.
