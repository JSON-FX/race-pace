# Export stream loses authenticated request scope

Live authenticated local GET /payments/export aborted after the CSV header. Docker log: cookies was called outside a request scope, via listOrgPayments → createClient from stream pull. Registration export has the same dependency in email lookup and later batches; a three-row success does not prove larger streams safe.

High confidence, high severity for reporting, low complexity. Capture one caller-authenticated Supabase client inside GET before returning the stream. Inject it into every deferred query. Keep RLS, org authorization and streaming backpressure unchanged. Query helper defaults continue supporting ordinary pages. Regression: consume stream after marking request scope closed; client factory must have run once before GET returns and the identical client reaches every batch. Validate local North and South exports and numeric reconciliation. Settlement timestamp inaccuracies are a separate remaining finding.

## Fixed locally

Captured the caller's DB client in both export handlers before creating ReadableStream. Payment/registration batch helpers and the registration email lookup accept this client; normal page defaults unchanged. Regression consumes 1,001 rows across two deferred batches and asserts the same captured client throughout. Full admin suite: 741 passed; admin typecheck passes; final focused export suite: 30 tests. No service-role client is used for export reads.

Live requests were made as independently authenticated North and South organizers. North registration and payment endpoints both returned complete HTTP 200 CSVs, three rows each. South returned header-only CSVs for both, including an explicit request for North's event ID. Files: /tmp/rp-north-registrations.csv, /tmp/rp-north-payments.csv, /tmp/rp-south-registrations.csv, /tmp/rp-south-payments.csv.

Totals: CSV PHP 3000.00 gross, 90.00 commission, 2865.00 organizer net. Database integer-centavo totals: 300000 gross, 9000 commission, 4500 processing, 286500 net. New runner names and bib snapshots appear; the original pre-fix sample has no recoverable full name. Browser re-test with Computer still receives Brave ERR_BLOCKED_BY_CLIENT for download navigation; this is not claimed as a completed browser download.

## Separate report findings

Settlement toSettlementRow labels payment.created_at as paid_at, although payment creation precedes confirmation. It always emits refunded_at=null even though refund RPCs stamp raw.refunded_at. Current paid sample raw data contains no reliable capture timestamp, so existing values cannot be safely relabeled or backfilled by guesswork. A follow-up needs authoritative confirmation timestamps for new payments and explicit legacy handling, plus refund timestamp extraction and reconciliation tests. General Payments CSV also omits a separate processor-fee column; the missing PHP 45 is stored correctly but is not directly explained by that export's displayed columns.
