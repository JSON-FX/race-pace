# Oversized release record during Pay Later staging

Staging release 44178631177 deployed and verified both apps and the backend at
212b68bd1468e97ffb8c2969aebf7a912c57d098. Its final ledger write failed.

## Root cause

The GitHub API returned HTTP 422 with `payload is too long (maximum is 16383 characters)`.
The serialized complete payload was 66,479 characters. `recordDeployment` spread the full
current evidence, including duplicate migration audits, source-path arrays and function data.
Only nested previous history was compacted. The same issue prevented the failure record.
This behavior originated in the original Option B controller, commit 3c758a2.

## Scope and repair

Keep full completion validation and full workflow artifacts unchanged. The ledger needs source,
run and attempt identity for reconciliation, plus app identities for the production baseline.
Store those fields, verified backend migration versions and function inventory, and a digest of
the complete evidence. Omit duplicate source audits, path lists and nested previous records.
Keep the legacy schema readable. Reject an oversized compact payload before making API requests.

Only scripts/release/control.mjs, its regression tests and delivery documentation change.
Test large complete/failed/started records, retained identity and backend inventory, source
immutability, completion validation before posting, and the explicit payload limit. Validate
against the actual failed artifact and run all release tooling tests. Normal CI and staging
release remain required; this repair grants no production approval.
