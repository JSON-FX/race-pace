# Fieldnotes Guide application source synchronization

Checked 2026-09-27. Hub baseline commit: `d2a671b0c050847356933b38f9cf509be60c5c5c`. The hub has unrelated local edits, so this record identifies the exact source bytes rather than claiming every source file is committed at that baseline.

The user selected Video Library. Application adapters below were copied from the canonical `packages/race-pace-ui` package. Changes are limited to the Next client directive and import paths for the app's existing matching shadcn primitives. Spinner imports the app's `cn` helper. No extra UI framework or dependency was added.

| Canonical source | Source SHA-256 | Consumer | Consumer SHA-256 |
|---|---|---|---|
| `packages/race-pace-ui/src/button.tsx` | `5aaab64862e78059e9ef70176436c0ba6b559d00e2a6cc512f6401cdfae7ce6d` | `apps/web/components/fieldnotes/button.tsx` | `e75b12caa50491b8f3cb9b41720f9c03092100655bbb7800bc41d59ef3e35296` |
| `packages/race-pace-ui/src/field.tsx` | `ed6bb51d44ab1ff6185d0877cd192734eca0a115d6c2503733eca74d4fd563a4` | `apps/web/components/fieldnotes/field.tsx` | `ede10a29cf00226db166d7f93d700490580bc4b2b0edbdddcd23a35722d7addc` |
| `packages/race-pace-ui/src/ui/spinner.tsx` | `5d040fc49cb54c0296070644053b5a8840ddbfca89a430546bf308df3fffad65` | `apps/web/components/fieldnotes/spinner.tsx` | `d07526a2f821962529e09e3b8dd55123eec0c753cced3983f8e1cbafcec7a737` |

The application reuses its installed Input, Textarea, Dialog, Label, and Button primitives. The Fieldnotes adapters preserve variant/loading and label/hint/error APIs. Guide's CSS was explicitly synchronized from the approved `docs/previews/guide/guide.css`, keeping only Video Library, modal, filter, management, and responsive rules. Its colors are scoped to `.gd-root` and `.gd-dialog` so they do not rewrite the incumbent admin system.

## Intentional application differences

- Existing AppShell supplies sidebar, top bar, org switcher, command palette, and mobile More. Proposal toolbar, role switch, example navigation, and design annotation are removed.
- A `min-w-0` constraint on SidebarInset prevents its content's minimum width from expanding tablet layout. Verified at 820 pixels.
- The repository's actual Storage cap is 50 MiB, replacing the proposal's unconfirmed 500 MB label. Video duration and thumbnails come from the uploaded recording.
- Real queries and row-level security replace sample data and role simulation. Signed URLs replace local object URLs. The latest published record supplies the feature.
- Responsive grid, topics, split feature, modal focus, and reduced-motion behavior remain approved composition contracts. Reduced motion retains correct play-overlay centering.

## Verification

The five proposal stories remain available in the built local catalog at `https://storybook.lan/race-pace/`. Their earlier catalog typecheck and full build passed. The consuming application is verified separately with real local upload, persistence, signed playback, editing, draft isolation, role denial, search/filter/reset, and desktop/tablet/mobile browser checks. This is local implementation evidence, not a hosted release claim.
