# Fieldnotes annotation verification

Date: 2026-09-27. Branch: `codex/fieldnotes-component-revamp`. All 23 browser annotations have code corrections. Implementation remains local and uncommitted.

## Corrections and application evidence

| Comments | Correction | Verification |
|---|---|---|
| 1–2 | Fieldnotes Avatar, circular 44px chooser avatars, 70px rows with left-aligned spacing | Consuming profile in Browser; accessible edit controls retained |
| 3 | Fieldnotes Calendar/Popover DatePicker, styled month/year menus, civil dates | Phone calendar 278px wide; Escape returns focus; shared behavior tests; usable native date input before hydration |
| 4 | Shared FormSelect enhances dedicated native selects using the Fieldnotes Select menu | Native HTML, controlled values, empty choice, required validation, disabled state, reset and explicit/implicit labels tested; profile menu fits phone |
| 5 | Identity avatar 96px on phone, 112px on desktop | Browser measurements at 320px, 768px and 1440px |
| 6 | Forest border on bookings empty state | Source and consuming empty state; phone document fits |
| 7–8 | Rail cards stretch equally, with aligned distance rows | Before cleanup: 13 cards measured 354px, adjacent distance rows aligned |
| 9–10 | Event availability badges omit dots | Home Browser review and source |
| 11 | Footer uses readable interface sans typography | Browser review |
| 12 | Reservation links use Card with left-aligned content; phone status has its own row | Source and existing flow tests; the populated state is absent after the requested event cleanup |
| 13–14 | Journey numbers 24px, course numbers 20px | Source and consuming landing review |
| 15 | Compact aligned payment choices with consistent logo boxes | Coming Soon page: phone choices 64px high and 280px wide, no document overflow |
| 16 | Reserve/notify anchors compose the actual Fieldnotes Button | Browser: visible filled CTA; real fragment links retained |
| 17 | Workspace choices use full-width RadioGroup rows, aligned swatches and radio controls | Browser: 56px rows at 320px; all three review widths fit |
| 18–19 | Payment logos have consistent bounded boxes and screen-reader labels; paid date is a separate column | Populated local payment table reviewed before cleanup; correct amounts retained |
| 20 | Registered-user and unique managed-Passport count cards use existing authorized query data | Browser: 622 registered users, one managed Passport; deduplication test passes |
| 21 | Commission choices use plain labeled radios | Browser: normal radio controls, 44px targets; no commission saved |
| 22 | Provider verification notice uses a calm Fieldnotes Alert with a concise title | Browser and existing queue tests; escalation meaning retained |
| 23 | Organization picker uses searchable Command/Popover | Browser filter returns TrailNorth and selection updates active organization; tests retain authorization behavior |

Additional verification repairs: the shared select's visible control precedes its hidden native input so wrapped labels name the correct control. Long published-waiver titles now stay inside their disclosure. The Admin bottom navigation explicitly sizes compact controls to equal cells. At 320px its five cells are approximately 62.4px and the document is 320px wide.

## Automated gates

| Gate | Result | Log in ignored `.local/fieldnotes-review/validation/annotations/` |
|---|---|---|
| Shared types and tests | Pass: 13 tests in two files | `ui-types-final.log`, `ui-final.log` |
| Runner types and full suite | Pass: 483 tests in 65 files | `site-types-final.log`, `site-tests-bounded.log` |
| Admin types and full suite | Pass: 939 tests in 121 files | `web-types-final2.log`, `web-tests-bounded.log` |
| Final adapter consumer checks | Pass: Runner 10, Admin 23 tests | `site-final-focused.log`, `web-final-focused.log` |
| Final phone-fit changes | Pass: 12 existing navigation/waiver tests | `web-fit-final.log` |
| Isolated Runner and Admin builds | Pass | `site-build-final.log`, `web-build-final.log` |
| Repository Admin E2E | Eight cases pass across full run and one targeted rerun; one case skipped for missing non-admin credentials | `e2e-final.log`, `e2e-auth-retry.log` |
| Source hashes and audit reconciliation | Pass: 295 current / 256 baseline modules, all 63 catalog dispositions, zero unresolved recognized controls or duplicate primitives | `audit-final.log` |
| Technical review, design detector, whitespace | Pass; detector reports no findings | Review artifact; `design-detector.json`; `git diff --check` |

The initial E2E sign-in assertion reached its five-second deadline while the action still showed signing in. Its retry hit a development-server navigation timeout. The unchanged case passes on a targeted rerun. The other seven configured cases passed in the full run. The non-admin case was not newly provisioned for this round.

The full application suites preceded the last styling-only phone-fit changes. Existing waiver/navigation tests, Admin types and the isolated Admin build passed afterward. Backend/shared contracts passed earlier in this same implementation session (97 files, 769 tests); no tracked backend source changed in this annotation round.

## Consuming-page review

Browser through `cua_repl` was used for this annotation round. Profile and Admin settings were checked at 320px, 768px and 1440px. Calendar and styled shirt menus fit a 320px viewport. The dark Admin select uses background `rgb(27, 44, 34)` and foreground `rgb(238, 243, 232)`; Escape dismisses it and restores focus to the Region combobox. The initial revamp's wider responsive, reduced-motion, printing and interaction evidence remains in [the original report](fieldnotes-components-verification.md). This round does not claim that entire matrix was rerun.

## Local fixtures and preview repair

The user explicitly authorized removing every old local event and creating one complete open event plus one Coming Soon event with generated featured imagery. The target was verified as `supabase_db_race-pace`, API 54521/database 54522. A permission-restricted complete PostgreSQL backup was taken and its inventory checked. The replacement transaction passed a rollback rehearsal before committing.

All 202 old events and their event-related records were removed. There are exactly two events: Kitanglad Skyline Ultra (`open`) and Kalatungan Forest Traverse (`coming_soon`). Both belong to TrailNorth and contain descriptions, generated featured photos, gallery entries, inclusions, schedules, illustrative routes, categories, waivers, add-ons, deadlines and custom fields. The coming-soon event supports notices and reservations. Both pages and generated images render locally.

Accounts, organizations and Passports were preserved: 624 Auth users and 4,777 Passports. The Admin registered-user query returns 622 profile-backed accounts. Registrations and reservations are zero after cleanup. No payment, email or push was created. Existing unused Storage objects and organization waiver history were preserved.

The app preview environments now have stable ignored mounts. The former local Edge Function mount pointed to a deleted checkout and returned HTTP 503 on Users. It was replaced by an ignored snapshot of current `origin/staging` functions/config at `0b6622a63e9c89cbff121733635cd60d5cc99fee`, served by the installed Supabase CLI. Existing local provider settings and in-function authorization are retained. No hosted service, production record or provider mode changed.

Recovery, complete cleanup evidence, image paths and prompt summaries are in the original checkout's `.local/event-review-20260927/README.md`. Preview setup is in `.local/fieldnotes-preview/README.md`. The old rollback file references a deleted checkout and needs its source restored or updated before use.

## Limits

Event cleanup intentionally removed populated reservation/payment states. Those annotated components were reviewed with local rows before cleanup, and existing domain tests pass. The final phone reservation Card arrangement has source/build verification; it has no populated post-cleanup browser state. Hosted/provider verification remains a separate staging-first release task when requested.

## Second browser review and CTA color correction

All nine second-round annotations and the later three CTA corrections are implemented locally. This section supersedes the reservation and console limitations above where a populated state is now available. The existing Pending reservation was preserved.

| Annotation | Final result | Evidence |
|---|---|---|
| 1: Notify background | Filled forest-green Fieldnotes Button, white label, 48px height | Browser computed background `rgb(23, 99, 65)`; phone and desktop review |
| 2: Closing reservation CTA | 240px desktop width, 64px height, 18px label and centered arrow; aligned with section heading | Browser and source; latest requested forest green applied |
| 3: Hero CTA | Forest-green action, 240px desktop width and 60px height; full available width on phone | Browser measurements; genuine reservation fragment retained |
| 4: Description size | 20px desktop, 17px phone; line height 1.65 | Browser computed typography |
| 5: Reservation spacing | Layout and padding merged on the Card root; 48px ticket icon, separate calendar/deadline line and status | Existing populated Pending row: 112px desktop height, 20px padding; 280px wide and 192px high at 320px |
| 6: Profile sign out | Extra lower button removed | Browser: zero `Sign out` buttons; one header `Log out` remains |
| 7: Commission fee type | Existing Fieldnotes Select with `Percent (%)` and `Fixed (₱)` | Browser keyboard selection changes an unsaved draft; named hidden form fields covered by regression |
| 8–9: Duplicate keys | Warning entries carry organization IDs; identical names retain every warning | Repeated-name regressions for zero commission, excessive flat commission and zero retention |
| Additional console finding | Users dates use existing `fmtDate` with Asia/Manila; birthdays are formatted from their date-only value | Regression runs in America/New_York; fresh Users load has no hydration warning |

### Current validation

Logs are retained in ignored `.local/fieldnotes-review/validation/round2/`.

- Runner: all 483 tests in 65 files and typecheck pass. Five existing Coming Soon tests pass again after the final CTA color/proportion change.
- Admin: all 943 tests in 121 files and final typecheck pass. Thirteen Commission cases include three new regressions; Users adds one timezone/birthday regression.
- Both production builds pass in an isolated filesystem copy. No build writes to the live container's Next cache.
- Repository E2E: all eight configured cases pass across the full run and focused table rerun. One non-admin case is skipped for missing credentials. The first full run found zero Events in the default organization; its two data-dependent table assertions failed. All four table cases pass with existing `E2E_ORG_NAME=TrailNorth`. No extra event or registration was created.
- Source audit: 295 current modules, 256 audited baseline modules, zero remaining recognized native/dedicated controls and zero duplicated primitives. Canonical shared primitives were preserved.
- Focused static design detector reports no findings. Whitespace and technical review pass.

Browser reviewed the populated reservation on desktop and at 320px. Both fit without document overflow. CTA review confirms all three final forest-green backgrounds and white labels at 320px and desktop. The tablet override produced an inconsistent browser capture, so no exact 768px screenshot claim is made. Temporary viewport overrides were reset.

Fresh console capture after the date repair contains no errors or warnings on Users and Coming Soon. Commission fresh-load capture also contains no duplicate-key errors. Historical errors remain in tool log history; comparisons use a timestamp after each repaired load. This does not claim a scan of every application route.

Only the existing `race-pace` app containers were used for the live checks. Both `/repo` mounts point to `/Users/jsonse/.codex/worktrees/fieldnotes-components/race-pace`. Other validation stacks are stopped. No container stack, hosted service, provider transaction, database write, notification, commit or deployment was created for this round.

## Open-event facts, pricing and participant-row review

The two course/price annotations and subsequent participant-layout annotation are complete. The final user instruction specifies forest green and white text for both facts and prices. Nine course facts use the canonical default Badge. Assisted prices use a 17px interface font, generous padding and the exact existing formatted amounts. Canonical shared component source is unchanged.

The original two-column arrangement left an empty cell for the third category at intermediate widths. The final arrangement uses one full-width row per category, with the name on the left and aligned price/arrow on the right. Whole-row registration links and their accessible names are preserved. Rows measure 88px high on the consuming page. Price backgrounds are `rgb(23, 99, 65)` and labels are white. Browser review confirms all three categories and the existing registration targets.

The ParallaxLayer animated wrapper now has `position: relative`, satisfying its fill Image child's containing-block requirement. Its reduced-motion branch is unchanged. A fresh load after that repair had no image-position warning. Later viewport/navigation review recorded a development-only footer LCP hint and Next sticky-header auto-scroll notice, with no console errors. No claim is made that every route was scanned.

### Checks and scope

- Final course/price change: all 483 Runner tests in 65 files, Runner typecheck, isolated production build, source audit and whitespace checks pass. Logs are in ignored `.local/fieldnotes-review/validation/round3/`. The source audit reports 295 current modules, 256 baseline modules and zero unresolved controls or duplicate primitives.
- Subsequent participant-row styling: 37 existing event-page tests, Runner typecheck, focused design detector and whitespace check pass. The earlier full suite/build was not repeated for this CSS-only composition change.
- Desktop consuming-page screenshot shows three aligned full-width rows. Narrow phone DOM review measured a 425px document with no horizontal overflow. The requested 320px Browser override produced inconsistent dimensions and a distorted capture; no exact 320px screenshot claim is made for the final row layout. Temporary overrides were reset. Earlier course-badge review did verify 320px fit.
- Only `race-pace-site-1` and `race-pace-web-1` were used for live review. Both retain the active worktree mount. No additional container, registration, reservation, payment, notification or hosted release was created.

### Host resource investigation

Read-only inspection found approximately 2.49 GiB in the Runner dev container and 3.53 GiB in Admin. Their Next processes accounted for most of that memory. Both use file polling and have no per-container memory limit. The old validation stacks were stopped. Supabase Analytics used approximately 0.59 GiB; other services were substantially smaller. This snapshot does not establish a memory leak.

A separate host Next server, PID 43861, had run for five days from the group-checkout worktree on localhost:3000. Three samples showed approximately 98–113% CPU. macOS had approximately 9 GB of swap in use. The user authorized stopping only that older server. Its identity and working directory were rechecked before signals. It did not exit on SIGTERM, so the same verified process was terminated with SIGKILL. Process and port checks confirm it stopped. The active Race Pace containers were not restarted. A later sample measured about 6.65 GiB combined app-container memory after page compilation; terminating a host process does not release Docker's separate memory.
