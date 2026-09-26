# Coming Soon events implementation

**Branch:** `codex/coming-soon-events` from current `origin/staging`.
**Spec:** [2026-09-25-coming-soon-events](../specs/2026-09-25-coming-soon-events.md).
**Preview:** [approved Dossier option](../previews/coming-soon-event/runner-options.html).

## Implementation order

1. **Schema and boundaries.** Add the status and event settings, separate reservation commission, reservation and notification tables, explicit grants and policies. Add an event-level capacity function that serializes on the event row and includes ordinary registrations. Add reservation conversion and provider-safe expiry functions. Validate with local migration replay and concurrent backend tests.
2. **Payment and delivery.** Implement authenticated reservation checkout, persisted provider request, signed webhook routing, authenticated verify, replay-safe capture, processor-fee reconciliation, receipt delivery, and provider-confirmed expiry. Reuse PayMongo's hosted pass-on calculation. Include reservation money in operator and organizer ledger, settlement, and payout paths. Validate fake and PayMongo test-mode flows without production charges.
3. **Organizer controls.** Extend event editor state, validation, saving, and readback. Add conditional Reserve now and Notify me fields, capacity/deadline controls, gallery guidance, and the five-field coming-soon publication path. Add reservation terms to `/commission` with operator-only writes. Validate event and commission tests and web typecheck.
4. **Runner journey.** Add the approved Dossier page branch on `/events/[slug]`, actual payment logos, prominent organizer avatar, carousel and fullscreen viewer, reservation and notification actions, dedicated payment return/status, and account reservation list. Suppress public capacity across page, cards, and home. Validate runner tests, typecheck, and responsive browser views.
5. **Opening and lifecycle.** Send deduplicated announcement email when registration first opens. Carry a paid reservation through the existing category/registration checkout and transfer the held event place atomically. Do not credit the separate reservation fee. Enforce and communicate the payment deadline. Validate successful conversion, nonpayment expiry, extension, and category-full behavior.
6. **Final gates.** Run the local backend suite, both app suites and typechecks, relevant builds, migration/grant audit, and visual review at desktop/tablet/mobile widths. Review the full diff. Update the roadmap and launch-progress ledger. Write `.claude/reports/coming-soon-events-report.md` with exact results and limitations. Follow staging-first release workflow if a later request authorizes a push or pull request.

## Boundary and implementation notes

- New public event status: `coming_soon`; ordinary registration remains gated to `open` and `almost_full`.
- Reservation fee, platform fee, and processor fee are three separate money components. Store centavos, and never send a browser-calculated gross to PayMongo.
- The reservation checkout has its own durable identity. Do not insert a fake ordinary registration just to satisfy `payments.registration_id`.
- Scope every row and operation by `org_id`, event, and authenticated runner. A status check in the page is only presentation; the Edge Function and database own admission.
- An unresolved provider checkout keeps its hold. The worker releases it only after the hosted session is closed or verified unpaid.
- If registration opens after the stated payment deadline, the database extends the deadline 14 days from opening and updates the held reservations. A release test must verify the new date in the runner view and email.
- Keep existing checkout, group orders, settlement, and refunds working. A reservation-specific path must appear in financial reporting instead of quietly falling out of registration joins.

## Validation commands

Run the narrow tests next to each slice, then `pnpm test`, `pnpm --filter site test`, `pnpm --filter web test`, both app `typecheck` commands, and both production builds. Use a local Supabase reset only after confirming the active local test database and preserving the shared pilot data. Browser-review the isolated worktree or its own served preview, not the user's shared checkout.
