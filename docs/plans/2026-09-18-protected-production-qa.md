# Protected production QA deployment

## Goal

Run the release checkout and refund test against production services while the public production domains remain on Coming Soon.

## Decision

Vercel already requires account sign-in on the unique deployment URLs for both projects. Allow the application only when the request host exactly matches its own `VERCEL_URL` on a production deployment. Keep every custom and stable production hostname closed. If Vercel authentication is removed from a project, stop using this QA route before deployment.

## Tasks

1. Extend `isPublicLaunchClosed` to accept the deployment hostname and allow only the exact unique Vercel host. Validate with `pnpm exec vitest run packages/shared/src/launchGate.test.ts`.
2. Pass `VERCEL_URL` from both Next middleware entry points. Validate with `pnpm --filter site typecheck` and `pnpm --filter web typecheck`.
3. Run the full repository validation and review the gate diff. Deploy to production, then verify the public domains still redirect and the unique URLs still require Vercel sign-in before testing payments.

## Risks

The protection guarantee depends on Vercel's deployment protection setting. Check the actual unauthenticated response for both unique URLs after each deployment. Production remains test-mode only until this release QA passes.
