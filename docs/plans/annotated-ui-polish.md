# Annotated UI polish

## Scope and product contract
Fix the owner's thirteen annotations. Preserve current runner category composition and all registration, payment, reservation, approval, and tenant behavior. No database, provider, or Edge Function changes. Isolated worktree starts from staging b986dbb2992dad615e5c69b5382f29b8e5dd89f9.

The runner inclusion choice A was approved on 2026-09-30; prior owner review at docs/previews/category-inclusions/index.html. Three alternatives keep all eight existing items visible. Application integration uses the approved compact open checklist. Admin fixes are independently authorized.

## Context and verified causes
- apps/web/components/AdminCanvasPreference.tsx: existing preference already defaults White; sidebar token does not follow it.
- apps/web/components/Sidebar.tsx: expanded padding persists inside narrow collapsed rail.
- apps/web/components/StatusBadge.tsx: shared Status defaults to a decorative dot; disable in admin adapter.
- apps/web/app/(admin)/events/event-editor-form.tsx: checkbox descriptions inherit leading-none; add explicit spacing/line height.
- apps/web/components/form-section.tsx and AppShell.tsx: stretched rail and unconstrained scroll container prevent useful sticky behavior.
- ScheduleEditor, AddonEditor, CategorySettings: tiny Add overrides remove button padding.
- apps/site/components/event/CategoryInclusions.tsx: collapsing button is unnecessary and inherits unwanted full-width styling. Replace only this component after selection.
- apps/site/components/event/EventPageBody.tsx: preserve current category shell, campaign typography, price and actions.
- Official shadcn Button examples and existing primitives remain authoritative. Reuse installed components; no framework or primitive replacement.

## Ordered work
1. Present responsive HTML inclusion alternatives and catalog them as Storybook proposals. Validate every item remains visible at desktop/tablet/mobile. Obtain owner selection.
2. Independently implement admin annotations in apps/web only. Preserve stored choices, dark mode, navigation links, focus and form semantics. Validate admin typecheck and existing component tests.
3. Integrate selected inclusion markup into CategoryInclusions only. Preserve ordered list content and empty behavior. Validate runner typecheck and existing event/prescreening tests.
4. Inspect desktop/tablet/mobile application rendering, collapsed sidebar, all canvas choices, sticky navigation and Add hover/focus. Run Impeccable detect on changed UI once; audit shared components.
5. Run complete CI mirror: dependency lock install, local migration replay, local safety assertion, fake-provider functions and proof verifier, shared UI tests/types, both application tests/types, backend/shared contract suites, isolated production builds. Run Storybook typecheck and all catalog builds. Review final diff and write implementation/review reports.
6. Commit only scoped files; PR to staging. Verify exact merge CI, both Ready staging deployments and hosted annotation acceptance. Record commit/deployments/backend identities before staging-to-main promotion. Verify production read-only and synchronize main into staging.

## Edge cases and acceptance
- Default White with absent/invalid storage; explicit saved choices remain respected. Sidebar and canvas agree without hiding dark mode.
- Collapsed logo stays centered without clipping account or navigation controls.
- Badge labels/colors remain, dots removed across four annotated admin tables.
- Sticky rail remains usable inside the actual page scroll container on desktop; mobile navigation does not cover fields.
- Checkbox helper lines wrap naturally; Add button hover includes readable padding.
- Inclusion list is always visible, handles long labels/narrow screens, and renders nothing when empty. No surrounding section redesign.
- Any incomplete required staging check blocks production. No synthetic production data or live charge.

## Open decisions
Inclusion design A selected by the owner. All admin annotations are explicit and need no further clarification.

## Progress — 2026-09-30
HTML options and Storybook proposals built. Desktop/tablet/mobile HTML reviewed, all eight inclusions visible without overflow. Storybook typecheck and four catalog builds passed; catalog Docker refreshed. Admin fixes prepared in ten apps/web files. Shared UI audit/typecheck/tests and both app typechecks passed. Existing app suites: site 522 tests, admin 1,017 tests passed. Full local backend verification, application visual acceptance, owner inclusion selection and releases remain pending. No hosted mutations performed.

## Amendment — 2026-09-30
Owner selected A and authorized integration and staging-to-production release after verification.

Full local backend suite passed: 827 tests. Both isolated builds passed; the final checklist typography polish is being rebuilt before commit. Staging and production baseline readbacks confirm 177 migration versions. Final hosted browser acceptance remains required.
