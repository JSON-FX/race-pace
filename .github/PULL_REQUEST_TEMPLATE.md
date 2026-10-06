## Scope

- [ ] This change contains only the stated feature, fix, or release work.
- [ ] I used a dedicated branch and isolated worktree from the active integration branch (`staging` before Option B activation; `main` afterward).
- [ ] I preserved unrelated working-tree changes and release artifacts.

## Local validation

- [ ] `web-admin-validate` passes for this exact commit.
- [ ] I recorded any checks that cannot run locally and their reason.

## Staging integration

- [ ] The pull request targets the active integration branch.
- [ ] Required migration and Edge Function sources are included in the same reviewed revision.
- [ ] Vercel previews and applicable local provider tests pass.

## Production promotion

Before Option B activation, complete this section for a staging-to-main production PR.
After activation, production approval happens in the protected `release-production` job;
review the pinned staging evidence and record affected-flow acceptance in its approval comment.

- [ ] The head branch is `staging`.
- [ ] The release diff is the exact staging revision that passed acceptance.
- [ ] Both staging Vercel deployments are Ready at the recorded staging commit.
- [ ] Required staging Supabase migrations and Edge Functions match that commit.
- [ ] Staging Auth, Resend, PayMongo, CAPTCHA, webhooks, and schedules were checked when applicable.
- [ ] Hosted staging end-to-end evidence is recorded in `docs/operations/launch-progress.md`.
- [ ] The production backend rollout and rollback order are documented.
- [ ] Production-safe verification avoids synthetic data and automated real payments.
- [ ] A `main` back into `staging` sync is planned after production verification.
