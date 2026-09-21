## Scope

- [ ] This change contains only the stated feature, fix, or release work.
- [ ] I used a dedicated branch and isolated worktree created from current `origin/staging`.
- [ ] I preserved unrelated working-tree changes and release artifacts.

## Local validation

- [ ] `web-admin-validate` passes for this exact commit.
- [ ] I recorded any checks that cannot run locally and their reason.

## Staging integration

- [ ] A feature or fix pull request targets `staging`.
- [ ] Required migration and Edge Function sources are included in the same reviewed revision.
- [ ] Vercel previews and applicable local provider tests pass.

## Production promotion

Complete this section only when the base branch is `main`.

- [ ] The head branch is `staging`.
- [ ] The release diff is the exact staging revision that passed acceptance.
- [ ] Both staging Vercel deployments are Ready at the recorded staging commit.
- [ ] Required staging Supabase migrations and Edge Functions match that commit.
- [ ] Staging Auth, Resend, PayMongo, CAPTCHA, webhooks, and schedules were checked when applicable.
- [ ] Hosted staging end-to-end evidence is recorded in `docs/operations/launch-progress.md`.
- [ ] The production backend rollout and rollback order are documented.
- [ ] Production-safe verification avoids synthetic data and automated real payments.
- [ ] A `main` back into `staging` sync is planned after production verification.
