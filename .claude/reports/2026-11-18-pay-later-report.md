# Implementation report — Pay Later

Status: complete locally; application commit and hosted release are pending.
Branch: `codex/pay-later`. Base: `f537e30368c87e18b59f74326e3a5381921393ba`.
Plan: [Pay Later implementation](../../docs/plans/2026-11-18-pay-later.md).

## Delivered behavior

Organization administrators and super administrators can grant an existing runner event-specific Pay Later. Editors cannot grant or view the approval roster. Name searches stay within the organization; exact account email supports new runners. Administrators choose a deadline, defaulting to four weeks before event day. They do not select categories.

Runners choose their own available category through existing registration. Screening categories require an approved application for the same runner and category. Granting access holds no inventory. Confirming registration atomically reserves one slot, including conversion of an existing screening hold. Payment unlocks the ordinary ticket. Unpaid reservations become invalid at the frozen deadline; capacity release preserves the existing provider reconciliation safeguards.

Five HTML/plain-text messages use the durable email outbox: approval, reservation, seven-day reminder, one-day reminder, and invalidation. Delivery checks current recipient, event, organization, registration and payment state. Reminder retries cannot send stale date wording. Ordinary payments and the five specialized screening/reservation email jobs retain their existing worker ownership.

## Validation

| Check | Result |
| --- | --- |
| Backend/shared full suite | 122 files, 1,097 tests passed |
| Final email checks after review fixes | 35 tests passed; frozen Deno checks passed |
| Runner full suite | 82 files, 604 tests passed |
| Admin full suite | 136 files, 1,134 tests passed; final CSS-only fix also passed focused interaction tests |
| Runner/admin typechecks | Passed |
| Runner/admin production builds | Passed from a separate scratch copy; final application sources match that copy |
| Shared UI | Typecheck and 13 tests passed |
| Fieldnotes audit | 328 current modules, 256 audited; zero remaining native/dedicated sites or duplicate primitives |
| Migration replay | 185 local versions; equivalent CI migration/cron/retired-secret assertions passed on dedicated port 54722 |
| Edge dependencies | Frozen graph for all function entry points passed |
| Patch whitespace | `git diff --check` passed |
| Catalog | All five library builds and typecheck passed; published commit `88b9b0e6615dc90cca84300963d39785e685c3ca` |

The full backend run preceded the final three email suppression fixes. All 35 affected email tests and Deno checks passed afterward. Backend tables were not reset after authenticated browser fixtures were created.

## Authenticated browser evidence

Ego lite task space 11 used the real local apps at `https://admin.racepace.lan` and `https://racepace.lan`. Both Docker services mount this worktree. A dedicated Supabase project uses ports 54721/54722/54724 and synthetic accounts only.

- Admin selected Juan by exact email and confirmed eligibility. January 16 event day produced the default December 19 deadline, through 11:59 p.m. Philippine time.
- Juan chose 21 km, completed Passport/kit/waiver steps, and reserved without payment. The ticket showed amount and deadline with no check-in code.
- Local sandbox payment transitioned the registration to paid and issued a ticket. The browser rendered its QR and race-kit details. No real payment was made.
- Mara's pending screening showed no entry action. After approval, the browser completed 50 km registration with Pay Later. SQL readback showed the batch completed and exactly one capacity claim for that category.
- Luis's fixture simulated reminder days and expiry. Both reminders and the invalidation message reached Mailpit. The expired registration had no ticket token, no capacity claim, no Pay now action, and the browser displayed the missed-deadline reason.
- All five email types were delivered to intended synthetic recipients. Content readback verified event/category/amount, Philippine dates and registration/payment links. Only fixture-specific time and scheduling values were adjusted; the actual worker and expiry RPC handled delivery and invalidation.
- The admin roster reflected paid, reserved and expired states. An out-of-scope event URL exposed no roster. An authenticated editor was redirected to `/no-access`.
- Runner and admin pages were checked at desktop, 768 px and 390 px widths. Catalog keyboard testing opened the grant dialog with Enter, closed it with Escape, and restored focus with reduced-motion emulation enabled.

Local screenshots: `/tmp/pay-later-admin-dialog-final.png`, `/tmp/pay-later-admin-mobile-final.png`, `/tmp/pay-later-runner-reserved-live.png`, `/tmp/pay-later-runner-mobile-live.png`, `/tmp/pay-later-paid-live.png`, `/tmp/pay-later-expired-live.png`.

## Review corrections

Resolved stale approval after ordinary registration, approval after admission closure, and reminders during organization suspension. Runner cards no longer blame a future deadline when an event closes early. Removed unsupported unpaid cancellation and corrected screening text to distinguish admission from payment deadlines. Browser review fixed the oversized admin dialog and mobile wrapped-email overlap. Canonical Alert/Table components now pass the required source audit.

## Boundaries and release requirements

No hosted application, database, Auth, provider or payment configuration changed. The application is uncommitted. Catalog publication is separate from application deployment. Before release, apply migration `20261118090000_pay_later.sql` and deploy the changed checkout, payment and lifecycle worker functions together with both apps through the documented release workflow. Hosted staging must verify PayMongo test-mode capture/reconciliation, scheduler execution, recipient delivery and tenant isolation before production approval.

Current main's event admission deadline semantics supersede the prototype's historical 72-hour screening fixture. Local builds ran outside the live Docker bind mount to avoid corrupting `.next`. One local Docker dev restart interrupted the paid-ticket page; reloading after readiness rendered the paid ticket successfully. Unrelated historical test email jobs returned worker errors during local delivery runs; every Pay Later fixture job completed without an error.
