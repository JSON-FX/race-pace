# Guide upload progress and 100 MB limit

Status: implemented and accepted on hosted staging and production; release synchronization complete. Branch: `codex/guide-upload-progress`, based on staging `f6cd6d6e6f18834e20c8f8702e805de703b87817`. Main is an ancestor of staging. The original Guide release is verified in production at `ff7d22e8b2d4311c692ffb90b255e821cba50ed0`.

## Feature and acceptance criteria

As a super admin, I want visible upload progress and videos up to 100 MB so I can upload larger guides with clear feedback.

1. Show actual video transfer progress with a Fieldnotes progress bar and accessible numeric value. Distinguish transfer, server completion, thumbnail preparation, and metadata saving.
2. Accept MP4/WebM files through 100,000,000 bytes, including files above the former 50 MiB cap. Reject one byte above the new cap before upload.
3. Match the application, local Storage, Guide bucket, and hosted global Storage limits. Keep other buckets' effective limits through explicit existing caps.
4. Preserve the existing duration, format, authoring/publication permissions, private objects, and metadata retry behavior. Network/server failure clears busy progress and permits retry without creating metadata.
5. Pass focused transport/UI/boundary and backend policy tests, the required full repository gates, and Browser upload checks on staging. Promote through staging only. Production verification is read-only with no synthetic data.

## Context and decisions

Read `apps/web/lib/guide-upload.ts`, `guides.ts`, `components/guide/GuideLibrary.tsx`, its test and CSS, `supabase/config.toml`, and `supabase/tests/guide-videos.test.ts`. The upload currently uses the SDK's standard multipart POST and has only phase text. The SDK exposes no per-upload progress callback. Use native XMLHttpRequest for the video POST, matching the installed SDK's FormData (`cacheControl` and file), bearer/anon headers, and `x-upsert: false`. Read the existing browser session only to obtain its token; Storage RLS remains the authorization boundary. Keep thumbnail upload through the SDK. No new dependencies or privileged credentials.

Reuse `storybook-hub/packages/race-pace-ui/src/ui/progress.tsx` and its existing Progress story. Record the exact source sync. Add the missing Root value binding in the consumer so assistive technology receives the numeric value. Keep Fieldnotes scoped colors and reduced motion. The catalog itself needs no new component.

The user requested 100 MB; use decimal bytes, 100,000,000, consistently. A follow-up migration updates the Guide bucket and bounds other currently uncapped buckets at their former effective 52,428,800-byte ceiling. Existing explicit lower bucket caps remain intact. Raise the hosted global cap only after this migration is verified. Do not alter the already-applied original Guide migration. Local Storage uses `100MB`.

References: [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), installed StorageFileApi multipart implementation, and existing Fieldnotes source synchronization. Standard uploads support this size; resumable protocols are a separate feature.

## Tasks and checks

1. Update the central size bound and boundary tests. Validate: `pnpm --filter web exec vitest run lib/guides.test.ts`.
2. Add native transfer progress and the Fieldnotes bar. Add meaningful transport/UI tests for intermediate values, completion, failure, and unchanged metadata retry. Validate: focused Guide tests and `pnpm --filter web typecheck`.
3. Apply the additive cap migration and local config; update bucket tests and the source sync record. Validate: isolated migration replay and `pnpm exec vitest run supabase/tests/guide-videos.test.ts`.
4. Run the required frozen-install, app typechecks/tests/builds and backend suite against the task's isolated 547xx stack with fake providers. Review the complete diff and write an implementation report. Update the feature spec and launch ledger.
5. Commit and release through staging. Verify migration/global cap readback and actual Browser upload above 50 MiB, visible increasing progress, successful save/playback, error recovery, permissions and cleanup. Promote to production only after staging passes; verify live source, caps, read-only UI and business counts, then sync main back into staging.

No open product questions remain. No resumable, cancel/pause, or background upload feature is introduced. Preserve the original approved Video Library composition.
