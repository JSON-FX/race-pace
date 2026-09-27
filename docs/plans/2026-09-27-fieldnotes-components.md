# Fieldnotes component revamp

Status: implemented and locally validated. Branch: `codex/fieldnotes-component-revamp`. Base: `1188768f33ea4999407774c15fc3146d8e72cc25`.

## Contract

Implement the approved full audit and component migration for Runner and Admin. One shared `@race-pace/ui` package owns primitives. Preserve sections, layouts, page canvases, section typography, tenant boundaries, authorization, financial values, native form submission and domain behavior. No deployment or production writes are part of implementation.

## Ordered tasks

1. Record immutable source inventory, consumers, inline control locations, target components, findings, compatibility and verification. Validate source counts and all 63 catalog dispositions.
2. Snapshot used Hub source and dependencies with SHA-256 hashes. Add the shared package, component-scoped RGB tokens, import compatibility and Tailwind source registration. Validate shared and application types.
3. Fix modal focus, keyboard selections, combobox active options, field relationships and uploads. Validate focused interaction tests.
4. Migrate native controls, disclosures, feedback and data primitives throughout both apps. Preserve specialized renderers and controller state. Reconcile audit findings.
5. Review responsive, keyboard, dark, reduced-motion and print states. Run both app typechecks/tests/builds plus required repository checks. Record exact evidence and limitations.

## Acceptance

Every source module and inline candidate receives a disposition. Existing UI import paths reexport one implementation. Fieldnotes appearance remains component-scoped, including portals. Forms preserve names and values. Selection, overlays, errors and loading remain accessible. Review at 320px, 768px and 1440px. No unrecorded source or design deviations.

## Validation

`node scripts/audit-fieldnotes-components.mjs --verify`, package typecheck, both app typechecks/tests, isolated application builds, backend/shared test suite, responsive application browser review, PIV review.

## Completion evidence

All five implementation tasks are complete. See [the verification report](../specs/fieldnotes-components-verification.md), [complete source checklist](../specs/fieldnotes-components-audit.md), and current reconciliation JSON. Source and review evidence remain in this isolated branch. Release is a separate staging-first action when requested.
