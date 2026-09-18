# Accurate refund preview and outcomes

Implement the verified issue in docs/issues/issue-refund-confirmation-amount.md. Preserve existing refund policy and provider-first processing.

1. Extend the authenticated admin-refund endpoint with read-only preview. Return total paid, refund, retained fees; reuse the same policy calculation for preview and execution. Reject mismatching expected refund before provider call. Validate existing refund tests plus new preview tests.
2. Add a server action for preview and preserve pending/already/amount in execution response. Modal loads preview, disables confirmation while unavailable, shows fee breakdown, and distinguishes outcomes. Remove incorrect gross amount from drawer button. Validate component/action tests and admin typecheck.
3. Test local open-statement -> refund -> settlement reconciliation and replay. Record evidence and limitations. Run focused backend and admin tests, diff check and review. No commit/deploy.
