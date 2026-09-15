# Review — race-kit release

Scope: new kit migration/Edge/station/export and runner integration; claiming capability, role resolution, home/nav and labels. Existing refund/check-in work retains its earlier reviews. No unrelated refactor or dependency change.

## Findings resolved

1. CSV helper already terminates each row. Joining rows with another CRLF created blank records. Fixed join and asserted 1,001 exported records plus header.
2. Ticket lookup could open a reversal dialog for release-only staff. Guarded the lookup; backend admin-only check was already authoritative. Browser repeat scan now reports Already released with no correction action.
3. Staff footer hardcoded Admin and denied-page text said all callers were unregistered. Now uses the resolved role and distinguishes insufficient page permission from missing membership. Verified in Computer.
4. New ticket verification must fail closed if the signing secret is missing. Removed a development-secret fallback from the new endpoint.

## Review conclusions

No remaining blocking finding in the implemented kit slice. Service-only mutations derive permissions from a verified actor; caller RPCs and row reads enforce org/event scope. Claiming cannot read raw registrations/payments or mutate release/audit tables. Row locking, unique active index and request IDs prevent duplicate active handoffs. Reversal preserves history and cannot affect a newer release through a stale ID. Snapshot comparison and the existing registration-edit transaction prevent changing reviewed contents during handoff. The CSV fails on partial-batch errors and escapes user text. Kit data excludes unrelated custom/medical fields.

Validation: kit/check-in/grants/team 26 passed; admin 769 passed plus final updated Sidebar 8; site 349 passed; both app typechecks; diff check. Browser walkthrough and authenticated export response recorded in docs/plans/2026-09-15-web-admin-e2e-checklist.md.

Limits: no full backend rerun or production builds for this slice. Browser download blocked by Brave despite server 200. Physical scanner/camera and invitation acceptance remain outside this verification. No hosted deployment performed.
