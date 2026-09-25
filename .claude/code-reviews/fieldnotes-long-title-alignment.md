# Fieldnotes long-title alignment review

Stats:
- Files modified: 3
- Files added: 1
- Files deleted: 0
- New lines: 12 in modified files, plus this report
- Deleted lines: 3

Code review passed. No technical issues detected.

The compact desktop cards reserve the height of three title lines. This matches the longest current staging race name and keeps the date, slot count, distances, and action on a common row baseline. The 390px rule removes all title reserves, including the more specific compact-card rules; Storybook showed `min-height: 0px` on all seven cards and no horizontal overflow. The app stylesheet matches the Storybook source byte for byte. Site typecheck, Storybook typecheck, build, and Docker rebuild passed. Hosted staging visual review remains the release gate.
