"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_NEXT_COOKIE } from "@/lib/routes";
import { Button } from "@/components/ui/button";

/**
 * Google sign-in.
 *
 * AUTHENTICATION ONLY — it grants nothing. Authorization stays exactly where it
 * already was: `user_roles`, checked by the (admin) layout, which sends anyone
 * without an org role to /no-access. A Google account that was never invited
 * signs in successfully and then lands on that refusal, which is the correct
 * outcome and needed no new authorization code.
 *
 * The OAuth redirect must be started from the BROWSER, not a Server Action:
 * Supabase needs to set the PKCE verifier cookie on the client before Google
 * takes over the tab, and a server-side redirect skips that step and fails the
 * callback exchange.
 *
 * The mark is Google's own four-colour "G" at its required proportions, on a
 * white surface with the exact wording Google's branding guidelines mandate.
 * Do not recolour it, substitute an icon-font glyph, or reword the label.
 */
export function GoogleButton({ next }: { next: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    // The destination travels in a COOKIE, never in `redirectTo`.
    //
    // Supabase matches redirectTo against the dashboard's Redirect URLs
    // allow-list as a whole string, so `…/auth/callback?next=%2Fevents` does NOT
    // match a registered `…/auth/callback`. On a miss it silently falls back to
    // the project's Site URL — which is the runner site, so an admin would land
    // on the public homepage with no error. apps/site hit exactly this; see the
    // comment on its signInWithGoogle.
    //
    // SameSite=Lax is required and sufficient: the return leg is a top-level GET
    // navigation from Supabase to our origin, which Lax permits and Strict would
    // drop. 10 minutes outlasts a Google consent screen without letting a stale
    // value misroute a later visit.
    document.cookie =
      `${OAUTH_NEXT_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setPending(false);
      setError("Couldn't reach Google. Try again, or sign in with your email below.");
    }
    // On success the browser navigates away; leave `pending` set so the button
    // cannot be double-fired during the hand-off.
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={signIn}
        disabled={pending}
        className="h-10 w-full gap-2.5 bg-card font-semibold"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <svg className="size-[17px]" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.8-2 5.1-4.4 6.7v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.4z" />
            <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.2 15.5 46 24 46z" />
            <path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.7-.7-4.3s.2-2.9.7-4.3v-5.7H4.5C2.9 17.2 2 20.5 2 24s.9 6.8 2.5 9.7l7.3-5.4z" />
            <path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.5 2 8.1 6.8 4.5 14.3l7.3 5.7c1.7-5.2 6.5-9.3 12.2-9.3z" />
          </svg>
        )}
        {pending ? "Redirecting to Google…" : "Sign in with Google"}
      </Button>
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
