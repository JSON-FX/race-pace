# Feature: Add bot protection to public submission surfaces

The following plan is complete, but validate current provider documentation and repository patterns before implementation.

## Feature Description

Protect the public organizer inquiry and every password-authentication entry point from automated abuse. Google reCAPTCHA Enterprise protects the custom organizer inquiry. Cloudflare Turnstile supplies the CAPTCHA tokens that Supabase Auth natively validates for the runner site, admin console, and mobile app.

## User Story

As the Race Pace operator, I want automated submissions rejected before they send email or exercise authentication endpoints, so spam and credential abuse do not reach users or staff.

## Problem Statement

The organizer inquiry currently relies on validation and a hidden honeypot before sending an external email. The shared Supabase project has CAPTCHA disabled, while runner and admin password-authentication calls provide no CAPTCHA token. Enabling Supabase protection without updating the mobile app would break its password sign-in and signup flows.

## Solution Statement

Add score-based Google reCAPTCHA Enterprise verification and durable hashed-key rate limiting to `organizer-inquiry`. Add a reusable Turnstile component to both Next applications. Pass Turnstile tokens through every password sign-in, signup, and password-reset request. Add a hosted Turnstile bridge that returns a short-lived token through the existing `racepace://` scheme for Expo mobile authentication.

## Out of Scope / Non-Goals

- Do not add CAPTCHA to authenticated registration, payment, profile, ticket, or administration mutations.
- Do not challenge Google OAuth redirects.
- Do not change authorization, payment, or participant ownership rules.
- Do not enable hosted Supabase CAPTCHA until production clients containing this implementation are deployed.
- Do not commit, push, deploy, or activate production protection without a separately verified release step.

## Feature Metadata

**Feature Type**: Security enhancement
**Estimated Complexity**: High
**Primary Systems Affected**: `apps/site`, `apps/web`, `apps/mobile`, `supabase/functions`, `supabase/migrations`
**Dependencies**: Google reCAPTCHA Enterprise, Cloudflare Turnstile, Supabase Auth CAPTCHA

## Related Work

**Implements**: User-requested site-wide anti-spam protection
**Epic**: none

**Back-references**:

- `docs/operations/launch-progress.md` - Production release and verification ledger.
- `docs/operations/production-services-checklist.md` - External service readiness checklist.

**Forward-references**:

- Production provider activation after deployed-client validation.

---

## CONTEXT REFERENCES

### Relevant Codebase Files

- `apps/site/components/landing/OrganizerSignup.tsx:19-46` - Public inquiry submission.
- `supabase/functions/organizer-inquiry/index.ts:7-54` - Email delivery boundary.
- `apps/site/lib/auth.ts:4-22` - Runner password sign-in and signup.
- `apps/site/app/forgot-password/page.tsx:15-29` - Runner reset-email request.
- `apps/web/lib/actions/auth.ts:11-73` - Admin server-action sign-in.
- `apps/web/app/(auth)/forgot-password/page.tsx:15-29` - Admin reset-email request.
- `apps/mobile/lib/auth.tsx:9-39` - Mobile authentication contract.
- `apps/mobile/app.json:8` - Existing `racepace` deep-link scheme.
- `supabase/config.toml:224-245` - Local rate limits and disabled CAPTCHA template.
- `supabase/tests/function-grants.test.ts` - Public function grant audit.

### New Files to Create

- `apps/site/components/TurnstileWidget.tsx` - Runner and mobile-bridge Turnstile renderer.
- `apps/site/lib/recaptcha.ts` - Browser-side Google token loader and executor.
- `apps/site/app/auth/captcha/page.tsx` - Hosted mobile CAPTCHA bridge.
- `apps/site/components/__tests__/turnstile-widget.test.tsx` - Runner widget behavior.
- `apps/site/lib/__tests__/recaptcha.test.ts` - Google token helper behavior.
- `apps/web/components/TurnstileWidget.tsx` - Admin Turnstile renderer.
- `apps/web/components/turnstile-widget.test.tsx` - Admin widget behavior.
- `apps/mobile/lib/captcha.ts` - Expo browser challenge and deep-link token parser.
- `apps/mobile/__tests__/captcha.test.ts` - Mobile challenge contract.
- `supabase/functions/_shared/recaptcha.ts` - Server-side assessment verification.
- `supabase/functions/_shared/inquiryRateLimit.ts` - Hashed-key limiter caller.
- `supabase/functions/_shared/recaptcha.test.ts` - Assessment validation tests.
- `supabase/functions/_shared/inquiryRateLimit.test.ts` - Hashing and limiter tests.
- `supabase/migrations/<generated>_organizer_inquiry_rate_limit.sql` - Atomic durable limiter.

### Relevant Documentation

- https://supabase.com/docs/guides/auth/auth-captcha
  - Why: Supabase supports hCaptcha and Turnstile tokens on authentication calls.
- https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
  - Why: Explicit widget rendering, expiry, and error callbacks.
- https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/
  - Why: Mobile browser-auth session and deep-link result contract.
- https://cloud.google.com/recaptcha/docs/create-assessment-website
  - Why: Server-side assessment, action validation, score handling, and one-time token lifetime.

### Patterns to Follow

**Naming Conventions:** Components use PascalCase. Helpers use camelCase. Environment names identify their provider and exposure boundary.

**Error Handling:** Public clients show neutral retry copy. Edge Functions log stable categories without tokens, IP addresses, or organizer details.

**Security Boundary:** CAPTCHA decisions occur server-side. Browser tokens are never trusted without provider verification.

**Testing:** Next tests live under `app`, `lib`, or `components`. Edge helper tests remain pure and inject fetch or database dependencies.

---

## IMPLEMENTATION PLAN

### Phase 1: Provider-neutral foundations

- Add explicit Turnstile renderers to both Next apps.
- Add Google token execution for the organizer form.
- Add environment examples without committing secrets.

### Phase 2: Organizer inquiry protection

- Include the Google token in the inquiry payload.
- Verify validity, expected action, hostname, and minimum score before email delivery.
- Consume IP and normalized-email rate limits before provider email delivery.

### Phase 3: Shared Supabase Auth protection

- Pass Turnstile tokens for runner and admin sign-in, signup, and password reset.
- Reset one-time widgets after every request.
- Add a hosted challenge bridge and Expo browser flow for mobile sign-in and signup.

### Phase 4: Provider setup and staged activation

- Prepare separate Google keys for staging and production.
- Prepare Turnstile widgets for Race Pace domains.
- Configure Vercel and Edge Function secrets after the code is ready.
- Keep Supabase CAPTCHA disabled until all deployed clients are verified.

### Phase 5: Testing and validation

- Run focused tests after each surface.
- Run both Next type checks and tests.
- Run mobile tests and TypeScript validation.
- Run Edge helper tests and the backend grant test.

---

## STEP-BY-STEP TASKS

### CREATE Next Turnstile components

- **IMPLEMENT**: Explicit rendering with success, expiry, error, and reset behavior.
- **GOTCHA**: Tokens are one-time. A failed auth request must reset the widget.
- **VALIDATE**: `pnpm --filter site exec vitest run components/__tests__/turnstile-widget.test.tsx && pnpm --filter web exec vitest run components/turnstile-widget.test.tsx`
- **SATISFIES**: Auth CAPTCHA token collection.

### CREATE Google reCAPTCHA browser helper

- **IMPLEMENT**: Lazy-load Enterprise script, execute `organizer_inquiry`, and fail closed when configuration is absent.
- **GOTCHA**: Generate the token only when the user submits because it expires quickly.
- **VALIDATE**: `pnpm --filter site exec vitest run lib/__tests__/recaptcha.test.ts`
- **SATISFIES**: Organizer token collection.

### UPDATE organizer inquiry client and Edge Function

- **IMPLEMENT**: Send and verify CAPTCHA before email delivery. Preserve the honeypot.
- **GOTCHA**: Never log or echo the token, score details tied to personal data, IP, or email.
- **VALIDATE**: `pnpm exec vitest run supabase/functions/organizer-inquiry/index.test.ts supabase/functions/_shared/recaptcha.test.ts`
- **SATISFIES**: Blocks automated inquiry email delivery.

### CREATE durable organizer inquiry limiter

- **IMPLEMENT**: Use a CLI-generated migration. Store only salted hashes. Grant the RPC only to `service_role`.
- **GOTCHA**: Include explicit revoke and grant statements. Do not edit an applied migration.
- **VALIDATE**: `pnpm exec vitest run supabase/tests/function-grants.test.ts supabase/functions/_shared/inquiryRateLimit.test.ts`
- **SATISFIES**: Limits repeated accepted attempts even across Edge isolates.

### UPDATE runner and admin web authentication

- **IMPLEMENT**: Add tokens to password sign-in, signup, and reset-email calls. Exclude OAuth.
- **GOTCHA**: Admin sign-in is a server action, so submit the token in a hidden form field.
- **VALIDATE**: `pnpm --filter site test && pnpm --filter web test`
- **SATISFIES**: Protects all public web authentication forms.

### CREATE mobile hosted challenge and Expo integration

- **IMPLEMENT**: Open `/auth/captcha` with `openAuthSessionAsync`, accept only `racepace://captcha`, parse one token, then pass it to Supabase Auth.
- **GOTCHA**: Treat cancel, dismiss, wrong scheme, missing token, and duplicate callbacks as failures.
- **VALIDATE**: `pnpm --filter mobile test -- --runInBand && pnpm --filter mobile exec tsc --noEmit`
- **SATISFIES**: Keeps mobile authentication working after shared-project CAPTCHA activation.

### UPDATE environment and operations documentation

- **IMPLEMENT**: Document public site keys, Google server credentials, rate-limit salt, provider setup, activation order, and rollback.
- **VALIDATE**: `git diff --check`
- **SATISFIES**: Safe staged rollout.

---

## TESTING STRATEGY

### Unit Tests

- Widget success, expiry, error, missing configuration, and reset.
- Google script load, execute, failure, and action selection.
- Assessment rejection for invalid token, wrong action, wrong hostname, or low score.
- Mobile deep-link parsing, cancellation, and wrong-origin rejection.

### Integration Tests

- Inquiry sends only after provider verification and rate-limit acceptance.
- Password-auth calls receive `captchaToken` on runner and admin surfaces.
- The mobile browser bridge returns a token through the configured scheme.

### Edge Cases

- Provider script blocked by content filters.
- Token expires while a user completes the form.
- Provider returns an action that does not match the submitted action.
- Multiple rapid submissions race the database limiter.
- Supabase CAPTCHA is enabled before one client is deployed.

---

## VALIDATION COMMANDS

### Level 1: Syntax and types

```bash
pnpm --filter site typecheck
pnpm --filter web typecheck
pnpm --filter mobile exec tsc --noEmit
git diff --check
```

### Level 2: Unit tests

```bash
pnpm --filter site test
pnpm --filter web test
pnpm --filter mobile test -- --runInBand
pnpm test
```

### Level 3: Manual validation

- Use provider test keys locally.
- Verify inquiry rejection with missing, expired, and invalid tokens without sending email.
- Verify runner, admin, and mobile password authentication with a valid test token.
- Confirm Google OAuth remains unchanged.

---

## ACCEPTANCE CRITERIA

- [ ] Organizer email delivery requires a valid Google assessment and an accepted rate-limit decision.
- [ ] Runner signup, sign-in, and reset requests include a Turnstile token.
- [ ] Admin sign-in and reset requests include a Turnstile token.
- [ ] Mobile sign-in and signup obtain and include a Turnstile token.
- [ ] Google OAuth remains unchanged.
- [ ] Hosted CAPTCHA stays disabled until every production client is deployed.
- [ ] Provider secrets never enter tracked files or browser-visible bundles.
- [ ] Focused and full validation passes.
- [ ] Operations documentation records setup, activation, rollback, and remaining manual verification.

---

## COMPLETION CHECKLIST

- [ ] Tasks completed in order.
- [ ] Per-task validation passed.
- [ ] Full validation passed.
- [ ] Provider setup prepared.
- [ ] Production activation remains gated by deployed-client verification.
- [ ] Implementation report written.

---

## OPEN QUESTIONS / ASSUMPTIONS

- Assumed: “Let’s do it” approves the previously proposed Google-plus-Turnstile architecture.
- Assumed: Create a dedicated Google Cloud project named `Race Pace` rather than reuse unrelated projects.
- Assumed: Use a managed Turnstile challenge to minimize user friction.
- Assumed: Production activation is a separate release operation because enabling shared Supabase CAPTCHA before deployment would break current clients.

## NOTES

The current production Supabase dashboard visibly shows CAPTCHA protection disabled. Google Cloud has no existing Race Pace project. Cloudflare requires authentication before a Turnstile widget can be created.

## AMENDMENTS

- 2026-09-20 — Initial implementation plan created from the approved audit proposal.

**Confidence Score**: 8/10
