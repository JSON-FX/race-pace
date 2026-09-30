# Payment synchronization recovery

Use the environment identities in [release workflow](release-workflow.md). Deploy the reviewed
migration and `reconcile-payments`, plus affected existing Edge bundles, before scheduling it.
Keep the existing PayMongo expiry worker secret within its own environment; this worker uses
`PAYMENT_EXPIRY_WORKER_SECRET` and Vault's `paymongo_expiry_worker_secret`.

## Schedule

Create `paymongo-payment-reconciliation` every five minutes in each deployed environment.
Its command is `net.http_post` to that project's `/functions/v1/reconcile-payments`, with JSON
content type and Authorization built from the existing Vault secret. Use a 120,000 ms HTTP
timeout; at most 20 checkouts are processed with four concurrent provider reads. Do not print
Vault values. Verify the returned HTTP result, durable outcomes and heartbeat immediately.
The migration separately installs `payment-reconciliation-health` every five minutes.

## Recovery and evidence

1. Read the exact stored provider checkout and provider payment. Require the correct mode,
   currency, payment identity, gross, fee, net and capture timestamp.
2. Run the authenticated worker. It uses the existing atomic reservation, single or group
   settlement flow. Never directly set payment/registration status to paid.
3. Read payment, capture, reservation/registration and authorized administrative report rows.
   Compare gross minus provider fee minus platform fee to organizer net. Keep reservation fees
   separate from entry fees. Confirm pending unpaid checkouts remain unpaid.
4. After the handler passes staging, restore the existing live webhook. Preserve refund events.
   Read back its enabled status and real provider delivery response. Enabling a webhook alone
   does not replay missed events; reconciliation is still required.
5. Audit failed, expired and superseded checkouts during incident recovery. Do not clear review
   holds, manufacture captures, create production fixtures or trigger a real test charge.

## Alerts and troubleshooting

`payment_reconciliation_checks` stores leases, attempts and outcomes without provider secrets.
`payment_reconciliation_health` stores the last completed worker run and provider health issue.
Platform operators receive deduplicated payment-review notifications for disabled/missing webhook
delivery, unavailable health checks, a worker stale for 15 minutes or overdue reconciliation.
Inspect provider availability, function logs, `cron.job`, HTTP responses and these tables.

An unpaid provider checkout can legitimately stay pending. A provider failure keeps the ledger
unchanged and retries. Durable capture review outcomes stay held for operator investigation.
A copied worker secret from another environment must never be used to fix authentication.
