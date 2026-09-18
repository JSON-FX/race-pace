# Implementation Report — Local Mailpit

Plan: `docs/plans/2026-09-16-local-mailpit.md`. Branch: `feature/admin-ui-changes`.
Status: COMPLETE for the local transport switch and requested verification; two product-flow gaps remain open.

Local Auth and ticket delivery now use the bundled Mailpit. Resend remains the default when no provider is selected. The ignored local Edge environment selects Mailpit; the example documents it.

Changed `supabase/config.toml`, `supabase/functions/.env.example`, `_shared/email.ts`, and `_shared/email-transport.test.ts`. Added three Mailpit tests covering capture, rejection and transport failure. Thirteen email tests passed. Actual SMTP failure returned 502 without changing the paid registration; alias correction restored delivery. No frontend code changed, so the app builds/typechecks were not repeated in this slice.

The in-app Browser verified first staff acceptance, returning sign-in, runner address confirmation and manual sign-in, recovery email landing, and rendered ticket/QR/owner link. See the readiness ledger for message IDs. Recovery UI is absent, and the API-created runner's implicit confirmation link does not complete browser sign-in. These findings are recorded for the next implementation slice. No new password was entered or changed in the browser.

Deviations: the Supabase restart hit a transient Docker container-removal race; a clean retry succeeded. Full container name resolution failed in the Deno SMTP transport, so the existing `inbucket` network alias is used. These issues were resolved and retested. No additional Mailtrap messages, hosted changes, database resets, commits or pushes.
