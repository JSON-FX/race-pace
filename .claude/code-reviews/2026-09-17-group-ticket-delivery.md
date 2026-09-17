# Group ticket delivery review

Scope: delivery migration, group email renderer, protected worker, config entry and new test coverage.

Checked secret gate and default-off switch, service-only grants, concurrent SKIP LOCKED claims, expiring lease identity, stale completion rejection, backoff, confirmed recipient lookup, current paid-ticket filtering, escaped user content and original captured total. No payment or ticket mutation occurs in the worker.

No blocking findings within the disabled local slice. Transport is explicitly at-least-once, not exactly-once; process loss after SMTP acceptance can resend the same email. Rendering at send time excludes already-refunded tickets but cannot recall an email after a later refund. Operational scheduling and actual email verification are release gates. No external emails sent.
