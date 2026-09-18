# Durable refund ownership and callback reconciliation

Scope: existing web/admin refund flow, no policy or fee changes. Authorization stays in admin-refund plus service-only database functions. No new business questions remain: the established money boundary requires atomic writes, replay safety, and conservative handling of uncertain provider responses.

Persist one active refund request per registration before external POST. Freeze amount, retained net, actor, note, provider reference, and API-key fingerprint. Use request UUID for provider idempotency and metadata. Concurrent invocations cannot create another active request. A 90-second lease allows recovery using the SAME key within 23 hours of the first attempt; after that require manual reconciliation. Never resend an uncertain request after PayMongo's 24-hour key retention. Key rotation also requires reconciliation instead of resubmission under a different key.

Statuses: submitting, unknown, pending, succeeded, failed. Succeeded is absorbing. If two distinct attempts succeed, retain a review_required discrepancy on the second request, preserve the original ledger, and refuse clean reconciliation or further automatic refund work. Same-request replay remains harmless. A definitive failed attempt permits a new attempt. Pending requests with provider IDs use GET reconciliation rather than another POST. Uncertain outcomes without IDs keep their request and lease. Preview is read-only.

Persist authenticated provider refund resources into a service-only inbox before acknowledgment. Store the latest nonterminal/failed state by provider timestamp, but succeeded always wins over delayed failures. Keep unmatched events for later binding. Reconcile in registration → payment → request lock order. Match provider refund ID or validated refund_request_id metadata, verify amount, preserve stored split, call existing refund_registration_tx atomically, then mark request succeeded. Legacy raw.refund.pending rows must be adopted with their stored split and must not trigger a fresh provider POST.

Keep raw.refund as a compatibility projection updated under a database lock. Its status continues invalidating payout snapshots. Tables and internal functions have explicit grants, RLS enabled, and no client access. Inbox org_id may be null until matched; this is an internal provider inbox, not a client tenant table.

Validate concurrent claims, recovery key reuse/expiry, frozen terms, early callback before bind, unknown durable events, lookup/database failure, terminal ordering, partial refund replay, and legacy pending handling. Run full backend tests serially because legacy suites share database fixtures and global backfills. Verify in Computer and repeat an original provider test-mode callback before claiming provider success.

Sources: https://docs.paymongo.com/reference/idempotent-requests and https://docs.paymongo.com/reference/refund-resource.
