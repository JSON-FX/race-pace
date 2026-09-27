# Guide proposals: Fieldnotes source check

Checked on September 27, 2026. Scope: five local Guide compositions awaiting the owner's selection. These extend the incumbent Fieldnotes system; they do not establish a new visual identity or approve a system change.

## Evidence checked

- Canonical visual authority: `/Users/jsonse/Documents/development/storybook-hub/projects/race-pace/DESIGN.md` and its active `src/fieldnotes-next/theme.css`.
- Shared component source: `storybook-hub/packages/race-pace-ui/src/button.tsx` and `field.tsx`.
- Built extension: [GuidePrototype.tsx](GuidePrototype.tsx), [guide.css](guide.css), [Storybook entries](guide.stories.tsx), and [preview configuration](vite.config.ts).
- Product scope and source provenance: [proposal README](README.md) and [Guide specification](../../specs/2026-09-27-org-admin-guide-proposals.md).

## Comparison

| Fieldnotes role | Guide evidence | Result |
| --- | --- | --- |
| Forest actions and readable ink | Action `#176341`, ink `#1d3829`, muted ink `#506755`, input line `#91a68d`, destructive `#a12f32` | Matches canonical light roles. |
| White operating surfaces | White page, fields, and dialogs; quiet green selection surfaces | Preserves the requested white admin canvas. The catalog's paper canvas remains a runner/system option. |
| Apple interface typography | Apple system stack throughout; compact supporting text; interface headings and dialog titles | Preserves the Operating Type Rule. Editorial runner type is not introduced into Guide. |
| Shared controls | `Button` and `Field` imported from `@race-pace/ui`; installed official `Input`, `Textarea`, and `Dialog` reused | Preserves adapter APIs and primitive ownership. Field retains label/error relationships; Dialog retains its accessible primitive structure. |
| Compact operations and restrained feedback | Search, topic filters, readable descriptions, explicit statuses, mostly flat surfaces, brief control feedback | Consistent with the operational direction. Reduced-motion rules remove animation and transitions. |

The five structures differ in content arrangement: Video Library, Topic Index, Watch Desk, Task Finder, and Compact List. Their shared palette, type, controls, and permission presentation remain consistent.

## Local composition choices

`guide.css` owns proposal geometry and preview scope. It deliberately uses a lighter neutral divider (`#d5ddd4`), muted surface (`#f1f4ef`), 12px action rounding, 16px dialogs/panels, and 44px control targets. These are surface-specific choices, not replacements for Fieldnotes' normative tokens. Responsive rules stack content and convert admin navigation to a full-screen Dialog. The Dialog's mobile translation reset and box sizing belong to this composition.

Custom CSS also covers thumbnail/player proportions, duration labels, topic rows, queues, task groups, and preview controls. The small play-overlay shadow belongs to media legibility; ordinary panels do not acquire floating depth. None of these patterns is promoted to a global component contract by this proposal.

## Source synchronization and limits

The preview consumes the local Hub package and aliases the Hub's installed stylesheet. Proposal sources are explicitly copied into the Hub's `src/proposals/org-guide/` directory. These local dependencies are not a pinned application adoption. Recheck source equality and the canonical package revision after any later edit or copy.

The incumbent `DESIGN.md` already distinguishes its current React catalog from previous application sync styles. That existing divergence is relevant to adoption; this check does not resolve it. No root `DESIGN.md`, Hub source, or `.impeccable/design.json` is changed by this documentation handoff.

This is a source comparison, not an independent browser or release certification. The README records the build thread's checks; browser review must use the final source after reviewer corrections. Role switching is only simulation. Real authorization, storage, published-guide reads, application integration, and staging/production verification remain implementation work after selection.
