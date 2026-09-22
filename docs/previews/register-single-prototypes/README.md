# Race Bib single registration design

Open [the selected Race Bib preview](./02-race-bib.html). It presents the Details, Kit, Confirm, and Pay steps with fictional runner details. The preview does not call a backend, create a registration, or start a payment session.

The selected direction uses a full-width event photograph and a ticket-like registration panel. The masthead background is an original, generated photograph of fictional trail runners. Its dark overlay keeps the heading readable. The Race Passport uses a fictional runner profile photo in the preview; the live implementation should use the signed-in runner's saved avatar when available.

The review includes the runner's details, shirt choice, event question, optional photo pack, entry costs, refund policy, and waiver. The Pay step shows the existing QR Ph, GCash, Maya, Visa, and Mastercard artwork from `apps/site/public/payments`. PayMongo calculates the processing fee and final total at checkout, so the preview does not invent those amounts.

The styling follows the site's semantic green, forest, surface, and border colors. UI/UX Pro Max guided contrast, spacing, touch targets, field grouping, progress, and reduced motion. The shadcn registry examples informed the Card, Button, Input/Label, Checkbox, and Dialog patterns. The static preview uses native HTML controls; the live Next.js implementation uses the installed components in `apps/site/components/ui` and existing registration components.

Reviewers can jump directly to any step. Continue enforces the waiver on Confirm. The Pay button shows a preview notice only.
