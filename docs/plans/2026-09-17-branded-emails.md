# Approved Race Pace email branding

Design: docs/previews/email-branding.html, approved by user 2026-09-17.
Status: implementation in progress. Web/admin only.

## Tasks
1. Add a shared table-based logo header/footer and explicit staging banner to existing ticket renderers. Preserve participant identity, escaping, QR URLs and totals. Validate focused email and group renderer tests.
2. Prepare branded Supabase confirmation, recovery, invitation, email-change, magic-link and reauthentication HTML templates preserving provider token placeholders. Do not replace invitation URL handling without checking deployed templates. Validate placeholders and HTML structure; review before hosted application.
3. Audit Auth page logo coverage and remaining enabled security email types. Add plain-text alternatives and transport coverage before claiming delivery complete.
4. Apply reviewed templates on staging, verify real inbox delivery and secure link consumption, then roll out production templates. No synthetic production records after cutover.
5. Implement proposed receipt/refund/event updates only with real, replay-safe notification triggers and authoritative state. Do not send preview figures or represent pending refunds as complete.

## Validation and limits
Run pnpm exec vitest run supabase/functions/_shared/email.test.ts supabase/functions/send-ticket-email/index.test.ts supabase/tests/group-ticket-email.test.ts. Keep database suites serial. Live SMTP success and browser preview do not prove end-to-end inbox or token behavior. Update launch-progress.md after each step. No commit/deployment implied by local edits.

## Required design comparison gate

Compare every implemented email against the approved `docs/previews/email-branding.html` variant. A passing unit test or saved Supabase template is not design approval.

- [ ] Map all 12 proposed variants to their renderer, hosted template and delivery trigger. Mark missing variants as pending; inventory additional Auth/security emails separately.
- [ ] Capture the matching proposal and actual rendered email with equivalent content and viewport sizes. Record evidence paths and discrepancies per variant.
- [ ] Compare the actual logo, proportions, wordmark, colors, typography, spacing, card widths, buttons, borders, footer and staging banner. Fix unintended differences; document email-client limitations.
- [ ] Verify the public HTTPS logo loads without authentication in the hosted preview and delivered inbox. Check dimensions and broken-image fallback; an image tag alone is not proof.
- [ ] Check desktop and narrow mobile layouts, long names, organizer names, multiple tickets, price breakdowns and QR readability. Confirm no clipping or horizontal overflow.
- [ ] Compare real Resend-delivered messages in the test inbox against the proposal, including images enabled/disabled and light/dark appearance where supported. Record tested email clients; do not imply untested client coverage.
- [ ] Verify subject, sender, plain-text alternative, recipient identity, organizer content and environment-specific links. Exercise authentication success, expiry and reuse; verify each ticket belongs to its participant.
- [ ] Record each variant as pending, failed or passed with evidence. Resolve visual and functional discrepancies before marking the overall email validation complete or rolling templates into production.

Logo discrepancy diagnosed: Supabase dashboard img-src excludes the custom website domain. Staging Auth drafts now use the same logo hosted in staging Storage. Recovery preview visibly renders it; hosted confirmation/invitation received the same fix. Real inbox verification and a production-owned storage asset remain pending.
