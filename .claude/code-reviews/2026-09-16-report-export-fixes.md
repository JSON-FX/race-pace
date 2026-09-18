# Scoped report/export review — 2026-09-16

Reviewed payment query/export, settlement page/export route/button, status and method display, registration summary migration and regression tests. Preexisting unrelated changes are outside this review.

No unresolved blocking finding in the report fix scope. Current-net columns use aggregate status semantics and preserve the historical ledger separately. CSV strings retain escaping. Settlement route reads through caller RLS, checks manage_org and event ownership, uses private/no-store headers, and returns errors before sending a CSV. SQL remains security invoker with empty search_path, preserves filters, and explicitly denies PUBLIC/anon execution while granting authenticated.

Live review found a registration summary defect; the follow-up migration and database regression cover partial retained revenue and actual refunds. Refund-count wording now matches registrations rather than requests.

815 admin tests and typecheck passed; 21 focused database tests passed. Registration gate has 25 passing tests and two webhook HTTP401 failures due to a test signing-key mismatch. Do not describe the entire backend as passing. Build and browser evidence are in the implementation report. No publication performed.
