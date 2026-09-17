# Branded authentication email drafts

Approved visual design: docs/previews/email-branding.html. Staging invitation, confirmation and recovery templates were applied through the dashboard on 2026-09-17, with TEST subjects. Other files and production templates are not yet applied. Real delivery remains untested.

Both environments preserve Supabase ConfirmationURL. Before applying, compare each hosted template and preserve any custom token-hash invitation/PKCE flow. Do not replace a custom link with the generic placeholder blindly. Email-change double-confirmation behavior must be tested. Magic link is optional and does not enable passwordless login itself.

Logo is a fixed HTTPS asset; verify it returns an image publicly before delivery. Staging drafts include a test banner. Security notification types still need inventory. No sample registration or financial amounts appear in these templates.

### Logo preview compatibility
Supabase dashboard's Content-Security-Policy excludes the custom Race Pace domain from img-src. The public website PNG is valid, but the dashboard preview blocks it. Staging Auth templates now use the identical logo in staging's public `email-branding` bucket, with no client write policies added. Confirmation, recovery and invitation are applied; remaining drafts are pending. Production drafts still use the public website URL; provision a production-owned asset before their dashboard rollout. Do not point production emails at staging storage. Actual inbox rendering remains a separate gate.
