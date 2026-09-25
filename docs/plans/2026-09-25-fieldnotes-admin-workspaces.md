# Fieldnotes admin workspaces: implementation and staging release

Status: owner-approved locally; staging release requested.

1. Start from current `origin/staging` in an isolated worktree. Preserve the dirty main checkout.
2. Add the scoped admin palette, typography, card, table, form, focus, motion, and responsive rules to the Storybook source. Add contextual stories for Dashboard, Registrations, Payments, Race kits, Check-in, Team, and Settings.
3. Copy the stylesheet byte-for-byte into the application. Mark each requested route with its Fieldnotes section label. Keep authorization, data access, and mutation logic intact.
4. Check the signed-in local Docker pages with local Supabase at 1280px and 390px. Verify no page-level horizontal overflow and inspect the race-day and Settings layouts. Check the no-JavaScript event switcher on a phone.
5. Run the admin typecheck and test suite. Run Storybook typecheck and build, then rebuild the local catalog. Record the source hash and review links in the launch progress ledger.

The owner accepted the local design and requested a staging release. Follow the staging-first workflow with a pull request into `staging`, exact-revision validation, and hosted staging verification. Production remains a separate release.

Annotation follow-up: update Storybook's admin stylesheet and interaction stories first, sync the app copy, then verify the three canvas choices, both roster searches, check-in disclosure, and capacity panel at desktop and phone widths. Keep the default white and record the source hash in the launch ledger.
