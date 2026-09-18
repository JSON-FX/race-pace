# Email design validation

Reference: `docs/previews/email-branding.html` (approved). Updated 2026-09-18.

| Variant | Implementation | Visual validation | Delivery |
|---|---|---|---|
| Confirmation | Staging applied; production draft | Proposal tokens corrected; hosted preview inspected, logo loaded | Pending real signup delivery |
| Password reset | Staging applied; production draft | Hosted preview inspected; neutral copy works for runner and admin | Delivered to Gmail Primary; runner link completed, admin link reached form |
| Staff invitation | Staging applied; production draft | Hosted preview and delivered Resend HTML show the logo, staging banner and approved shell | App-generated organizer invite Delivered; link redeemed to the invited admin's scoped Events page |
| Email change | Staging applied; production draft | Hosted preview inspected; logo loads | Pending real change request |
| Magic link | Staging applied; production draft | Hosted preview inspected; logo loads | Pending real passwordless request |
| Registration received | Proposed | Missing implementation | Pending |
| Payment receipt | Proposed | Missing implementation | Pending |
| Single ticket | Renderer aligned to proposal shell; explicit plain-text alternative deployed to staging | Delivered Resend desktop preview shows loaded logo, white card, staging banner, event facts, runner QR and ticket link; real mobile comparison pending | Automatic staging delivery passed for paid QA ticket; post-text-change delivery remains pending |
| Group tickets | Gated renderer aligned to proposal shell; explicit per-participant plain-text alternative deployed to staging | Source comparison and focused tests passed; real delivered-client comparison pending | Feature flags remain off; live delivery pending |
| Refund update | Proposed | Missing implementation | Pending |
| Event update | Proposed | Missing implementation | Pending |
| Event cancellation | Proposed | Missing implementation | Pending |

## Differences found and corrected

Auth drafts lacked the green tagline, explicit heading margins, outer card border, full staging banner and logo-wordmark spacing. Corrected all ten local Auth drafts and applied confirmation, recovery and invitation to staging. Authentication placeholders remain unchanged.

## Deliberate content differences and remaining checks

- Omit fictitious Alex and organizer names from Auth templates. Invitation uses generic organizer wording until verified metadata is available.
- Support footer uses the real support email. Privacy and Terms destinations need verification before adding working links; proposal placeholder text is not shipped.
- Magic-link footer uses recipient-facing safety copy instead of the proposal's implementation note.
- Logo uses staging public Storage to satisfy the Supabase dashboard image policy. Production must use its own asset, not staging storage.
- Desktop/mobile screenshots against equivalent proposal content, dark-mode and images-disabled inbox behavior remain pending. Do not claim full visual parity from HTML token checks.
- The previously missing staging deployments are now Ready. Runner recovery completed and admin recovery reached the password form; remaining redirects need their own live tests.

## 2026-09-18 automatic ticket delivery

Payment confirmation automatically sent the single-ticket email for the synthetic flat-fee QA event. Resend email `01a0b0b8-20aa-72a0-86a1-7aade931b93a` was marked Delivered. Its desktop preview visibly loaded the Race Pace logo, staging banner, event facts, participant QR and staging ticket link. The plain-text part generated from HTML concatenated `Event`, `Category`, `Date · venue` and `Total paid` without separators. This failed the plain-text comparison gate.

The single and group ticket renderers now produce explicit line-separated text, and both transports pass it to Resend as the documented `text` field. Focused renderer, transport and handler tests passed. Staging functions `send-ticket-email` v2 and `group-ticket-delivery` v1 are Active with the new code. A new delivered email has not yet exercised this revision. Group sending remains gated off, and real mobile-client appearance is still unverified.

The current single-ticket sender selects only payments in `paid` status. Its automatic send occurs on first payment confirmation, before any refund. A later manual resend for an active `partially_refunded` ticket would return `paid_payment_required`. Add refund-aware copy and a resend path before promising that workflow.

## 2026-09-17 staging comparison and admin recovery

All six staging Auth types now use the approved white table card, yellow TEST banner, Race Pace logo and wordmark, green tagline and action treatment, and support footer. The sixth type is reauthentication, which is not one of the proposal's twelve panels. Its one-time-code variant uses the same shell. Supabase previews confirmed email-change, magic-link and reauthentication structure; the image loaded after preview settlement. Confirmation, invitation and recovery had already been checked in hosted preview and Gmail desktop where delivered.

The preview's password-reset tagline mentioned Race Passport, which was wrong for admin recipients. Staging and production source drafts now say “Get back to Race Pace,” and the staging hosted preview shows that wording. The latest admin recovery email reached Gmail and its link opened the branded staging-admin password form. The user confirmed password update and sign-in, and the protected admin console loaded under the support super-admin account.

The proposed registration, payment receipt, refund, event update and cancellation variants have no live delivery triggers. The single and group ticket renderers now use the proposal's 600px bordered shell, heading/tagline hierarchy, event details, individual QR cards, green links and Race Pace footer. The group email keeps per-participant ticket links because its current contract has no group booking URL; this is a deliberate difference from the proposal's single “View all tickets” button. Neither renderer has been deployed to staging or inspected in a delivered email. Production Auth templates remain source drafts only.

Staging password-changed and email-address-changed security notices now use the same shell and are enabled. The email-address notice keeps Supabase's old/new email placeholders. Both hosted previews show the intended hierarchy and logo. A triggered password-changed notice was Delivered and its branded HTML inspected in Resend. Email-address-change delivery remains untested. Five other optional security-notification switches remain off; these flows are not currently exercised by the web/admin apps.

Real mobile Gmail is installed on the connected iPhone, but the support.racepace@gmail.com test inbox was not signed in there at last inspection. iPhone Mirroring capture failed on 2026-09-17, so mobile-client rendering remains unverified. A desktop responsive preview is not a substitute for this check.

## App-generated organizer invitation and security notice

2026-09-17: Created a staging-only QA organization through the admin UI after correcting the missing staging CORS origin. Resend marked the invitation to the organizer QA alias Delivered. Its HTML preview shows the approved white card, staging banner, logo and wordmark, green action, and support footer. The emailed action reached the staging admin confirmation route and completed sign-in as that organization admin. Its Events page showed the organization context without platform navigation.

The triggered password-changed security notice was also Delivered. Its HTML preview shows the same branding shell and clear account-security copy. The invitation's generated plain-text part still exposes the public logo URL before the wordmark and wraps “Race Pace” across lines. Treat plain-text quality as open. A separate text template is not exposed in the current hosted Auth template setup; review a custom send-email hook if exact text control becomes a launch requirement. Production templates remain local drafts.

## First real delivery evidence

Staging Supabase invitation to support.racepace@gmail.com created pending-verification user ccaf63bd-8d0c-40ce-9a02-cd07b0ebf811. Resend email 01a0afa2-016c-76e1-b93b-983b49c59086 shows Delivered at 2026-09-17 21:50 Asia/Manila. Sender: Race Pace Staging <staging@notify.racepace.com.ph>. Delivered HTML preview visibly loads logo and corrected design. Authentication URL targets staging, but has not been consumed. This dashboard invitation does not establish organizer membership.

Plain-text part exists, but its opening banner/logo text runs together and repeats Race Pace. Record as a formatting gap; no full text-quality pass. Gmail Primary inbox placement and desktop rendering verified. Mobile rendering and link completion remain unverified.

## Gmail verification and staging blocker

2026-09-17: Opened the actual invitation in support.racepace@gmail.com Gmail Primary inbox. Desktop screenshot shows loaded logo, wordmark, staging banner, green tagline, body and CTA. No spam placement observed for this message. This does not establish general deliverability or mobile compatibility.

Staging root https://staging.racepace.com.ph/ currently returns Vercel 404 DEPLOYMENT_NOT_FOUND. Do not consume the invitation token against a missing application. Deploy the reviewed staging runner/admin applications with staging configuration, then generate a fresh invitation through the intended application flow to verify the exact callback and membership handling.

## Follow-up checks

- Gmail desktop Dark theme: invitation remains readable with loaded logo, green action and white card. Default theme restored. This is not Gmail mobile auto-inversion coverage.
- Mobile: viewport override did not change actual DOM width (1280px). Unverified.
- Plain text: block paragraph around TEST banner fixes run-together header. Decorative logo alt avoids duplicate label; Supabase conversion retains image URL. Corrected invitation/recovery applied; confirmation is also applied; email-change/magic-link hosted update remains pending.
- Both staging applications are now deployed and Ready. Recovery requested through staging runner, received in Gmail and redeemed to clean /auth/recovery password form. User must set password before completion verification.

## Recovery completion
2026-09-17: Password update success observed; user signed in with new password. Protected staging /profile loaded with Race Passport and logout controls, verifying fresh session access. Missing recovery-card logo fixed on site/admin and visually verified after staging deployments. 18 recovery tests and both typechecks passed. Fresh token form uses the same unconditional logo as the verified invalid-link card. Token reuse/expiry and admin recovery flow remain separate pending tests.
