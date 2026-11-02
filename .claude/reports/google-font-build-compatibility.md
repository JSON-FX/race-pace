# Google font build compatibility

Date: 2026-11-03 (Asia/Manila)

## Result

Backported the upstream Webpack font URL fix to the installed `next@15.5.22` using pnpm's native patch support. Both Next applications resolve the patched package. Current font families, weights, subsets, preload behavior and self-hosted output are unchanged.

The [investigation and plan](../../docs/issues/issue-google-font-build-compatibility.md) records the deterministic reproduction, primary sources and maintenance boundary. No application dependency version, release workflow or protection was changed.

## Validation

| Check | Result |
| --- | --- |
| Actual installed parser/production-loader regressions | All 11 failed before the patch; all 11 pass afterward. |
| Frozen pnpm installation | Passed with an exact-version patch and lockfile hash. |
| Runner suite and typecheck | 566 tests passed; typecheck passed. |
| Admin suite and typecheck | 1,089 tests passed; typecheck passed. |
| Shared UI suite and typecheck | 13 tests passed; typecheck passed. |
| Fieldnotes source audit | Passed; 325 current modules, no unresolved native controls or duplicate primitives. |
| Both production builds | Passed against local-only configuration. |
| Frozen Edge dependency graph | Passed. |
| Isolated database replay | All 183 migrations; no retired push job or legacy vault key. |
| Backend/shared suite with fake providers | 1,056 tests passed across 119 files. |
| Diff whitespace | Passed. |

The regression uses the actual installed CommonJS loader with mocked successful Google CSS/binary fetches. It verifies extensionless and query/fragment URLs, format mapping, WOFF2 fallback, deduplication, subset preloading and emitted CSS rewriting. It does not claim to reproduce the exact unlogged Google response from the failed CI run.

Overall local validation: PASS, 2,724 tests across both apps, backend/shared and UI. The backend proof helper ran in Next development mode after both production builds completed. All database, Edge and proof traffic used the isolated task stack and fake providers.

## Delivery boundary

Runner name PR #234 is already merged. Its initial integrated build failures prevented hosted rollout. This separate build fix must pass review and CI before the cumulative Option B staging release can proceed. Hosted name acceptance and protected owner production approval remain separate gates. No production data was changed by local verification.
