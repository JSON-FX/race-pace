# Selected-event check-in review

Scope: two production files (scanner.tsx and check-in/index.ts), two new regression test files, and readiness/RCA documentation. Prior refund changes were preserved and are covered by their separate review records.

Reviewed the full scanner and endpoint plus both test files. The only runtime caller passes the selected event through the common manual/scanner/camera path. The endpoint requires a UUID, keeps existing staff authorization, verifies signed event identity, and rejects a station mismatch before either insertion or duplicate handling. Late scan responses after an event switch are ignored. No new grants, secrets, dependencies, or schema changes.

Code review passed for the scoped fix. Validation: full admin 758 tests, focused backend 16 tests, admin typecheck, diff whitespace check. A final test-only improvement flushes the delayed promise before checking stale-response behavior.

Known separate findings: missing kit-release workflow; check-in undo does not preserve an audit; physical camera and marshal invitation/login remain unverified. Off-roster same-event success still requires refreshing the roster before the runner appears there. Do not claim full production readiness.
