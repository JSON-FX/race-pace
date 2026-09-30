# Reservations page integration report

September 30, 2026. Local application integration in `codex/reservations-page` at `/Users/jsonse/.codex/worktrees/reservations-page/race-pace`.

The approved Fieldnotes Reservations prototype is implemented in the existing organization admin application. The admin production build passed. Fresh review resolved the identified dark-contrast correction and returned a scoped ship verdict. Final standalone typecheck passed. Release verification remains pending. This report establishes implementation scope and available local evidence; it does not claim hosted availability.

## Authority and delivered behavior

The application [specification](../../docs/specs/2026-09-30-reservations-page.md) and [plan](../../docs/plans/2026-09-30-reservations-page.md) define scope. Visual authority is the approved Storybook Hub `projects/race-pace/src/proposals/reservations/` surface, including its `BRIEF.md` and `REVIEW.md`. This is an extension of incumbent Fieldnotes. The prototype's final independent verdict covered the two identified visual corrections; it was not blanket application approval.

The new `/reservations` route provides four event-wide summary cards: total checkout reservations, paid checkout count, collected amount including fees, and pending payment count. Its roster preserves eight fields: avatar, runner name, runner email, category, payment status, payment date, entry payment due, and reservation amount.

One checkout occupies one row. Managed runners appear beneath the booking account. Group participants do not multiply collected amounts. Paid ledger entries remain counted when a reservation or participant converts to registration. Historical expired/cancelled holds do not count as awaiting payment.

Reservations follows Registrations in the shared organization navigation. Shared navigation supplies the command palette and mobile More entry. The embedded reservation roster is removed from Registrations while pre-screening approvals remain. Existing event reservation routes redirect to the selected event in the new workspace. Event and reservation-payment links use the new route.

## Data and organization boundaries

The server route requires the existing `manage_org` capability and active organization. Event choices are queried using that organization. A selected event must belong to those choices before the roster query runs, including for super admins. A stale event retained during organization switching redirects to `/reservations`. The organization/event component key remounts filters and pagination.

Reads use the existing authenticated Supabase client and database row-level security. Event headers are filtered by both organization and event. The integration adds no database migration, Edge Function, privileged endpoint, provider configuration, or payment action.

Complete metadata is fetched in bounded pages: 1,000 events per request and 100 reservation headers per request, with stable secondary ID ordering. Deduplicated profile IDs are fetched in batches of 100. Query errors propagate rather than quietly presenting partial identities or totals. Bounded requests do not cap the final event roster; all pages are collected before summaries and local filtering.

Payments supply integer centavo amounts and actual payment timestamps, with existing reservation timestamp fallback. The amount is displayed only when the payment ledger says paid. Missing ledger data, ended payment windows, review-required payments, and missing category data have explicit fallback states. Philippine time formatting replaces the prototype's fixed example times.

Entry deadlines use the later participant/category deadline and fall back to the reservation deadline when neither is available. This preserves category deadline extensions. Different category deadlines remain separately labeled. Profile avatars use the application's existing `PhotoAvatar`; missing avatars use initials. Account names fall back to participant identity and then email, excluding generic Passport labels.

## Intentional prototype adaptations

| Prototype | Application adaptation and reason |
| --- | --- |
| Standalone preview sidebar and top bar | Existing authenticated admin shell owns navigation, organization switching, and the title. |
| `@race-pace/ui` imports | Existing `@/components/ui` primitives preserve the consuming application's source ownership. |
| Storybook Select event picker | Existing searchable `EventCombobox` handles real organization event lists. |
| Six rows per preview page | Application pages show 25 checkout rows. Event summaries remain independent of pagination. |
| Local event and fixture state | URL event selection triggers authenticated server reads; organization membership is checked before roster access. |
| Literal prototype colors | App RGB-channel semantic tokens cover surfaces, type, borders, focus, avatars, and payment status, including dark mode. |
| Synthetic paid times and deadlines | Existing ledger timestamps and participant/category deadlines replace fixtures. |
| Preview loading/error buttons | Route loading skeletons and the existing Alert/Button primitives provide actual loading and retry presentation. |

The compact desktop table retains a 990px minimum width. Intermediate widths scroll within the table region. At 760px and below, all fields become labeled mobile records. Four summary cards become two columns at intermediate and phone widths. Phone paid totals use 22px type and do not wrap. Interface typography, flat surfaces, rounded controls, tabular money, and 44px control targets preserve the approved composition.

## Local verification and limits

| Check | Recorded evidence and limitation |
| --- | --- |
| Admin typecheck | Final standalone typecheck passed after the error-primitive substitution. |
| Local application browser | Coordinator reports a local fixture with one paid checkout and ₱211.28 collected, rendered at desktop 1440px and phone 390px widths. No whole-page overflow was observed. |
| Search and summaries | A no-match search changes the roster to its empty result while all event summary cards retain their values. This local browser result does not establish every possible filter/data combination. |
| Dark appearance | Literal presentation colors were replaced with existing semantic tokens. Fresh reviewer scored the one identified dark-contrast correction resolved and returned ship. This was a correction review, not unrestricted whole-surface approval. |
| Source audit | Coordinator reports 324 current modules; 256 audited; zero remaining native/dedicated sites; zero duplicated primitives. The audit was not rerun for this documentation task. |
| Tests | The owner explicitly waived additional test runs. Existing assertions were adapted for the removed embedded roster; their execution is not claimed. |
| Admin production build | Coordinator reports exit 0. This confirms the local application build, not a hosted deployment. |
| Release | Required branch checks, staging acceptance, deployment identities, and hosted readback remain pending. |

Local evidence paths are `.impeccable/review/reservations/desktop.png`, `mobile.png`, `mobile-roster.png`, `dark-desktop.png`, and `dark-mobile.png`. These captures belong to the private local review record. Do not stage or commit the images. Their presence does not prove production data access or a hosted deployment.

Tablet browser acceptance, full keyboard traversal, complete accessibility review, large-roster behavior under live concurrent changes, and every payment-status combination are not independently verified by this report. The page uses complete paged reads, but those reads are not an atomic database snapshot.

Specialized Impeccable reviewer/documenter roles were unavailable in the prototype workflow. Fresh default agents substituted. This application report follows the documentation guidance without silently rewriting global design authority or claiming specialized-role execution.

## Source provenance

SHA-256 values below record the files inspected for this report. Later edits require a fresh source check before claiming this exact revision was validated.

| Source | SHA-256 |
| --- | --- |
| Prototype `ReservationsPage.tsx` | `0c8009441dc16e7766b5144917b7ccb29474bbac962d75e62d40ce629a4dd6cb` |
| Prototype `reservations.css` | `09b4202d53e1f0d27c430fc1bf63d1618d446e3e397e6ced225dd76a9054c5d3` |
| Application `reservations-workspace.tsx` | `2736522721453da890ecaf55a389a39d2ad1dc79cbaa5f5dd458ac6f1dd3f96d` |
| Application `reservations.css` | `57f08e21f26ac1896b73fcf8b59cee597ac536e2fabab54a8dfeb6e503c445bd` |
| Application `lib/queries/reservations.ts` | `e565119f5e5612d080c67399d5afe42d4d88334f821050b65672014361748d18` |

**Disposition:** implementation recorded; local build passed; identified dark-contrast correction resolved with a scoped ship verdict. Final standalone typecheck passed; release evidence remains pending. Preserve the separate staging-first release workflow. No production payment, synthetic production record, or hosted-live claim is authorized by this report.
