# Inactive runner tickets still show a race pass

## Assessment

Local readiness finding; no external issue or publication requested.

| Metric | Value | Evidence |
| --- | --- | --- |
| Severity | Medium | Refunded runners see a misleading pass and kit controls; check-in rejects them. |
| Complexity | Low | TicketPanel status branching and component regression tests only. |
| Confidence | High | Token-only guard and authoritative paid-only check-in are directly visible. |

## Reproduction and root cause

Parent verified refunded local registration `2179ad95-0379-4d9d-8ca6-7f7c1419829c` retains its ticket token. Open its owner's ticket URL: the existing token renders the race pass, print button and kit editor.

The original guard at `apps/site/app/ticket/[registrationId]/TicketPanel.tsx:29` checks token presence, not registration status. `git blame` traces this to original ticket implementation `f328d1a7`. The registration mapper supplies both fields in `apps/site/lib/registration.ts`. Retaining a historical token is therefore confused with current admission eligibility. Conversely, a paid registration without a token receives a misleading invitation to pay again.

`supabase/functions/check-in/index.ts:31` rejects every status except `paid`. Check-ins live in a separate table; `checked_in` is not a registration status. The registration enum contains pending, paid, refunded, cancelled and expired (the last added by `20260809100000_registration_status_expired.sql`). QR rendering itself is not authorization, as documented in `supabase/functions/ticket-qr/index.ts`.

## Fix and verification plan

Gate the pass and kit/print controls on paid status plus a token. Show explicit inactive text and a My Races link for refunded, cancelled and expired registrations. Only pending registrations receive a payment link, even if they retain a token. Paid registrations missing a token receive recovery text and a refresh action, never another payment invitation. Unknown statuses fail closed.

Scope: TicketPanel, its colocated tests, and this RCA. No database or check-in mutations. Preserve the existing paid pass and identity snapshot rendering. Tests cover all inactive states with and without retained tokens, pending with and without tokens, unknown status, paid token recovery and valid paid pass/kit actions. Parent performs owner browser verification and the full site gate.

Validation: `pnpm --filter site exec vitest run 'app/ticket/[registrationId]/TicketPanel.test.tsx'`.

## Implementation result

Implemented the status guard and recovery states as planned. All 8 focused component tests passed. `pnpm --filter site typecheck` passed. No database changes or external publication occurred. Owner browser verification remains with the parent readiness walkthrough.

## Payment bookmark follow-up

The same lifecycle gap exists in PayPanel: its server route redirects paid registrations, but the client previously guarded only expired registrations, event closure and organization suspension. Refunded/cancelled bookmarks could render Pay. Additionally, `pay()` only blocked the `org_suspended` refusal from falling back to the stored session. `payment-session/index.ts:53` returns `not_pending` for every non-pending registration, so stale client status could route around this refusal.

Extend the fix to PayPanel and its existing tests. Paid status must show View ticket; refunded/cancelled/unknown statuses must show an inactive state and My Races. Existing pending and expired UX stays intact. Every explicit scoped checkout error blocks fallback, while transport-only failures retain the existing fallback. Add regression tests for terminal/unknown states and stale-state server refusals. No database changes.

Payment follow-up implemented. All 22 PayPanel tests and 7 error-message tests passed; site typecheck and scoped diff check passed. Eight PayPanel regressions were added. The shared `not_pending` message now neutrally describes unavailable payment rather than claiming every terminal registration is paid. Parent approved this additional wording correction. Existing transport-error fallback and expired/pending tests remain passing.
