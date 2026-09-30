# Implementation report — annotated UI polish

Plan: docs/plans/annotated-ui-polish.md. Branch: codex/annotated-ui-polish.

The owner selected always-visible inclusion checklist A. CategoryInclusions now displays the existing ordered text with quiet checkmarks and responsive columns. Empty lists remain omitted. No category parent, admission, registration, payment or backend code changed.

Admin fixes cover all twelve annotations through scoped adapters and existing components: saved background reaches the sidebar with White as default; collapsed logo centers; status dots disappear; checkbox descriptions and Add controls gain spacing; the section rail sticks within the actual admin scroll region.

Completed: 522 runner tests, 1,017 admin tests, 827 backend/shared tests, 13 UI tests; runner/admin/UI typechecks; Fieldnotes source audit; fresh isolated replay of 177 migrations and retired-job/key assertion; Storybook types and four builds. Builds and hosted staging/production browser acceptance are recorded in the release ledger when completed.

Intentional detail: the admin shell now bounds rp-scroll to the viewport so sticky navigation has a real scroll container. This also keeps the header/bottom navigation outside scrolling and needs desktop/mobile acceptance. Native proof verifier used port 3000 and fake-provider functions used only the fresh local project. Its temporary project_id override is excluded from the release.

Scope preserved: unrelated dirty main checkout and Storybook Hub files were retained. Storybook changes consist only of new inclusion proposal/approved stories and source copies. No migrations, hosted records, provider keys, Auth settings or Edge Functions changed.

Both isolated builds passed. The final checklist aligns its label weight, line-height and icon gap with the approved HTML; focused event tests and the runner build are rerun for that final presentation adjustment.

Final checklist checks passed: 39 event-page tests, runner typecheck and rebuilt runner production bundle. Admin build/typecheck passed on the unchanged admin patch. Total full-suite baseline remains 2,379 passing tests. Hosted visual verification is the remaining release gate.
