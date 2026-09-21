# Code Review: Staging-first release workflow

## Scope

Reviewed the release-policy changes in:

- `AGENTS.md`
- `.github/workflows/ci.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `docs/README.md`
- `docs/operations/release-workflow.md`
- the 2026-09-22 audit entry in `docs/operations/launch-progress.md`

The working tree contains unrelated user changes. This review does not attribute or approve those
changes, including the earlier launch-progress edits around the new audit entry.

## Change statistics

- Files modified: 4
- Files added: 2
- Files deleted: 0
- Scoped additions: 294 lines
- Scoped deletions: 1 line

## Findings

No technical issues detected in the reviewed scope.

The required `web-admin-validate` job now rejects a pull request into `main` unless its head branch
is `staging`. The documentation and pull-request checklist consistently require hosted staging
acceptance before production promotion and a `main`-to-`staging` sync afterward.

## Validation

- `git diff --check` passed.
- Ruby parsed `.github/workflows/ci.yml` successfully.
- Repository assertions found the session-startup rule, environment identities, production source
  gate, production-safety rules, and sync-back rule.
- A simulated production-source check passed for `staging` and blocked `feature/example`.

## Residual risks

- The remote branches remain divergent and require an isolated reconciliation pull request.
- Hosted staging end-to-end testing remains manual because the Playwright suite targets local Docker.
- The Vercel automation bypass entries are not yet consumed by a GitHub workflow.
- Full application suites were not rerun because this scope changes release policy and documentation,
  while the shared checkout contains extensive unrelated application changes.
