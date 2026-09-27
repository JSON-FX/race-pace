# Fieldnotes component verification

Date: 2026-09-27. Implemented locally on `codex/fieldnotes-component-revamp`, based on staging `1188768f33ea4999407774c15fc3146d8e72cc25`. The original checkout and its unrelated changes remain separate. No commit, push, hosted deployment, production write or real provider transaction was performed.

## Delivered

- Immutable baseline audit: 256 React modules, 50 page entrypoints and 1,443 recognized UI expressions. Reconciliation covers 295 current application modules and all 63 Fieldnotes catalog entries.
- One shared package contains 39 canonical primitives and their mobile hook. Application import paths are thin reexports. Hub original hashes, adapted source hashes and compatibility changes are recorded in `packages/ui/SOURCE_SYNC.json`.
- Component-scoped RGB tokens, Apple interface typography, explicit compact sizes, ordinary 44px targets, bounded portals and reduced-motion rules.
- Shared and dedicated controls migrated while retaining domain controllers, native form values, real links, URL state, section structure, page canvases, chart/map engines and ticket artwork.
- Modal focus, selection keyboard behavior, active combobox options, field associations and keyboard upload triggers repaired.

## Automated gates

| Check | Result | Evidence |
|---|---|---|
| Audit and adapted source hashes | Pass; zero unresolved recognized controls or duplicate primitives | `node scripts/audit-fieldnotes-components.mjs --verify --reconcile` |
| Shared UI typecheck and behavior suite | Pass; 8 tests | `fieldnotes-shared-types-final6.log`, `fieldnotes-shared-final5.log` |
| Runner typecheck and suite | Pass; 65 files / 483 tests | `fieldnotes-site-types-final4.log`, `fieldnotes-site-tests-final4.log` |
| Admin typecheck and suite | Pass; 121 files / 937 tests | `fieldnotes-web-types-final4.log`, `fieldnotes-web-tests-final4.log` |
| Backend, RLS and shared contracts | Pass; 97 files / 769 tests | `fieldnotes-root-tests2.log` |
| Local migration replay and retired jobs/secrets | Pass; 157 migrations, retired records absent | Isolated project assertion; no hosted backend changes |
| Admin repository E2E | 9 cases pass across the full run and targeted correction rerun | `fieldnotes-e2e-final.log` (8 pass), `fieldnotes-e2e-nonadmin.log` (remaining case passes) |
| Follow-up participant/roster checks | Pass; 19 tests | `fieldnotes-site-focused-final.log` |
| Runner and Admin isolated production builds | Pass | `fieldnotes-site-build-final3.log`, `fieldnotes-web-build-final3.log` |
| Whitespace check | Pass | `git diff --check` |

Logs and screenshots are retained in the ignored `.local/fieldnotes-review/` directory of this worktree. Gate logs are copied into its `validation/` directory. This report and the compact verification JSON are versioned evidence summaries. Application builds ran outside the original Docker bind mount.

## Application browser evidence

The responsive matrix covers 18 consuming routes at 320px, 768px and 1440px, each in light and dark mode with reduced motion: 108 states, zero document-width overflow and zero uncaught page errors. Intentional table scroll regions and clipped decorative artwork are not document overflow. Screenshots and per-route observations are in `responsive-results.json` and the matching PNG files.

Runner coverage: event directory, organizer directory, profile, races, bookings, Coming Soon detail, ticket, payment and registration wizard. Admin coverage: events, registrations, payments, race kits, check-in, team, settings, users and event editor.

Thirty additional interaction cases cover all three widths. Runner checks exercise radio arrows, waiver dialog focus/dismissal, shirt sheet return focus, print-mode navigation removal and QR rendering, photo crop slider keyboard control, and gallery navigation/dismissal. Admin checks exercise keyboard file selection/crop bounds, course editor focus and viewport fit, user inspector dismissal, combobox active-option IDs and row selection. The browser checks stop before provider charges, refunds and destructive confirmations.

After the primary Browser/Computer tool-order instruction, additional checks used Browser through `cua_repl`: pointer opening of the gallery, Escape and focus restoration, 320px payment choices and document fit, local Admin sign-in, opening/dismissing an event cancellation confirmation, and the final participant chooser at 320px. The cancellation returned focus to its row menu button. Earlier responsive/interaction evidence used Playwright before that instruction. The repository Playwright suite was retained as the explicitly required validation command.

Local authentication uses Cloudflare's [documented dummy Turnstile key](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) with isolated Supabase Auth. It does not validate hosted CAPTCHA configuration. The key exists only in ignored local environment files. The non-admin E2E assertion was stale: the existing page heading is “This account isn't registered.” The assertion now matches that preserved behavior. Password and Google sign-in buttons now have unambiguous exact selectors.

## Findings fixed during verification

| Finding | Fix and evidence |
|---|---|
| Dialog opened from a menu returned focus to an unmounted menu item | Resolve the persistent menu trigger from Radix's accessible relationship; new regression test and consuming Admin Browser check pass |
| Hidden scanner input and sidebar minimum width expanded the document | Preserve visually-hidden input geometry and allow SidebarInset to shrink; responsive matrix fits |
| Bottom navigation active appearance was lost during migration | Use explicit active Button variants while retaining `aria-current` |
| Gallery Button default height collapsed its aspect ratio | Keep automatic gallery image height; pointer open and Escape checks pass |
| Programmatic course editor replaced its opener DOM | Restore the recreated Draw trigger through the parent ref |
| Slider root label did not name the thumb | Forward accessible labels to thumbs; keyboard crop check passes |
| Theme icon disagreed between server and client | Use stable server/client mount snapshots; no hydration page errors in the matrix |
| Outline button inherited light section text onto its own light background | Declare its semantic foreground; retain intentional status overrides |
| Slotted links in mapped lists kept keys on their inner child | Move keys to the outer Button composition |
| Reservation urgency and zero commission lost meaningful emphasis | Restore semantic warning/danger states without changing their calculations |

## Limits and release handoff

The source scanner recognizes JSX primitives and known dedicated adapters. Manual review supplements it for decorated spans, section boundaries and artwork. Neither source coverage nor the 18-route matrix proves every possible data-dependent state across all 50 entrypoints. Existing flow tests cover authorization, tenant boundaries, financial calculations, registration, reservations, refunds, check-in and upload behavior.

No real payment, refund, delivery or hosted storage write was used as a test. Provider integration and hosted environment verification remain part of the staging-first release when requested. The original page layouts and domain behavior were the preservation contract; this was not a redesign of the application sections.

## Second browser review preparation

All 23 annotations are corrected. Current evidence, local fixture replacement and preview repairs are recorded in [the annotation verification report](fieldnotes-annotations-verification.md). Current shared tests pass 13 cases, Runner 483 and Admin 939. Both typechecks and isolated builds pass. The annotation report distinguishes the latest checks from the initial full responsive matrix above.
