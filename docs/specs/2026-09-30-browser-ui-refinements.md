# Browser UI refinements

The September 30 browser annotations request specific Fieldnotes refinements on the runner and admin websites. Preserve the current layouts, forest green palette, Apple system typography, authentication, and reservation/payment boundaries.

## Acceptance contract

| Comment | Result |
| --- | --- |
| 1 | Admin active sidebar uses the organization switch's primary background and matching foreground. |
| 2 | Early reservations show the booker's real profile name with avatar on the left. Managed Passport participants remain listed separately. |
| 3 | Separate reservation paid date column uses the actual `paid_at` timestamp in Philippine time. Missing and unpaid dates show a dash. |
| 4 | Commission cards share the existing vertical spacing rhythm. |
| 5 | Coming Soon discovery badge has no dot. |
| 6–7 | Available reservation actions use the forest primary button. Closed/full states stay disabled. |
| 8 | Signed-in mobile header exposes Log out. |
| 9 | Owner-selected flat forest rounded rectangle with white active text and plain inactive links. No pale track, bevel, or shadow. Phone icons are 28px, with labels retained. Viewable alternatives remain in Storybook. |
| 10 | Home cards use primary borders and equal-height grid wrappers. |
| 11 | Organizer directory uses the organization's logo avatar with initials fallback. Event and featured photography remain in their own contexts. |
| 12–14 | Profile counts only own paid entries in completed events. Show completed races, distance, and longest distance below Race Passports. |
| 15 | Profile sidebar shows registered events and pre-screening updates with useful next links and honest loading/error/empty states. |
| Dialog follow-up | Registration details open from every data cell in the selected row. A centered, bounded Fieldnotes dialog keeps identity and actions visible while all submitted fields remain reachable through its own scroll region. Selection and sorting keep their own behavior. |

## Product truth

There is no individual finisher result, finish time, or verified geographic achievement in the current schema. Label career figures as completed races and explain they use paid entries in completed events. Use the entered category's distance. Do not claim a verified finish or substitute the event's longest distance. The account owner's registration query excludes managed Passports from personal totals.

Screening cards read the booking user's batches and presentation-only application fields. They link to the existing request page. They do not create inbox notifications or enable payment directly. Rejected participants remain visible even when the remaining group has completed payment. Never select proof paths, emergency contacts, or participant email for these summaries.

## Source and delivery

Start from `origin/staging` at `f7ded2161e87a9e662ff7b65d30e770688b5e5a5` in the isolated `codex/browser-ui-refinements` worktree. Navigation proposals live in the Storybook Hub under `Fieldnotes/Proposals/Browser refinements`. Existing official shadcn Button and Avatar sources are reused after MCP inspection. No migration, provider change, hosted data write, or publication is required for this local implementation.

References: [Fieldnotes contract](2026-09-27-fieldnotes-components.md), Storybook Hub `projects/race-pace/DESIGN.md`, [official Avatar anatomy](https://ui.shadcn.com/docs/components/radix/avatar), [Supabase nested selects](https://supabase.com/docs/reference/javascript/select). The local Design UI, Impeccable polish, and Emil interaction guidance inform contrast, spacing, touch targets, and reduced motion.
