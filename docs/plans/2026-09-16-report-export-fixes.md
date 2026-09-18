# Report/export fixes

Status: implemented and locally verified; broader webhook validation has two signing-key failures. References: docs/issues/2026-09-16-report-export-readiness.md.

1. Payment query includes refunded_amount. CSV preserves historical columns under explicit labels and appends actual refunds, retained gross, current platform fees and current organizer net. Current totals mirror aggregate status rules; pending/failed/refunded have zero current proceeds. Test paid, full/partial refund and unsettled cases.
2. Partial-refund status supported by payment type, payment/registration filters and badge. Missing method uses status to distinguish unpaid from unrecorded method. Add regression tests.
3. Replace client Blob settlement export with authenticated HTTP route, same capability and owning-org checks as page, same settlement read model/serializer. Fail before returning CSV on data failure. Use safe filenames and no-store cache. Test permissions, absent event, success and query failure.
4. Replace banked/exact copy with recorded/provisional language. Explain payout separately. Verify browser and HTTP exports and independent sums; use local sample partial-refund fixture if needed.
5. Full admin tests/typecheck, isolated build, diff review. Update audit/checklist/report. No hosted changes, commit or push.

Browser verification exposed a related sixth gap: registration KPI SQL excludes partial refunds. Add a follow-up migration preserving caller RLS, filters and grants. Include partial rows in paid count, retained gross and actual-refund totals; verify using a database regression and browser fixture.
