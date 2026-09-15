# Local ticket email through Mailtrap

Use the existing Mailtrap sandbox SMTP credentials for ticket email, selected explicitly with EMAIL_PROVIDER=mailtrap. Keep Resend as the default production transport. No live delivery is authorized in this stage. Remove unconditional delivered-email wording from the ticket: provider acceptance is not proof of inbox delivery. Verify the protected send-ticket-email endpoint using an already-paid QA registration, then inspect Mailtrap. Keep payment confirmation independent of mail failure.

Implementation: add a pinned SMTP transport only for the Mailtrap sandbox host; configure ignored local function secrets; add provider tests; preserve existing endpoint authentication and paid-ticket checks. No database migration or hosted deployment needed.

## Completed and verified

- Added explicit Mailtrap sandbox SMTP transport, using pinned nodemailer 10.0.10 and required TLS. Existing local Auth SMTP credentials copied into ignored functions environment; no secrets committed.
- Default Resend behavior preserved. Missing Mailtrap credentials fail without falling back to live delivery.
- Ticket page no longer claims email delivery without evidence. Email advises saving the actual ticket as PDF instead of implying remote QR images work offline automatically.
- Protected send-ticket-email for paid registration 0cd4949d-affb-47ef-95a8-6081cc51d4e2 returned HTTP 200. Mailtrap message 5702383721 received and inspected with Computer: correct recipient, event, date, category, PHP 1,000 and ticket reference. Clicking View your ticket opened the correct authenticated ticket with the revised copy.
- Independent automatic-flow check: created dedicated local QA user runner-mailflow-20260915@example.com through Auth admin API, registered through registrations-checkout, then followed returned fake-checkout action. Registration 4a2468ee-babd-45b5-a156-16eeef768d07 confirmed successfully and automatically produced Mailtrap message 5702385325. Receipt verified in Computer. This second flow used API requests, not another full browser registration walkthrough.
- Ten email template/transport tests pass. Storefront typecheck and git diff --check pass. No schema or hosted deployment changes in this stage.

References: https://nodemailer.com/smtp and https://docs.mailtrap.io/email-sandbox/setup/sandbox-smtp-integration . Local SMTP accepted and delivered to sandbox; real recipient delivery, production provider configuration, retries/delivery tracking and hosted QR reachability remain separate release checks.
