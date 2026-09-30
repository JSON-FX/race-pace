# September 30 approved UI release

## Scope

All completed and approved session changes: flat forest rounded-rectangle runner navigation with larger phone icons and mobile logout; forest admin selection and reservation actions; aligned forest-border race cards; organizer avatars; commission spacing; completed-event profile activity beneath Race Passports with upcoming registrations and screening updates; centered scrollable registration inspector with data-cell opening; Coming Soon positive category registration fees; dedicated event-selected Reservations workspace.

Reservations has one checkout per row, booking-account identity and avatar, managed participants beneath it, categories, payment status/date, entry deadlines, paid amount, and four whole-event summaries. Organization changes invalidate an event from the previous organization. Search and payment filters do not change the summary totals. Production is real data; this release creates no fixtures or financial transactions.

Profile activity uses paid entries in completed events because individual finisher outcomes and geographic achievements are not stored. The per-category organization dashboard remained a placement discussion; no unapproved dashboard was added.

## Source and validation

Feature commits: `490da7e`, `adebd43`, `97f378e`. Integrated source `71ae4739f8208c223ba95bb1f26be42358760fef`. PR #214 merged into staging at `ee0a7f952762453dac672c1f0cc135fdf410ed42`.

The owner explicitly requested urgent production release and waived additional local suites. Both integrated app typechecks/builds and the Fieldnotes source audit passed. Enforced GitHub CI passed 2,483 tests on source and PR #214. Local responsive browser acceptance and fresh design finish review passed, including corrected dark contrast. Existing CI and branch protection were preserved.

## Staging

| Application | Deployment | Source | State and alias |
| --- | --- | --- | --- |
| Admin | `dpl_5aRJy2grWgrmcJfVAHbHNSJ9yA52` | `ee0a7f9` | Ready; `staging-admin.racepace.com.ph` |
| Runner | `dpl_9tgddTvRUmQMGm1uti9bB6rjqVtR` | `ee0a7f9` | Ready; `staging.racepace.com.ph` |

The original runner deployment `dpl_9Qku2dAFkh9Seu5DsdwekdbgKXh6` failed in the existing Next Google Fonts loader. An unchanged cache-free redeployment passed. Exact deployment reads returned the expected anonymous admin sign-in redirect and rendered the registration fee on the existing staging Coming Soon event. Both deployed browser bundles reference staging Supabase `pepbmqomiailnnvvwupz`. Additional authenticated hosted acceptance was waived for this application-only release.

## Backend boundary

Both hosted migration histories were read: 180 versions, latest `20260930083846`, preceded by `20260930081626` and `20260930053856`. Production retains 33 Active functions; staging retains 34, including its existing fake-checkout. No migration, function, provider, secret, auth or deployment configuration changes are included. Existing production live and staging test provider boundaries are retained; no new provider transaction was performed.

## Production

PR #215 merged staging into main at `1b26152413af70fef1a969fa431d00ba58d0ce47`. Staging branch CI `36719389132` and production PR CI `36719470962` passed, including 2,483 tests and both builds.

| Application | Deployment | Source | State and aliases |
| --- | --- | --- | --- |
| Admin | `dpl_FT7CQkJWVZPbhPVZWcJqHJk9b4mH` | `1b26152` | Ready; `admin.racepace.com.ph` |
| Runner | `dpl_2vmeRoiPWsecFYQ5Kg6XfujjnNHp` | `1b26152` | Ready; `www.racepace.com.ph`, `racepace.com.ph` |

Both production bundles reference Supabase `whaqarofxdlzxrelbcrq`. Authenticated production readback matched the fresh database aggregate: Kibalabag has 29 checkouts, 23 paid, 506,243 centavos collected, and six pending at read time. One checkout became paid during delivery; the earlier 22/485,115/seven snapshot is historical. No payment was initiated by this release.

Verified all eight roster columns, actual paid dates, a managed group under one checkout with 42,256 centavos shown once, unchanged summary totals after search, and event/roster reset after organization switching. Clicking a registration category cell opened the new inspector. Its live 760px dialog is centered with 16px vertical gutters at 1280×720; content scrolls inside while header/footer remain visible. The live Coming Soon event now shows fees of ₱4,700, ₱3,500, ₱2,500, ₱1,700 and ₱1,500 for its five categories. User-facing production screenshot retained privately at `/tmp/racepace-release-proof/reservations-production.png`.

Additional hosted phone viewport verification was unavailable in the hidden browser tab: the viewport remained 1280×720 after requesting the override. The override was reset. Earlier actual local desktop/tablet/phone acceptance remains recorded in the feature reports; no new production mobile result is claimed.

## Synchronization

The release sync branch merges exact production main into staging with no application/backend changes and adds this evidence record. Final synchronization PR and ancestry readback are recorded in the delivery reply after the protected merge completes.
