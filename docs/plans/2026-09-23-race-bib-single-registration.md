# Race Bib single registration implementation

## Scope and references

Implement the approved [Race Bib preview](../previews/register-single-prototypes/02-race-bib.html) in `apps/site`. The [design specification](../specs/2026-09-23-race-bib-single-registration.md) fixes the layout and behavior. No user clarification remains open: approval covers the visual direction, and the existing server checkout and payment routes fix the data and failure contracts.

Read before editing: `apps/site/app/register/[categoryId]/RegisterWizard.tsx`, `apps/site/app/register/[categoryId]/page.tsx`, `apps/site/app/pay/[registrationId]/PayPanel.tsx`, `apps/site/components/StepRail.tsx`, `apps/site/components/PaymentLogos.tsx`, `apps/site/components/RefundNotice.tsx`, `apps/site/lib/registration.ts`, `apps/site/lib/profile.ts`, and the current tests beside both flows.

## Tasks

1. **CREATE shared Race Bib shell.** Translate the preview's masthead, step rail, white task card, and pale summary to a reusable component and scoped styles. Use real event/category labels, dates, places, and prices. Keep the generated hero as an optimized WebP in `apps/site/public/registration`. Validate with the site typecheck.
2. **UPDATE Details, Kit, Confirm.** Keep `RegisterWizard`'s draft, Passport validation, custom fields, add-ons, waiver, idempotency, and error behavior. Map each step's content to the approved section hierarchy and card spacing. Use saved profile avatar for self-registration; do not use the fictional preview avatar in production. Validate focused wizard tests after the change.
3. **UPDATE Pay.** Keep every eligibility guard and `createMethodCheckout` behavior. Present the Race Bib shell, accurate fee lines, refund policy, and existing payment method artwork. Keep hosted method choice on PayMongo and local fake-provider selection usable. Validate focused PayPanel tests.
4. **UPDATE supporting documentation and tests.** Add tests for the live avatar fallback and payment artwork if needed. Update `docs/README.md` and `docs/operations/launch-progress.md` with completed status and release evidence. Validate the site test suite, site and web typechecks, repository test suite, builds where the local environment permits, and `git diff --check`.
5. **REVIEW visually and release to staging.** Compare desktop, tablet, and phone layouts with the approved preview. Review the full diff and document any intentional deviation. Commit the isolated branch, open a pull request into `staging`, pass local and GitHub gates, merge, then verify exact staging deployments and public/authenticated staging behavior without touching production.

## Constraints

- No synthetic records in production and no real payment test.
- Do not change backend, schema, payment arithmetic, or provider contracts.
- The selected preview's optional photo pack is an illustration. The live UI renders only organizer-configured add-ons.
- The approved preview's sample runner details and image remain documentation only.

## Validation

`pnpm --filter site typecheck`; `pnpm --filter site test`; `pnpm --filter web typecheck`; `pnpm --filter web test`; `pnpm test`; site and web production builds in the approved local environment; responsive browser checks at 375, 768, 1024, and 1440 pixels; `git diff --check`.

## Open questions

None. The approved prototype and current checkout contracts settle the implementation.
