# Reservations category slots release — September 30, 2026

## Authorization and scope

The owner requested immediate direct production deployment followed by staging synchronization. This instruction is a scoped exception to staging-first timing for this application-only follow-up. Additional local test suites remain explicitly waived; enforced GitHub branch checks are unchanged. No migration, Edge Function, provider, secret, payment or reservation mutation is included. No production fixtures were created.

Implementation source: `c4c63d89cf771ca83a15445c80ff2394fdbf435f`, feature PR #217 into staging, based on synchronized staging `0d48c999ba713a4ed236fd4367ed5eac6e00ba66`. Main baseline `1b26152413af70fef1a969fa431d00ba58d0ce47` was an ancestor of staging before work began.

## Direct production delivery

The PR validation run `36729718182` passed all 2,483 tests (shared UI 13, runner 548, admin 1,032, backend/shared 890), both application builds, typechecks and migration replay. The duplicate push run `36729710438` passed its tests but failed in the pre-existing runner Google font loader (`next/font`, null reading 1). The unchanged run passed on attempt 2. GitHub refused the protected merge while that duplicate was failed; no protection was bypassed.

To fulfill the owner's direct-production instruction without waiting for that duplicate, both existing Ready preview sources were rebuilt with the production target. Preview artifacts were not promoted because they embed staging database identity.

| App | Production deployment | Commit | State | Alias |
| --- | --- | --- | --- | --- |
| Admin | `dpl_F1VNg6gWrtWm9tbxQU9PwfESUYog` | `c4c63d89cf771ca83a15445c80ff2394fdbf435f` | Ready | `admin.racepace.com.ph` |
| Runner | `dpl_5fzoEmA1BrZGRtdjEmgPMoZAiKy4` | same | Ready | `www.racepace.com.ph`, `racepace.com.ph` |

Both served bundles reference only production Supabase `whaqarofxdlzxrelbcrq` (admin 18 scripts; runner 25 scripts). The live authenticated Reservations page displayed the selected Point Run Series event's cards. Fresh read-only RPC evidence matched every displayed number:

| Category | Total slots left | General slots left | Reservation slots left |
| --- | --- | --- | --- |
| 70k | 139 | 100 | 39 |
| 42k | 135 | 100 | 35 |
| 25k | 241 | 150 | 91 |
| 13k | 95 | 50 | 45 |
| 7k | 79 | 30 | 49 |

These are read-time values, not fixed fixtures. Production search produced the no-matching state without changing capacity cards. Actual desktop and 390px phone captures passed; no page-wide overflow at 390px. Evidence is private local screenshots under `/tmp/reservation-slots-proof/`. The existing capacity RPC already includes registration, reservation and screening claims with conversion de-duplication.

## Validation and backend boundary

Admin typecheck and isolated production build passed. Fieldnotes audit: 325 current modules, 256 audited, zero native/dedicated sites or duplicated primitives. Impeccable detector: no findings. Hub typecheck and all four catalog builds passed; Docker catalog rebuilt. Bounded prototype review passed at 1440, 768, 390 and 320px, including zero, disabled and unavailable states, long labels, search stability and organization reset. Prototype proof is visual/local state evidence, not a hosted tenant-security test.

Both Supabase projects still have 180 migrations, latest `20260930083846`; authenticated execute on `category_availability(uuid)` was read back. No Supabase migration, Edge Function or provider configuration was deployed. Staging existing QA category returns 9 total/general and 0 reservation slots with reservations disabled. Hosted staging authenticated business journeys were not repeated under the owner's urgent-release waiver.

## Synchronization

After production verification, both apps were rebuilt with custom target `staging` at the same source. Admin `dpl_FuVsKkuFeK4CNh2qSLB3uJ1nd4kx` and runner `dpl_DGv5G9fAaceJSGDzjrGMc5qeCh9K` are Ready. Their staging aliases point to these deployments. Both bundles reference only staging Supabase `pepbmqomiailnnvvwupz` (18 admin and 25 runner scripts). This synchronizes hosted application source without sharing database identities or data. Protected Git reconciliation and final automatic deployment readback remain pending.

PR #217 merged at staging `68b685abb2a5a9a8e7fd94446bea71a525a5e3c0`, September 30 14:56:43 UTC. Its required PR and feature checks passed. The stage merge changes no application source from the directly verified `c4c63d8` deployment. Automatic merge deployments and protected main reconciliation are pending.

Automatic staging deployments at merge `68b685abb2a5a9a8e7fd94446bea71a525a5e3c0` are Ready: admin `dpl_DNoaNHf4uHvQrNdgoLrcC7vSPMpW`, runner `dpl_ENPeuuXzrtvJaU5DLJMLUyktsSt6`. Both staging aliases match. Fresh served bundle reads reference only the staging project. Anonymous admin Reservations redirects to sign-in (307). The merge's apps/packages/backend tree exactly matches the verified direct source.

## Protected main alignment and final sync

PR #218 merged staging into main at `f2f1b3e662b637d192471bdb44320831dad75fc6`, September 30 15:10:21 UTC. Required staging run `36732955338` and PR run `36733343759` passed. Main introduces no application/backend content beyond the directly verified source.

Both exact main deployments are Ready with production aliases: admin `dpl_Dwv8fgEdmgdycgi5k21ythcPTnsX`, runner `dpl_6E6iKsTdXzLEJxpd46yKqSuazCF6`. Fresh served bundle reads reference only production Supabase (18 admin scripts and 25 runner scripts). Authenticated final-commit readback again matches all five category values. The live 25k count changed to 239 total, 150 general and 89 reservation slots during the release as real runners booked; a fresh RPC read matched. Other category values remained unchanged at read time. No production fixture or payment was generated by this task.

The accompanying evidence-only staging PR includes main as an ancestor and changes no application, package, Supabase or dependency source. Merge it after required checks to restore the main-to-staging ancestry contract. Final sync merge ID, ancestry and automatic staging deployment readback are recorded on that PR after completion. The direct production exception applies only to this owner-authorized urgent follow-up; the default release policy remains unchanged.
