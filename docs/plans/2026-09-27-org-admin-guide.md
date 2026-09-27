# Guide: approved Video Library implementation

Status: implemented, deployed to staging, and verified through hosted Browser acceptance. Branch: `codex/org-guide-prototypes`.

## Intent and inherited decisions

Org admins need quick, searchable video answers about the admin console. Super admins upload videos, supply titles/descriptions/topics, edit metadata, save drafts, and publish guides shared across organizations. The user selected Video Library from the five Fieldnotes proposals on 2026-09-27. The approved composition is the featured split panel, topic filters, search/sort, thumbnail grid, and modal player. The live page uses the existing admin shell without proposal controls or fictional recordings.

## Context and patterns

- `docs/previews/guide/GuidePrototype.tsx`, `guide.css`: approved layout and responsive behavior.
- Storybook Hub `packages/race-pace-ui/src/button.tsx`, `field.tsx`, `src/ui/*`: component source. Sync Button/Field adapters explicitly; reuse the app's matching shadcn primitives.
- `apps/web/lib/nav-items.ts`: sidebar, palette, and mobile navigation share this model.
- `apps/web/lib/queries/roles.ts`: authoritative signed-in user roles; `isOrgAdmin` includes super admins.
- `apps/web/lib/actions/settings.ts`: role-gated actions, safe errors, `.select()` verifies writes, revalidation.
- `supabase/migrations/20260811091000_processor_rates.sql`: platform-owned table pattern.
- `supabase/migrations/20260720150000_user_roles.sql`: own-role SELECT permits inline admin checks.
- `supabase/tests/storage-event-images.test.ts`, `test/env.ts`: real local login/storage tests.
- [Private Storage authorization](https://supabase.com/docs/guides/storage/security/access-control) and [signed playback](https://supabase.com/docs/guides/storage/serving/downloads).

## Architecture

Create platform-owned `guide_videos` with UUID id, title (1–160 trimmed characters), description (1–2000), topic, duration_seconds (1–14400), storage_path, optional thumbnail_path, is_published, created_at, updated_at. This intentional global content exception has no org_id. Tenant business data stays isolated.

Create private `guide-videos` bucket, max 50 MiB, MIME MP4/WebM/JPEG. Video paths are `guideUUID/uploadUUID.mp4|webm`; optional generated thumbnail is `guideUUID/uploadUUID.jpg`. Constraints bind paths to guide IDs. Existing Storage policies cast the first folder to UUID, so all paths use UUID prefixes.

Super admins have table and Storage CRUD through RLS. Org admins from any organization read only published rows and sign only matching published video/thumbnail objects. Editors, marshals, runners, and anonymous users are denied. Reuse `auth_is_super_admin()`; no new privileged function or service-role browser credential.

Browser uploads directly with the authenticated SDK. Native video metadata supplies duration and a canvas frame supplies an optional thumbnail. Uploads use immutable paths without upsert. A validated server action checks super-admin roles, payload, and uploaded object existence before saving metadata. Preserve uploaded paths across a metadata failure for safe retry. Playback URLs are minted on demand for one hour; thumbnail URLs have the same bounded lifetime and refresh when expired. Unpublishing denies new signing; already issued URLs last until expiry.

## Step-by-step tasks

1. CREATE additive migration and backend tests. Prove roles, drafts, cross-org shared reads, private objects, constraints, and grants. VALIDATE: `pnpm exec vitest run supabase/tests/guide-videos.test.ts supabase/tests/function-grants.test.ts` against an isolated loopback stack.
2. CREATE guide model/validation, queries, save and playback actions. UPDATE navigation. VALIDATE: `pnpm --filter web typecheck` and focused action/model/navigation tests.
3. SYNC Fieldnotes adapters with an explicit source record. CREATE Video Library component, real uploader/player, `/guide` page/loading/error. VALIDATE: `pnpm --filter web typecheck` and component tests.
4. RUN integrated browser checks with local super-admin upload and two org admins. Confirm persistence, publish/draft gates, search/reset/sort, playback, errors, mobile navigation, keyboard and responsive widths. VALIDATE: saved browser check and screenshots at 1440, 820, and 390 pixels.
5. RUN PIV validation and technical review. UPDATE spec, roadmap, launch ledger, source-sync record, implementation report. VALIDATE: full web tests, site typecheck/tests, backend suite, shared typecheck, `git diff --check`, review with no unresolved findings.

Backend implementation and frontend implementation may proceed in parallel after this contract. Backend owns migrations/tests only. Frontend owns web files and documentation.

## Acceptance criteria

- Guide appears in desktop navigation, command palette and mobile More for org/super admins only.
- Search matches title, description and topic; filters/reset and title/duration sorts work.
- Only published guides appear to org admins, including featured/related videos.
- Only super admins can upload, edit, draft and publish, enforced at database and Storage boundaries.
- Invalid/empty/oversized files and invalid metadata produce useful errors. Metadata retries do not reupload.
- Actual stored videos play with native controls and an explicit retry for signing/playback failure.
- Responsive Fieldnotes layout follows the approved Video Library; no sample data enters production.
- Local tests and review pass. Hosted staging/production delivery remains a separate release.

## Assumptions and deliberate scope

No critical product question remains open: quick search, shared library, roles, and selected layout are approved. The repository's actual global Storage cap is 50 MiB, so implementation corrects the prototype's unconfirmed 500 MB label. No subscription/global limit changes are included. Native compatible MP4/WebM is accepted; transcoding, progress tracking, learning paths, deletion UI, caption generation, and hosted release are outside this request. Optional thumbnail capture failure uses a topic tile, never a fictional video screenshot.

## Validation safety

Create a dedicated local Supabase stack with distinct project ID and free ports in an ignored validation workspace. Never reset shared stacks. Verify loopback URLs before fixtures. Run Next on a distinct localhost port, without changing Docker LAN route ownership. Dependencies and Next build output belong to this worktree.

## Amendments

- 2026-09-27 — Added `min-w-0` to existing SidebarInset after browser verification found tablet overflow from the shell’s minimum content width. No navigation behavior changed.
- 2026-09-27 — Corrected isolated test runtime’s public function URL to port 54721. The default points to the shared 54521 stack and caused one unrelated fake-checkout failure. Final suite passes with the isolated URL.

## Staging delivery

PR #166 merged on 2026-09-27. Hosted upload, publishing, role restrictions, search, playback, responsive layout, and cleanup passed using Browser. See `docs/operations/launch-progress.md` for the exact source, deployments, migration, and CI evidence.
