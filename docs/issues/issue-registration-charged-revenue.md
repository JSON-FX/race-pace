# Registration revenue excludes pass-on charges

Reproduced locally on 2026-09-16. High confidence, low complexity, medium financial-reporting severity.

## Evidence
A fixed PHP50 commission with pass-on GCash processing charges PHP1065.99 for a PHP1000 registration. Two paid rows correctly show Payments gross PHP2131.98, but Registrations gross PHP2000. After one refund and two new sales, the cards show PHP3197.97 versus PHP3000.

payment-session keeps registrations.total_amount as the base; payments.amount is the authoritative grossed-up charge. admin_registration_aggregates incorrectly sums the base. A partial refund could consequently subtract a returned charged amount from a smaller base.

## Fix
Follow-up migration joins the caller-scoped payment row and sums amount minus refunded_amount for paid/partial rows. Preserve all filters, SECURITY INVOKER, empty search_path and explicit grants. Keep registration table/export base amounts intact but label them Base amount. Add pass-on partial-refund regression and check live paid scenarios, independent CSV sums and tenant grant tests.

No provider money movement. Local migration only.
