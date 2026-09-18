# Production runner provider for protected QA

## Goal

Keep the public production Coming Soon gate while allowing the protected deployment URL to run the runner app for prelaunch smoke testing.

## Verified cause

Google sign-in completed on the protected production site, then `/races` crashed with `No QueryClient set, use QueryClientProvider to set one`. The production branch of the root layout renders children without `Providers`, while the staging branch wraps every page. The launch gate now permits protected deployment URLs through, exposing this dormant layout mismatch.

## Change and validation

Wrap production-layout children in the existing `Providers` component. Preserve the production-only body styling and public middleware redirects. Run runner tests, typecheck and production build, then verify a fresh protected production Google sign-in loads `/races`. Recheck the public domain still lands on Coming Soon.
