# Browser UI refinements implementation plan

**Status:** All annotations and the registration dialog follow-up complete locally. **Branch:** `codex/browser-ui-refinements`.
**Spec:** [Acceptance contract](../specs/2026-09-30-browser-ui-refinements.md).
**Workflow:** PIV planning, implementation, validation, and review. No commit or release step requested.

## Problem and approach

As a runner or organizer, I want clear identities, dates, navigation, and account summaries so I can understand my race activity and next actions. Apply annotated changes at the owning component. Reuse existing semantic tokens, official primitives, profile lookup pattern, owner-filtered registrations, and screening status rules.

The annotations settle execution scope. The owner selected a flat forest rounded rectangle after comparing the corrected proposals. Keep plain inactive links and larger 28px icons. Completed-event data is the existing documented completion authority. Longest completed category distance is the additional supported statistic.

## Context references

- `apps/web/components/Sidebar.tsx`: active menu styling, icon and count badge.
- `apps/web/app/(admin)/registrations/reservation-section.tsx`: early reservation roster and query.
- `apps/web/lib/queries/reservation-payments.ts`: bounded batch profile reads.
- `apps/web/app/(admin)/commission/page.tsx`: card spacing.
- `apps/site/components/SiteNav.tsx`: authenticated header and logout.
- `apps/site/components/event/CategoryAdmission.tsx`: reservation links and disabled states.
- `apps/site/app/events/FieldnotesEventCard.tsx`: status dot.
- `apps/site/components/EventCard.tsx`, `apps/site/app/home/page.tsx`: borders and wrappers.
- `apps/site/components/organizers/TrailAtlas.tsx`, `OrganizerMedia.tsx`: logo versus photography.
- `apps/site/app/profile/ProfileForm.tsx`, `PassportEditor.tsx`: cover and sidebar composition.
- `apps/site/lib/registration.ts`, `prescreening-status.ts`: owner registrations and screening payment windows.

## Tasks in dependency order

### 1. CREATE navigation proposals in the Storybook Hub

- **IMPLEMENT:** Compare forest rounded rectangle, pill, and icon circle. Show desktop, public phone, signed-in phone, keyboard focus, and dark mode.
- **GOTCHA:** Keep labels and 44px targets; selection remains local. Preserve all existing Hub edits.
- **VALIDATE:** Hub `pnpm typecheck`, `pnpm build:all`; Browser inspection before app adoption.
- **SATISFIES:** 9.

### 2. UPDATE admin identities, paid date, and spacing

- **IMPLEMENT:** Add user ID and actual paid timestamp. Batch-load profile names/photos within existing RLS. Reuse RunnerAvatar; retain meaningful snapshot/email fallback and managed participant lines. Add date column; preserve amount. Use primary active sidebar classes and matching icons/counts. Add missing commission margin.
- **GOTCHA:** Managed-only groups still identify the booker. Do not borrow the booker's name/photo for another participant. Never substitute creation date for payment.
- **VALIDATE:** Focused reservation roster, Sidebar, registrations page, and commission tests; web typecheck.
- **SATISFIES:** 1–4.

### 3. UPDATE runner visual and authentication controls

- **IMPLEMENT:** Remove Coming Soon badge dot. Primary reservation actions. Mobile Log out. Primary home-card borders with stretched Reveal wrappers. Organization avatar in directory.
- **GOTCHA:** Preserve sign-out hard navigation and disabled sale/full states. Apply the selected flat forest rounded rectangle. Preserve route labels and show 28px phone icons. Match the header and bottom bar at the 768px breakpoint.
- **VALIDATE:** Home navigation, card, organizer, category admission, and Coming Soon tests; site typecheck.
- **SATISFIES:** 5–8, 10–11.

### 4. UPDATE profile sidebar and truthful activity data

- **IMPLEMENT:** Add optional sidebarContent slot after Race Passports. Remove cover stats. Reuse one registrations query for completed totals and registered events. Read bounded owner screening batches with presentation-only fields. Render rejection/payment/review/expiry updates and links.
- **GOTCHA:** Show data errors/loading instead of zero totals. Preserve account owner isolation, exclude expired pending entries, keep mixed-group rejections after payment, and delegate all payments to existing request flow.
- **VALIDATE:** Profile activity, query scoping, passport editor/photos, and existing screening tests; site typecheck.
- **SATISFIES:** 12–15.

### 5. VALIDATE, REVIEW, and document

- **IMPLEMENT:** Run both app suites, shared UI tests/types and source audit. Build isolated apps against a local backend. Run backend/shared regression suite if the local stack is available. Inspect local app desktop/tablet/phone and Storybook proposals. Write PIV implementation/review reports and update docs ledger.
- **VALIDATE:** `pnpm --filter site test`, `pnpm --filter web test`, both typechecks, `pnpm --filter @race-pace/ui test`, UI typecheck, `node scripts/audit-fieldnotes-components.mjs --verify`, isolated builds, `git diff --check`. Follow `.github/workflows/ci.yml` for backend prerequisites.
- **GOTCHA:** Do not use the dirty shared checkout, replace its running stack, or create production records. Hosted acceptance and publishing remain separate.

## Meaningful regression cases

Real profile identity and avatar; missing identity; managed-only group; actual paid date; unpaid/missing timestamp; failed scoped profile read. Completed paid category totals; upcoming/refunded/pending exclusion; missing distance; owner registration scoping. Rejection in a completed group; pending review; exact expired payment deadline; loading/error/empty activity. Mobile logout remains visible and calls the existing auth action.

## Owner follow-up: centered registration inspector

The September 30 screenshot adds a registration dialog redesign to this same annotated UI task. The application code on current staging still matches this task's base; intervening remote changes are release documentation only. Preserve the existing uncommitted implementation.

Verified causes: `RegistrationDetail` overrides the centered primitive's top with `6vh` while retaining its negative half-height translation. The shared unlayered overlay safety rule overrides the Tailwind maximum width. Only the Runner cell currently owns an open callback.

1. **CREATE** a viewable Fieldnotes inspector candidate in the Hub. Use the installed official shadcn Dialog, fixed identity header, bounded centered width, scrollable grouped details, and a fixed footer. Preserve all values and financial rules. **VALIDATE:** Hub types/build and responsive Browser inspection before application integration.
2. **UPDATE** DataTable with optional row activation and one native keyboard trigger in the first visible data cell. Connect Registrations to its existing URL-driven callback. Exempt selection, interactive controls, modifiers and text selection. **VALIDATE:** DataTable and registrations-table tests.
3. **UPDATE** RegistrationDetail from the inspected candidate. Use a component-specific size rule that wins over the shared cap. Keep real history, framed photos, copying, complimentary cancellation and refund review. **VALIDATE:** RegistrationDetail tests and admin typecheck.
4. **VALIDATE/REVIEW** the integrated inspector at desktop/tablet/phone and short viewports. Confirm centered bounds, reachable last fields, fixed visible controls, row/keyboard open, Escape, focus return and nested refund review. Run the admin suite, shared UI checks/audit and admin production build. Update reports and ledger.

No GitHub issue was provided. Root-cause investigation stays in this local plan; no external issue comment is posted. No backend source or data contract change is required.

## Completion checklist

- [x] Navigation proposals built and inspected.
- [x] All specified application changes implemented.
- [x] Meaningful regression checks pass.
- [x] Application and catalog responsive inspection complete.
- [x] PIV review and implementation report saved.
- [x] Local results and selected navigation treatment documented.
- [x] Centered registration inspector integrated and checked at desktop, tablet, narrow phone and short viewport sizes.
- [x] Data-cell opening, checkbox selection, native keyboard opening, Escape, focus return and nested refund review verified.

Evidence: [implementation report](../../.claude/reports/2026-09-30-browser-ui-refinements-report.md) and [review](../../.claude/code-reviews/2026-09-30-browser-ui-refinements.md).
