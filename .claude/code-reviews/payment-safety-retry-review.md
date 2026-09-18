# Payment safety retry review

Stats: 8 files modified, 4 files added, 0 files deleted. The diff replaces the unbound checkout retry, adds paid-session capture rechecks, a staff alert, focused tests, and launch evidence.

Code review passed. No new technical issue was found in the changed paths. A PayMongo payment without a bound session now returns a specific refusal and cannot mint a second checkout through `payment-session`. The web pay panel does not fall back to a stored URL after that refusal. The alert trigger is deduplicated, leaves the pending reservation unchanged, and does not fail the worker when notification insertion fails. Rechecking an already-paid booking can add a newly visible paid capture to the existing inbox; a failed provider GET does not downgrade the paid ticket.

Release limit: the first PayMongo create can still succeed while its response or database bind is lost. The resulting unbound reservation now stays held and alerts staff after the expiry worker sees it. There is no automated proof that all possible provider sessions are closed, so an operator recovery path and provider confirmation are required before production. Live late and duplicate **paid** capture behavior remains untested.

Validation: sandbox v1 and v2 identical-key probes returned distinct sessions; all four unpaid probe sessions were expired. A nonempty staging worker run confirmed a known expired provider session and changed one synthetic registration to expired without a ticket or occupied paid slot; its staging fixture was deleted. Local site 408 tests, admin 871 tests, backend 691 tests, both app typechecks, function-grant tests and `git diff --check` passed. Staging deployment of the new code and migration is still pending at review time.
