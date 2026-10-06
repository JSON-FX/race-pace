# Implementation report — Option B CLI reliability

Plan: `docs/plans/2026-10-06-option-b-release.md` (staging rehearsal follow-up).
Branch: `codex/option-b-cli-reliability`. Status: implemented and validated.

The hosted rehearsal reproduced CLI 2.109.1 returning nonzero after successful function deployment
because optional PostHog telemetry shutdown timed out. Added the CLI-supported environment
setting `SUPABASE_TELEMETRY_DISABLED=1` to the release workflow. Deployment error handling,
source checks, readback, environment protection and owner approval remain unchanged.

Validation: a hosted read-only command with telemetry disabled passed; all 98 release/scope tests
passed; actionlint 1.7.7 and `git diff --check` passed. No app/backend source or dependency changed,
so same-session full checks and exact staging CI remain applicable. No new test mirrors the literal
environment assignment. Staging deployment and owner-confirmed email evidence are documented.

No deviation from the follow-up plan. Production and cutover remain pending.
