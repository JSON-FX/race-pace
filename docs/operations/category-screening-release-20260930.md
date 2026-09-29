# Category reservations and pre-screening release — 30 September 2026

Status: hosted functional acceptance passed; exact revision CI and final production preflight remain required.
Owner deadline: 07:20 Philippine time. A deadline does not waive a required check.

## Reviewed source and deployed applications

Feature PRs #188–192 merged through staging. Current application/backend source is
`12cc81ab94a50368c3f07bc248454785ad667122` (PR #192). The two feature checks
`36634982101` and `36635008116` passed. Exact-merge CI `36636073092` passed tests/typechecks but hit the known intermittent next/font Google loader error. An unchanged-source retry is running; production waits for a passing run.

| Application | Deployment | State and alias |
| --- | --- | --- |
| Runner | `dpl_3MA9v5LiDZq521Rtpuc34jsj7EFZ` | Ready; staging.racepace.com.ph |
| Admin | `dpl_J7kmLDp8FE9V8KmoarSvCdimZM5f` | Ready; staging-admin.racepace.com.ph |

Vercel API independently confirmed both commit identities, Ready state and aliases.
The final release-record commit changes documentation only. Compare application/backend trees
before promoting that record; do not treat a different source tree as tested.

## Local and design gates

- Fresh replay of all 177 migrations and legacy 170-slot event upgrade rehearsal passed.
- Final runner 522, admin 1,017, backend/shared 827 and shared UI 13 tests passed.
- Both application and shared UI typechecks, Fieldnotes audit and both isolated production builds passed.
- Storybook proposal typecheck and four catalog builds passed. Approved forms retain the Fieldnotes
  shell, payment artwork, dotless badges and scoped layout. Desktop, tablet and mobile status views
  were checked in Browser, including keyboard focus and the proof dialog.
- Browser has no reduced-motion emulation. A narrowly scoped Playwright fallback loaded the
  rendered staging form and its actual compiled screening CSS into an isolated fixture. With
  reduced motion enabled, all 92 elements had no animations or transitions. This is rendered-style
  acceptance, not an authenticated hosted Playwright journey.

## Hosted acceptance

All payment fixtures use PayMongo test mode. No production financial operation was performed.

| Scenario | Evidence and result |
| --- | --- |
| Category setup | Browser saved two 12-slot categories, different fees/inclusions, six reservation slots each, separate deadlines and screening only on 70K. Coming Soon and open publication passed after correcting the obsolete hidden total-slot validator. |
| Mixed own/managed group | Own 70K proof and unscreened managed 21K acquired holds together. No payment during review. Partial approval retained all holds and no payment deadline. |
| Reservation and full entry | Order `fbb07bc7-589b-49ef-8e27-b0ab5f47fefe`: paid 80,000-centavo reservation fees, then separate 500,000-centavo full entry. Provider captures were fulfilled with livemode=false. Exactly two claims remained after conversion. Reservation fees were not deducted. |
| Ticket, kit and check-in | Group ticket delivery sent; QR rendered. Synthetic 70K runner kit release and check-in succeeded in admin. |
| Individual rejection | Batch `4cd0a895-b8c8-4faa-9777-07dbfb456e4f`: reason required; rejection released only the booking runner. Managed Passport retained its hold. |
| Alternative category | Rejected runner obtained 21K registration `c35080f6-230e-4a52-8ef1-09a7018b667e`; original managed runner's group deadline stayed `2026-10-02T20:39:53.590339Z`. |
| Payment timer and resends | Ready at `2026-09-29T20:39:53.590339Z`; deadline exactly 72 hours later. Browser resend enforced five-minute rate limiting, then queued successfully without changing deadline or claims. |
| Submission and decision email | Six observed screening email jobs sent on their first attempt without delivery error. Submission goes only to the booking runner and lists all Passports. Approval and rejection delivery were verified with the staging provider. |
| Last-slot contention | Concurrent hosted submissions yielded one winner and one capacity rejection (23514), with exactly one claim. Synthetic hold cancelled and event returned to draft. |
| Deadline rules | Rollback-only hosted SQL proved unsold reservation allocation returns to general capacity while existing holds remain; conflicting full-payment deadline blocks approval until extended; approval replay does not restart the timer; held-category deletion is denied. |
| Provider uncertainty and expiry | Rollback-only hosted SQL retained unresolved provider holds, routed late capture into review, and released confirmed-expired unpaid holds idempotently. |
| Private proof access | Real unrelated-runner/organization JWT requests to proof view/verify/prepare returned 403; anonymous request returned 401. Temporary identity removed. Database policies denied raw proof/storage reads. |
| Upload-only behavior | Verified uploads created no applications or claims. Only successful request submission acquired slots. |
| Refund | Browser GCash test order `7fbf0e0a-2fa0-4de5-bccf-d4d9847fbaa5` paid 20,000 centavos for two participants. Managed participant refund `a9c1479e-2d50-4efb-9d9e-d467f6576e93` succeeded for 7,450 centavos, provider `ref_x5PuiCYGmiJSwdbAWz1AKm18`, livemode=false. Only Mika became refunded with no ticket; the sibling remained paid with its QR ticket. Exactly one capacity claim remained. Browser reloaded registration and booking views confirmed the result. |

Rollback-only hosted acceptance SQL is saved under `acceptance/`. It must never be run on production.
Browser screenshots and private provider evidence are kept outside Git under `/tmp/racepace-staging-*`.

## Proof contract and native verification

JPEG, PNG and WebP are limited to **10,000,000 bytes (10 MB)**. The owner explicitly removed the
custom 20-megapixel limit. Native codec safeguards remain; no application-level 20 MP cap exists.

The prior WASM decoder exhausted hosted Edge memory. PR #191 moved full decode into a private
Node/Sharp helper. Edge still authorizes identity/ownership and binds image bytes with SHA-256.
Signed proof URLs expire after 120 seconds. The helper restricts origin/path, refuses redirects,
bounds response bytes and serializes image decoding. The helper secret is distinct per environment.

Actual staging Browser verification passed:

- 48 MP PNG: upload `ab848faf-6373-499a-a48f-7f2ee7ba27e0`.
- 48 MP JPEG: upload `77a2412c-05dd-4319-b863-213b1a27033f`.
- Exactly 10 MB PNG: upload `d1c600aa-7df2-475f-a053-f34b28b7c321`.
- 10,000,001 bytes rejected with submission disabled.
- Truncated PNG rejected by server; retry remained blocked; valid WebP replacement succeeded.

Hosted resumable protocol acceptance used a disposable staging account. It stopped after 6,291,456
of 10,000,000 bytes. Verification returned 409 while incomplete. Reconnected HEAD returned the
same offset; PATCH completed, verification returned 200, and applications remained zero.
The script removed its object, upload row and identity afterward. This is an actual hosted TUS
interruption/resumption check, not a simulated browser offline toggle.

## Backend and environment evidence

Staging project: `pepbmqomiailnnvvwupz`; production: `whaqarofxdlzxrelbcrq`.
Staging has 177 migrations through `20260929191739`. The private proof bucket cap is 10,000,000.
Full function versions, hashes and JWT settings are in
[the function snapshot](category-screening-staging-functions-20260930.json).

`prescreening-proof` v3 is Active with JWT verification; bundle hash
`58b113bce858c2505e04c667001c3e6cb11c1a5e765ab66badee13129ff619f6`.
The initial deployment without an import map failed without replacing the live version.
The successful deployment explicitly supplied `supabase/functions/deno.json`.

The changed dependency closure contains 18 function slugs: group-reservations, payment-verify,
group-payment, prescreening-maintenance, group-ticket-delivery, registrations-checkout,
send-ticket-email, organizer-inquiry, prescreening-proof, coming-soon-delivery, fake-checkout,
expire-coming-soon-reservations, reprice-event-checkouts, expire-paymongo-checkouts,
reservation-verify, reservation-checkout, payments-webhook and prescreening-submit.
The hosted fake-checkout guard returns 404 and is never used for hosted acceptance.

Readiness/expiry SQL runs every minute. Authenticated screening maintenance runs every five minutes.
The maintenance HTTP probe returned 200; unauthenticated invocation returned 401. Scheduled executions
were observed. Existing expiry worker secret and Vault credential digests match in each environment.
PayMongo test/live key and webhook fingerprints are distinct. Resend sender/key fingerprints remain
separate. Neither Vercel project sets SUPABASE_INTERNAL_URL.

Security advisor differences were reviewed: service-only cleanup/history tables intentionally have
RLS with no client policy; aggregate category availability is deliberately public for published events.
Authenticated screening RPCs enforce identity and tenant checks, covered by grants/access tests.
Pre-existing pg_net placement and leaked-password-protection warnings were not changed.

## Production baseline and recovery

No production change has been made. Main is `7577ded79dd1fa3a29ff7e916445342f3037b759`.
Fresh read-only inventory supersedes the planning snapshot:

- Yalabyalam Backyard Ultra, event `3f29e7df-fe90-44a6-bfa4-219ffeaad816`, open.
- One category `249c15d3-d034-4622-9fb4-00faf1484a62`, **140 slots**, entry price 170,000 centavos.
- 16 paid, six expired, three cancelled registrations; no reservations; eight ordered inclusions.
- 159 migration versions before this release. Paid provider records identify livemode=true.

Private logical backups completed successfully. Data SHA-256:
`4e7222752ec246fa52d1e79caebe63a5dec2114c57536ce595bd9c9766811118`.
Schema SHA-256: `6ccf68c5eb9305048ef42242869ecade212858926210dc5a11c12ade50bee2ba`.
Files are outside Git with mode 0600. A restore was not performed. Repeat the baseline immediately
before promotion and preserve legitimate registrations arriving during the release.

The earlier QR Ph test refund failed closed. Provider readback showed zero refunds; replaying the same synthetic request returned HTTP 400 `parameter_invalid`: refunds are not allowed for source type qrph on this staging account. No live request was made. The unknown local test request remains preserved for audit, with both original entries and claims intact. The supported GCash refund above verifies the application path; this does not establish QR Ph refund support for either merchant account. The signed-in Point Sports dashboard test key differs from the staging merchant credential, so verification used the matching configured staging key without changing provider settings.

Production promotion remains blocked until exact-revision CI and the final preflight pass.
Then use staging → main, additive backend before dependent apps, new admissions paused through
helper/function bootstrap, read-only production verification, and main → staging synchronization.
Keep additive schema and forward-fix if older code cannot understand newly created holds.
