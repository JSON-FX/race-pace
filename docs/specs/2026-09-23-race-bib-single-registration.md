# Race Bib single registration

Status: approved visual direction; implemented locally, staging release pending.

The selected [Race Bib preview](../previews/register-single-prototypes/02-race-bib.html) is the visual acceptance reference for the runner's single registration path. It defines the photographic masthead, four-step progress rail, ticket-like main panel, pale race summary, content hierarchy, typography, spacing, and responsive behavior from phone to desktop. The masthead uses the approved dark trail photograph. The Passport row uses the runner's saved profile avatar where available, with initials when no photo exists.

The live flow remains Details → Kit → Confirm → Pay. The first three steps stay within `/register/[categoryId]`; a successful, server-authorized reservation routes to `/pay/[registrationId]`. Existing Passport completeness, custom field validation, optional add-ons, waiver acceptance, idempotency, hold expiry, organizer/event gates, fee disclosure, and PayMongo handoff remain authoritative. The visual redesign must not quote a payment-processing fee or final pass-on total before PayMongo calculates it.

The Pay step must display the existing QR Ph, GCash, Maya, Visa, and Mastercard files through `PaymentLogos`. Hosted PayMongo chooses the method at checkout. The local fake provider's method selector remains interactive. No backend schema or payment contract changes are included.

Acceptance: the live page matches the selected preview at desktop, tablet, and phone widths; content is driven by current event, category, Passport, add-ons, waiver, and registration data; all four steps are usable by keyboard and touch; no horizontal overflow; light and dark themes remain legible; the existing guarded payment behavior and registration tests pass.
