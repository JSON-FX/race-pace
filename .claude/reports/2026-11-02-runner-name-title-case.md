# Runner name Title Case implementation

Implemented locally on `codex/runner-name-title-case`, based on `81e6f46` in an isolated worktree. The shared checkout's unrelated edits were preserved. Sol extra high was retained as requested.

## Behavior

Saved runner first/last/full names use Title Case. The shared Passport schema and its identical Edge mirror format incoming single/group registration names. Database triggers cover direct profile/Passport writes and registration/reservation/screening labels. The additive migration repairs existing rows.

The platform account list formats Google `full_name`/`name` fallback values. Google metadata itself remains unchanged. The runner profile banner now displays saved casing instead of forcing uppercase.

Hyphens, apostrophes, accents and final Roman suffixes are covered. The formatter is repeatable across client and SQL implementations. Bib names, team names, emails, emergency contacts, provider records and immutable evidence retain their values.

## Local verification

| Check | Result |
| --- | --- |
| Runner unit/component suite | 555 passed |
| Admin unit/component suite | 1,089 passed |
| Shared UI suite | 13 passed |
| Backend/shared contract suite | 1,056 passed; 119 files |
| Runner/admin/shared UI typechecks | Passed |
| Runner production build | Passed |
| Admin production build | Passed |
| Frozen dependency graph for every Edge entry | Passed |
| Changed Edge helpers plus single/group checkout Deno checks | Passed |
| Fieldnotes component audit | Passed |
| Security advisors | No issues found |
| Migration replay | 183 versions; no retired push job or legacy service key |
| Function privileges | Authenticated formatter allowed; anonymous formatter/direct authenticated trigger denied; service-role trigger allowed |
| Whitespace/error check | `git diff --check` passed |

Backend validation uses a dedicated Supabase project `racepace-title-case` on API/DB ports 59521/59522. It does not reset existing task stacks or connect to hosted services. The normal CI assertion's 54522 port check was adapted in an ephemeral read-only check for this stack; no repository safety check was weakened.

Required CI-equivalent checks pass, totaling 2,713 tests. The broader all-checks verdict remains FAIL because two supplemental typechecks fail identically on unchanged `main`: shared `discounts.ts:88` (`TS2345`) and the full platform-users endpoint at line 265 (`TS2322`). These are documented in the review. The changed Edge modules and checkout entry points pass Deno checking.

Both final production builds ran with their dev servers stopped and passed. After a database reset recreated Auth at a new container address, this task's gateway was restarted and its healthy connection verified before the final suite.

## Browser evidence

Used Browser/Computer through the in-app browser, with a synthetic local account and Cloudflare's documented dummy widget key. No Playwright plugin fallback was used.

1. Signed in through the real local runner form.
2. Submitted `BERNADETTE` and `CUTAMORA III` through Save Passport.
3. Observed `Passport saved.` and returned fields `Bernadette` / `Cutamora III`.
4. Verified `Bernadette Cutamora III` in the banner and a separate authenticated admin Users read.
5. Verified the banner's computed text transform is `none`.
6. Checked actual browser widths 1280, 768 and 390. Saved screenshots show the existing responsive layout and normal phone truncation.

Evidence: [admin list](assets/runner-name-title-case/admin-users.jpg), [desktop profile](assets/runner-name-title-case/profile-desktop.jpg), [tablet profile](assets/runner-name-title-case/profile-tablet.jpg), [phone profile](assets/runner-name-title-case/profile-mobile.jpg), [phone admin](assets/runner-name-title-case/admin-mobile.jpg).

Google metadata normalization is covered by helper/endpoint tests. An actual Google OAuth login was not performed. Single/group registration handlers and database writes were exercised by automated tests; browser registration/waiver/payment submission was not performed for this casing change.

## Delivery state at the local implementation checkpoint

At this checkpoint there was no commit, push, pull request or hosted mutation. The owner subsequently authorized publication through staging and production on 2026-11-02. Existing live names will change only after deploying migration `20261102143802` and the changed platform-users function. Hosted staging acceptance remains before the protected production approval. Both apps must use their matching environment configuration. The synthetic UI account was removed by the final local reset; task-local services were stopped after validation.

References used for test setup and database boundaries: [Supabase user data](https://supabase.com/docs/guides/auth/managing-user-data), [Cloudflare test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
