# Google font URL compatibility

## Release blocker

Runner Title Case PR #234 is merged at `af73ff1`. Integrated CI run `41474189371` failed twice while building the runner. Tests, typechecks and other CI jobs passed. No staging or production code rollout occurred.

## Verified cause

Next `15.5.22` downloads a valid font, then extracts its extension with an unchecked regular expression in `dist/compiled/@next/font/dist/google/loader.js:122`. Google sometimes returns extensionless `/l/font?kit=...` URLs. The preceding CSS parser discards the `format('woff2')` hint, so the loader dereferences a null match.

The installed production loader reproduces the exact exception offline with a mocked extensionless Google URL and successful font fetch. A live fetch of the upstream example returns a valid WOFF2 binary. Ordinary URL responses explain why unchanged retries sometimes succeed. The exact failing CI URL was not logged, so its response shape is inferred from the matching loader exception and deterministic reproduction.

## Assessment

| Metric | Value | Evidence |
| --- | --- | --- |
| Severity | High | Blocks validated staging and production delivery. |
| Complexity | Low | Known upstream fix; two runtime modules and their declaration. |
| Confidence | High | Same installed loader exception reproduced without network requests. |

## Fix

Backport the Webpack part of upstream Next PR #100158 through pnpm's exact-version patch support. Resolve the extension from the URL pathname, then the CSS format hint, then the upstream WOFF2 default. Pass that extension to the loader and remove its unsafe match. Preserve current families, weights, subsets, font binaries, preloading and self-hosted CSS rewriting.

Next 15.5.28 still contains the faulty loader, so a same-major patch upgrade does not resolve it. Local font vendoring would unnecessarily change asset/configuration scope. No workflow or release protection needs changing. This patch covers the repository's current Webpack builds; revisit it before upgrading Next or adopting Turbopack.

## Verification and plan

1. Add deterministic tests against the installed Next parser and real production loader. Verify failure before patching.
2. Create/register a patch for `next@15.5.22`, including declaration consistency and the lockfile binding.
3. Verify extensionless URLs, query/fragment suffixes, format hints, default format, deduplication, preloading and CSS rewriting.
4. Run frozen installation, both app suites/typechecks/builds and required CI. Review/publish this build fix separately from the name feature.
5. Resume the cumulative Option B release, verify hosted name repair, then request protected production approval after staging acceptance.

## Primary sources

- [Upstream reproduction #99114](https://github.com/vercel/next.js/issues/99114)
- [Merged Webpack fix #100158](https://github.com/vercel/next.js/pull/100158)
- [Pinned parser](https://github.com/vercel/next.js/blob/98a73ea/packages/font/src/google/find-font-files-in-css.ts) and [tests](https://github.com/vercel/next.js/blob/98a73ea/packages/font/src/google/find-font-files-in-css.test.ts)
- [Next 15.5.28 loader](https://github.com/vercel/next.js/blob/v15.5.28/packages/font/src/google/loader.ts)
- [pnpm patch](https://pnpm.io/cli/patch) and [patch-commit](https://pnpm.io/cli/patch-commit)
