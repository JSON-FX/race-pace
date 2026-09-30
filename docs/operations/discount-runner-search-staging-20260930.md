# Discount runner search release — 2026-09-30

Organization admins can find and assign any registered runner by name or email before that
runner participates in an organization event. The former list was restricted to existing
registrations/pre-screening applications; four results reflected that filter, not the limit.

## Reviewed source and local checks

PR #209, reviewed head `39ef2bdaef0bd9f7957e00d668b593dbe727befd`, includes the current staging
payment-recovery baseline from PR #208. The discount diff remains limited to its guarded
lookup, assignment eligibility, picker, regression tests and documentation. No payment,
reservation, commission, table policy, Edge Function or provider changes belong to this fix.

All local checks passed on the combined head: 890 backend/shared tests, 530 runner tests,
1,020 admin tests, and the unchanged shared UI suite's 13 tests (2,453 total). Both app
production builds and app typechecks passed; shared UI typecheck and Fieldnotes audit
passed. All 180 migrations replayed. The local CI assertion used an ephemeral port-only
adaptation (59522 instead of 54522) and verified no retired push job or legacy key.

Independent review was rebound to the combined head and found no high-confidence defects.
Local browser checks at 390, 768 and 1440 pixels verified metadata-name and account-email
search, long-email wrapping, selection retention and successful special-code assignment.
SQL readback confirmed the chosen Passport in an organization with zero events/registrations.

## Hosted staging acceptance

PR #209 merged into staging at `ca2c65fafc0240566ac5f1df0690af4504a250f6`.
Required PR CI `36695382284` and branch CI `36695376674` passed on the reviewed head.
The branch check required an unchanged rerun after the existing Google font-loader failure;
all tests had passed before that build failure. Exact staging-merge CI `36697611359` passed.

Both Ready deployments own the correct staging aliases at that exact staging commit:

- Runner: `dpl_GXtbtQ8cZsqL8MqhrsfmoEr5Wghu`, `staging.racepace.com.ph`.
- Admin: `dpl_8WSiobLbpE4D4A7kZ6egz5teCF5V`, `staging-admin.racepace.com.ph`.

The runner events page and authenticated admin discount page loaded in the browser.
Loaded client bundles from admin registrations and the runner profile reference staging
Supabase and contain no production Supabase project reference. The discount page's
initial scripts do not instantiate the Supabase browser client, so the check includes
loaded dynamic assets from the authenticated client pages.

Migration `20260930083846` is applied; staging now has 180 migrations. Both function body
hashes match the reviewed SQL: `discount_create` MD5 `c26b3bc1e2deeb44c41252bbfc730493`,
`discount_passport_options` MD5 `c8b47da5f2457af4ac2808afcd80d777`. Anonymous execution
is denied and authenticated execution is granted; the internal organization-admin gate
remains in both functions. A private schema backup was refreshed after PR #208's migration.
The CLI reported a catalog-cache certificate warning after applying SQL; independent
migration-history, function-source, grant and browser readbacks all passed.

The original deployed picker successfully found the outside runner immediately after the
migration, proving old-client compatibility before the frontend changed. The new hosted
admin then passed email search, name/email display, selection retention through an empty
search result, and generation of one assigned 20% special code. SQL confirmed its assignment
to the intended Passport with zero organization registrations and applications.
Test code `9D06B60A075A4868AA03` (`cc9bfd13-5b64-4dd9-ba17-c457bae1063d`) was deactivated
after acceptance. It was never redeemed; no payment was created. Fixtures remain clearly
synthetic in staging for audit.

All 36 staging secret fingerprints are unchanged by this fix. All 34 Edge Function versions
and JWT settings match the snapshot after the concurrent payment-recovery deployment.
Security advisor categories and levels are unchanged; no ERROR finding. This fix changes
no provider configuration or function bundles. Payment provider acceptance remains covered
by the separate payment-status-recovery staging record.

A dedicated synthetic staging runner `discount-search-outside-20260930@example.invalid`
was created without sending email. Its Passport is `b4b1b33a-ab3e-448a-801a-e991a2edb5b0`;
organization `21a2410a-a918-4ec2-b3d6-71d0af752109` has zero registration/pre-screening
records for it. It exists solely to verify assignment before organization participation.

## Production boundary

No production code, Passport, registration or payment is created for automated acceptance.
Production promotion must include validated evidence for the concurrent payment-recovery
change already in staging. The runner-search fix alone requires no function/provider deploy.
