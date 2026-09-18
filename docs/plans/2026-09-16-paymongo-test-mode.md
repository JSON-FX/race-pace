# PayMongo test-mode readiness — 2026-09-16

Status: preflight passed; actual provider journey blocked by missing test API key. No provider transactions or hosted changes occurred.

## Verified locally

- Checked configured environment files without displaying secrets. PAYMONGO_WEBHOOK_SECRET is present in the local functions environment; PAYMONGO_SECRET_KEY is absent. Checkout therefore remains on the fake provider.
- Focused regression suite: 31 tests passed across payments, payment-method, processor-fee and payment-report-dates.
- Running payments-webhook endpoint: missing signature, invalid signature, expired signed body and tampered signed body all returned HTTP 401 invalid_signature.
- Valid locally signed unknown QA event returned HTTP 200 and ignored. No registration or payment mutation was requested by these probes.
- Computer attempt to open the PayMongo dashboard was blocked by another Brave extension's open UI. Dashboard login and test account access remain unverified.

## Required to continue

1. Obtain the account's secret test key and place it only in the ignored server environment as PAYMONGO_SECRET_KEY. Do not put it in chat or public Next variables.
2. Confirm test mode before starting the provider-backed functions. Preserve the zero-commission organization configuration.
3. Register a test webhook against a provider-reachable HTTPS endpoint for the tested backend. The current localhost endpoint is not reachable by PayMongo; select a scoped forwarding route or synchronized staging backend before registration. Store that endpoint's signing secret locally.
4. Create a fresh test registration. Complete a PayMongo-hosted test checkout through Computer.
5. Verify webhook delivery, registration/ticket state, provider IDs, actual versus predicted fees, zero commission and payout reconciliation. Exercise failed/cancelled payment, retry, duplicate webhook and asynchronous refund outcomes.

Do not claim a provider pass based on the fake checkout, locally generated signature probes or unit tests. Browser CSV downloads and the existing settlement wording discrepancies remain separate open items.

References checked: [PayMongo webhook concepts](https://docs.paymongo.com/docs/developer-tools-webhooks-key-concepts), [webhook setup and signatures](https://docs.paymongo.com/do/docs/developer-tools-webhook-setup-management). Test and live endpoints are mode-scoped; the signature covers the raw request body and timestamp.

## Provider-backed walkthrough completed — 2026-09-16

The missing-key blocker is resolved. The user supplied a test key in root .env; it was copied into the ignored functions environment without disclosure. PayMongo API authentication returned HTTP 200 and checkout livemode=false. No live transactions were made.

Fixtures: event `b9a29935-bcbd-4ec4-b801-edd79d1e8302`, category `2e26e449-5eb2-4e05-9065-2aafe3446b9b`, existing zero-commission pilot organization. Runner sessions and registrations were prepared through authenticated APIs; hosted checkout was exercised through Computer.

| Check | Result |
| --- | --- |
| GCash test checkout | PASS: registration `8a73ba41-fde2-4d73-b53d-ca244b0f263f`, session `cs_c16e5fc970f71c250ad4b5ab`, paid via Computer. |
| Actual provider notification | PASS: signed checkout notification traversed a temporary webhook-only tunnel and returned HTTP 200. Local payment source=webhook, registration paid, ticket minted. |
| Fee reconciliation | PASS: PHP 1,000 charged, zero platform commission, PHP 25 processing reported by PayMongo, source actual, PHP 975 net. This supersedes the PHP 15 predicted fee for this test transaction. |
| Failed authorization | PASS: second runner `2224256e-19b7-48e1-9a73-17cf6cfc6dd2`, session `cs_c36b79559661c3f7b404014a`, showed expired after Computer selected Expire/Fail. Authenticated payment-verify returned pending; no extra occupied slot. |
| Retry | PASS: fresh session `cs_dcdfc1db53600a516f9bf9d0` succeeded through Computer and provider webhook. One registration/payment, PHP 25 actual processing. |
| Paid event replay | PASS: locally signed replay of the stored provider event returned success without another occupied slot. This is a local replay, not provider redelivery. |
| Test refunds | Provider accepted both PHP 975 requests as pending and later reported succeeded. First ref `ref_58tE2u2m5E8t2w4oDYys7WtY`; second `ref_ZfN4DeEZhZ1YT3Ydbiih8C6y`. |
| Refund notifications before fix | FAIL: second refund produced payment.refund.updated with a refund resource and payment.refunded with a payment resource containing refunds. Both original signed deliveries were acknowledged as ignored. |
| Refund reconciliation after local fix | PASS: captured second-refund notifications replayed with renewed local signatures; first refund reconciled using a provider-retrieved succeeded refund in a locally signed envelope. Both local rows refunded for PHP 975, slots zero. Repeating both captured notifications did not refund twice. Fresh provider delivery after the fix remains untested. |
| Browser ticket return | Not a runner ticket UI pass: the browser held another runner account and correctly could not find this registration. Authenticated owner browser ticket confirmation remains pending. |

### Local patch and remaining blockers

Using the PIV investigation and implementation workflow, normalized the two actual refund payload shapes and retained the legacy synthetic alias. Processing status now maps to pending; unknown provider statuses throw rather than allowing success finalization. See [root-cause analysis](../issues/issue-paymongo-refund-events.md).

The concurrent-request, early-callback, lookup-error acknowledgement and failed-after-success risks remain open. These require durable refund request ownership and reconciliation work before production. No launch-readiness claim.

Temporary webhook `hook_J4K83vsJThTpnkXefkv6C3jm` was disabled through PayMongo (confirmed disabled); its tunnel and relay were stopped. No public forwarding remains. Local test credentials remain configured. To resume original provider delivery, create a new temporary forwarding URL and update/re-enable the test webhook. Hosted Supabase and Vercel were not changed.

### Validation and final environment

- PIV implementation regression: 8 failures before the patch; final focused payment/refund run 55 passed, signed webhook integration run 6 passed (23 unrelated tests filtered out).
- Full backend run: 419 passed, 5 failed, 14 skipped; 8 failed suites including three setup failures. Failures include shared seeded-event assumptions, slot-count drift, cleanup after a missing fixture, payout returned null, and a historical test expecting the retired three-argument payout API to settle. Full gate remains FAIL; these were not silently reset or patched away.
- Review records the separate concurrency/early-callback/terminal-transition findings. Whitespace check passed. No dedicated Deno static typecheck was run.
- Functions restored to the user's PayMongo test-key environment after simulator-only integration tests. The test webhook remains disabled and the temporary public relay/tunnel remain stopped. No hosted deployment, commit or push.
