# Native proof verification review

Reviewed the full changed helper, route, Edge operation, image validator, upload component, proof API tests, CI workflow, dependency lock and deployment plan.

Code review passed. No unresolved technical issues detected.

The original PNG decoder exceeds Supabase Edge memory on a valid 20 MP image. Verification now uses the existing runner Node runtime and pinned Sharp. Edge retains authorization and database writes. The helper authenticates independently, permits only its environment’s signed proof path, forbids redirects, bounds input bytes and concurrency, binds decoded bytes by SHA-256, and fully decodes supported images. Failures leave proof unverified. Private URLs and secrets are never logged.

Review caught staging deployment protection and a shorter outer timeout. The Edge caller now supplies an optional server-only Vercel automation header and allows the helper’s bounded download/decode time. Production does not require that staging bypass.

Validation: 177 migrations replayed; 827 backend tests passed (822 initially, five passed after exporting the isolated database URL); 522 runner tests; 1007 admin tests; 13 shared UI tests; both application and shared UI typechecks; Fieldnotes source audit; both isolated production builds. Native route cases include 48 MP images below 10 MB, exact 10 MB, malformed formats, origin/path binding, private authentication, changed bytes, streamed overruns, retry and concurrency. Real local Edge tests exercise private Storage and native decoding together.

The local replay assertion used the identical script with only its fixed port changed from 54522 to the isolated worktree’s 58522. CI keeps the normal 54522 check. Hosted deployment and browser acceptance remain separate release gates.
