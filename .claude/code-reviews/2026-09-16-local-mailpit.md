# Local Mailpit review

Scope: four tracked configuration/transport/test files; supporting docs and ignored local provider selection.

Code review passed. No blocking technical issues detected in the Mailpit change.

- Explicit provider selection prevents fallback to production sending on SMTP failure.
- Mailtrap still requires TLS and credentials; the local capture transport uses the existing isolated Docker service.
- Resend remains the default. The protected ticket endpoint's authorization and payment checks are unchanged.
- SMTP timeouts, transport closure, attachment/URL access restrictions and credential-free error logging are preserved.
- The configuration survives local Supabase restart without changing hosted settings.

Validation: 13 focused tests and real local endpoint/browser checks. Failed mail preserved the paid registration; retry delivered; unauthorized sender returned 401. Product gaps in runner confirmation and password recovery are recorded separately, not marked as passing.
