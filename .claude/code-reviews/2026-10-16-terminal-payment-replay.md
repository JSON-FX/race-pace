# Terminal capture replay repair

## Finding

Severity: high. File: `supabase/functions/_shared/groupPaymentService.ts`.
Integrated CI for PR #231 exposed a real ordering issue in concurrent retries. The first
request can fulfill a received capture before the second reads it. That second request then
missed the received-only recovery shortcut and failed when PayMongo was unavailable, despite
an authoritative paid result already stored locally.

## Resolution

Use every stored capture state for ordinary authorized verification. Fulfillment resumes only
received rows and preserves fulfilled/review results. New signed webhook notifications retain
`refreshProvider: true` and exact notified-payment/session matching, so additional captures
cannot be acknowledged using an unrelated old payment.

Two deterministic tests for terminal paid/review replays both failed before the fix. The existing
concurrent recovery test remains. The extra-capture regression now explicitly models the new
webhook path after fulfillment and checks that allocations and tickets are not duplicated.

Final validation: all 118 backend/shared files and 1,039 tests passed. Frozen Deno type
checking passed for the three affected entry points. Independent review passed with no
remaining blockers. An initial local run lost its Edge gateway during a development-server
reload; after restarting the isolated runtime, the unchanged full suite passed. No staging or
production deployment occurred from the failed integrated revision.
