# Org admin Guide: five interactive proposals

Status: Video Library selected, implemented, and deployed at [production Guide](https://admin.racepace.com.ph/guide) after hosted staging acceptance. These five proposals remain the original design references. See the [application specification](../../specs/2026-09-27-org-admin-guide.md), [source synchronization](application-source-sync.md), and [live local page](http://127.0.0.1:4180/guide).

Branch: `codex/org-guide-prototypes`, created from `origin/staging` at `1188768f33ea4999407774c15fc3146d8e72cc25`.

## View

- [Compare all five](http://127.0.0.1:4178/).
- [Storybook catalog](https://storybook.lan/race-pace/?path=/story/fieldnotes-proposals-org-admin-guide--video-library).
- Individual choices accept `?choice=1` through `?choice=5` on the standalone preview.

The preview toolbar changes the layout and simulates Org admin or Super admin. The state control demonstrates ready, loading, empty, and failed library states. It is hidden on phones to keep the product view compact.

## Five structures

| Choice | Structure | Fit | Tradeoff |
| --- | --- | --- | --- |
| 1. Video Library | Featured walkthrough and thumbnail collection | Recommended balance of search and discovery | Longest page on phones |
| 2. Topic Index | Topic navigation and grouped titles/descriptions | Familiar section-based lookup | Less video artwork |
| 3. Watch Desk | Player beside searchable video queue | Watching several videos without losing context | Player occupies space before selection |
| 4. Task Finder | Activity groups with matching videos | New admins looking for a specific task | Task groups need editorial maintenance |
| 5. Compact List | Dense searchable directory | Repeated reference and larger collections | Less visually expressive |

## Scope and interaction contract

- The page is called **Guide** and appears in the organization admin navigation.
- Org admins search titles and descriptions, filter by topic, sort, and watch published guides.
- Only super admins get creation, video selection, title, description, draft, publish, and edit controls.
- The role selector is a design preview, not application authorization. Real permission enforcement remains application work after selection.
- Guides are proposed as a platform-maintained catalog shared across organizations. Organization business data remains isolated.
- Drafts never appear in the Org admin preview. Published local records do appear there.
- File selection and drag/drop accept MP4 or WebM up to a proposed 500 MB limit. This limit needs confirmation against storage choices during implementation.
- Files are read through object URLs, never uploaded. Reload clears all local records and files.
- Titles and durations are illustrative except the existing 8:43 event-to-ticket tutorial. Other lessons show explicit recording placeholders.

## Fieldnotes source and provenance

This proposal uses the Storybook Hub's canonical Fieldnotes `Button` and `Field` adapters. It composes official shadcn `Input`, `Textarea`, and `Dialog` from `@race-pace/ui`. Official `@shadcn` items and dialog examples were inspected through the shadcn MCP tools. Existing installed sources were reused.

Visual authority: `/Users/jsonse/Documents/development/storybook-hub/projects/race-pace/DESIGN.md`. Preserve the white admin canvas, forest actions, Apple system interface typography, and compact operational hierarchy. This proposal does not change that design system.

Explicit source sync: this folder's `GuidePrototype.tsx`, `guide.css`, and `guide.stories.tsx` are copied into `storybook-hub/projects/race-pace/src/proposals/org-guide/`. Assets are copied into the catalog's existing `fieldnotes/guide-assets/` static directory. Hub baseline commit is `d2a671b0c050847356933b38f9cf509be60c5c5c`; its pre-existing uncommitted library changes are preserved. The proposal sync is not a pinned application adoption.

Tutorial provenance: `/Users/jsonse/.codex/worktrees/coming-soon-video/race-pace/docs/tutorials/event-to-ticket-guide/`. The MP4, frames, and subtitle text come from the existing illustrated walkthrough with fictional event and participant data. Thumbnails are WebP conversions of its overview, basics, capacity, and opening frames. Captions are converted from SRT into VTT. No production data was read or created. The local 44 MB MP4 is ignored by Git; recreate the preview copy from that source if needed.

Reference lessons: [Wistia Help Center](https://support.wistia.com/en/) informed search-first category navigation. [Apple's user guide](https://support.apple.com/guide/mac-help/welcome/mac) informed clear topic wayfinding. Only interaction lessons were used, with no copied external artwork.

Design UI applied Emil's frequency/purpose test for motion, Impeccable's operational craft floor, Taste's brief-reading and anti-generic principles, and UI/UX Pro Max's search/keyboard/no-results guidance. The database's proposed palette and display fonts were rejected in favor of selected Fieldnotes tokens. No animation or UI framework was added.

## Run and verify

The preview uses the existing installed Storybook Hub runtime through an ignored `node_modules` symlink. The Vite alias points at the local hub's canonical style source.

```sh
./docs/previews/guide/node_modules/.bin/vite --config docs/previews/guide/vite.config.ts
./docs/previews/guide/node_modules/.bin/vite build --config docs/previews/guide/vite.config.ts
```

After syncing source to the hub, run `pnpm typecheck`, `pnpm build:all`, and `docker compose up -d --build` there.

`check-browser.js` is a runnable Playwright check function for the `browser_run_code_unsafe` tool's `filename` input. Run against the local server. If the browser tool limits file reads to the shared checkout, copy this check into that checkout’s ignored `.playwright-mcp/` directory and pass the copied path. It checks all five search and empty-result flows, role control visibility, draft publication, uploaded video playback, invalid files, and dialog keyboard behavior.

Current verification: standalone build passes; hub typecheck and full catalog build pass. All five layouts fit 1440px desktop, 820px tablet, and 390px mobile with no document overflow or broken images. Search includes descriptions. Topic filtering, no-results reset, sorting, video playback and caption presence, draft visibility, publication, initial dialog focus, Escape, mobile navigation, and reduced-motion transition removal were checked in the browser. Existing published guides converted back to drafts are hidden from the featured slot and Watch Desk. Mobile navigation contains keyboard focus, closes with Escape, restores focus, and fits the phone viewport. Impeccable's mechanical detector returned no findings. The independent finish reviewer scored both reported findings resolved and returned `ship` at the proposal scope. Screenshots are under ignored `verification/`.

Video Library was selected on 2026-09-27. The live application now uses real data, backend permissions, private storage, and the selected responsive composition. `check-application-browser.js` verifies the consuming page with isolated QA records. Follow the repository's staging-first release workflow for hosted delivery.
