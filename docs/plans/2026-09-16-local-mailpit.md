# Local Mailpit email verification

Status: local transport implemented and verification completed; runner authentication gaps recorded separately. Local web/admin only; preserve sample data and hosted settings.

1. Use Supabase's bundled Mailpit for local Auth mail. Add explicit `EMAIL_PROVIDER=mailpit` ticket transport with no live-provider fallback. Keep Resend as the production default and Mailtrap as an optional sandbox.
2. Verify transport success/rejection/network failure tests. Restart the local Supabase stack with preserved volumes; verify SMTP host before any mail is sent. Restart local Edge serving with the ignored local provider setting.
3. Test new staff invitation, returning staff sign-in, runner confirmation, recovery and paid ticket delivery through the real application/auth endpoints. Inspect messages and landing pages using the in-app Browser. Record any unsupported recovery workflow or browser handoff boundary accurately.
4. Update the checklist and implementation/review reports. No commit, push, hosted change or deployment.
