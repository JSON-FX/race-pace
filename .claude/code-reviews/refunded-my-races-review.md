# My Races inactive-entry review

Staging reproduction on 2026-09-18: the fully refunded `[TEST] Staging Payment Failure Race` appeared inside Upcoming · 6, despite its ticket being invalid. The list partition at `apps/site/app/races/RacesList.tsx` considered only the future event date. This was a presentation error, not a payment or slot mutation.

The fix partitions refunded, cancelled, expired and lapsed pending entries into Inactive before applying the date split to active entries. It preserves history and the re-entry guidance for expired holds. A paid future race stays Upcoming; a paid past race stays Finished. The footer now calls the QR a race pass instead of a bib.

**Stats:** 3 files modified, 0 added, 0 deleted, 40 insertions, 16 deletions.

Code review passed. No technical issues detected. Focused My Races tests passed 15/15 and site typecheck passed. Live staging and narrow-viewport confirmation remain after deployment.
