# Wrong-event check-in: root cause and fix

Status: fixed and validated locally. Local readiness finding, no GitHub issue created.

| Assessment | Value | Evidence |
| --- | --- | --- |
| Severity | High | A staff member authorized for several races can check a runner into a race other than the one selected at the station. |
| Complexity | Low | One browser caller and one Edge Function; no schema change. |
| Confidence | High | Local HTTP reproduction inserted a check-in despite a different event_id. |

## Reproduction and cause

On 2026-09-16, a paid sample ticket for event `4de30fc8-4bf7-4d8e-aeb4-522f14aff3c4` was submitted with event_id `592bae02-d354-43f6-8572-4090ea4093db`. The server returned success and created a check-in for the ticket's event. The test check-in was undone afterward.

- The selected station event never reaches the server: `apps/web/app/(admin)/check-in/scanner.tsx` sends only ticket_token.
- `supabase/functions/check-in/index.ts` parses only ticket_token. It authorizes the ticket's registration event, then inserts a check-in without comparing station context.
- The scanner treats an off-roster result as successful and warns only after the mutation. This behavior dates to the original console implementation (`9c6b708a`), rather than the current refund changes.
- Authorization answers whether staff may handle the race. It does not answer whether this is the race currently being operated.

## Fix plan

Require a valid event_id in the Edge Function. After authenticating staff and authorizing the registration event, reject a mismatch with wrong_event (409) before inserting. Also require the signed ticket event to agree with its registration. Send the selected event from the shared scanner/manual/camera submission path. Show a clear wrong-event error without changing roster counts. Retain an off-roster warning only for a same-event roster that has become stale. Ignore old scan responses after the selected event changes.

No schema change or mobile implementation. The repository has one runtime caller. Deploy the admin and Edge Function together; old callers without event_id will fail closed.

## Validation

Add a live Edge Function regression test for a valid ticket from another event, missing/invalid event_id, matching event success, duplicate handling, unpaid/refunded denial, and scoped marshal denial. Add browser component tests for the selected event payload and wrong-event feedback. Run the admin suite and typecheck, then repeat local browser/API verification. Race-kit implementation and durable check-in undo audit remain separate findings.
