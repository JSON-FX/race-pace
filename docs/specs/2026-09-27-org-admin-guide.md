# Organization admin Guide

Status: selected Video Library deployed to production through PR #168 after hosted staging acceptance; production read-only checks passed.

## Approved design

The owner selected **Video Library** on 2026-09-27 after reviewing five interactive [Fieldnotes proposals](../previews/guide/README.md). The owner confirmed quick answers and searchable videos. The implementation keeps the split featured panel, topic buttons, search and sort controls, thumbnail grid, and modal video detail. Grid columns are three on desktop, two on tablet, and one on mobile. It uses the existing admin shell, sidebar, command palette, and mobile More navigation.

Source: the [approved prototype](../previews/guide/GuidePrototype.tsx) and [explicit Fieldnotes synchronization](../previews/guide/application-source-sync.md). Implementation plan: [Guide plan](../plans/2026-09-27-org-admin-guide.md).

## Product behavior

- Org admins read and watch published guides shared across organizations. Search matches title, description, and topic. Topic filtering combines with search. Sorting supports newest recommended, title, and duration.
- Super admins upload MP4/WebM, add title/description/topic, edit guides, save drafts, and publish. Drafts stay in super-admin management. The newest published guide is featured.
- Uploaded video duration is measured in the browser. A real frame provides the optional thumbnail. A topic tile appears when no thumbnail is available.
- The player uses native controls. Signing or playback failure has a retry. Loading, empty library, no matches, upload validation, failed save, and permission denial have explicit states.
- Failed metadata saves retain uploaded paths for retry. The uploader blocks closing while a save runs. Dialogs trap focus and restore the opener on close.

## Data and permissions

`guide_videos` is platform-owned teaching content and intentionally has no organization ID. It carries bounded title/description/topic, real duration, immutable video/thumbnail paths, publication status, and timestamps. Business tables keep tenant isolation.

The private `guide-videos` bucket permits only MP4, WebM, and JPEG, with a 50 MiB per-file limit. The unconfirmed prototype label of 500 MB was corrected to the repository's existing Storage cap. Titles are at most 160 characters; descriptions at most 2,000. Videos are at most four hours.

Database row-level security permits super-admin CRUD. Org-admin reads require published rows. Storage reads require an exact matching published video/thumbnail path and an admin role. Editors, marshals, runners, and anonymous callers are denied. A known draft or orphan object path does not grant access. Server actions validate roles, metadata, path ownership, and upload existence before saving. No service-role key reaches the browser.

Playback and thumbnails use signed URLs with one-hour lifetimes. Unpublishing prevents new URL creation immediately. Already issued URLs remain usable until expiry, following Supabase behavior. Long-lived tabs refresh thumbnail signing after 50 minutes.

## Scope and release

No synthetic guide rows or media are inserted by the migration. The real library starts empty until a super admin publishes content. Local QA uses an isolated stack and existing illustrative tutorial media. Abandoned uploads and replaced files remain super-admin-only; automatic deletion is excluded because an uncertain save response must not destroy a successfully saved recording.

Transcoding, video analytics, lessons/progress, and caption generation are outside this slice. Migration `20260927010129` and the reviewed application passed staging role/upload/playback acceptance before production promotion. Both hosted Storage global caps support 50 MiB. See the release ledger for production deployments and read-only verification.
