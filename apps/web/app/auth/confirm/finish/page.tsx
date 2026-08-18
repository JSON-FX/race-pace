"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNextPath } from "@/lib/routes";

/**
 * Where Supabase's DEFAULT invite email lands.
 *
 * WHY THIS EXISTS AS A CLIENT PAGE, next to a server route that does the same
 * job: the two links carry the session in different places.
 *
 *   * The link org-provision/org-members hand back for manual delivery is one
 *     we build ourselves, carrying `?token_hash=`. A server route can read a
 *     query string, so `/auth/confirm/route.ts` redeems it with verifyOtp and
 *     sets the cookies before the browser renders anything.
 *
 *   * The EMAILED link uses Supabase's `{{ .ConfirmationURL }}` template, which
 *     routes through `/auth/v1/verify` and arrives as
 *     `…#access_token=…&refresh_token=…`. A fragment is never sent to the
 *     server. The server route sees no `token_hash`, concludes the link is
 *     spent, and bounces the invitee to /login — which is exactly what
 *     happened in production on 2026-08-18.
 *
 * So the fragment has to be read in the browser. `createBrowserClient` writes
 * the session to the same cookies middleware and Server Components read, so
 * once setSession resolves, the redirect below lands authenticated.
 *
 * Nothing here is a second authorization gate. The (admin) layout and the
 * per-page guards decide what this account may actually see.
 */
export default function ConfirmFinishPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);
  // Effects run twice under React StrictMode in dev, and setSession is not
  // free — a token consumed by the first pass would fail the second and show
  // a spurious error.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    // Supabase reports a refused or expired link on the fragment too, rather
    // than by not redirecting.
    const hashError = hash.get("error_description") ?? hash.get("error");
    const next = safeNextPath(searchParams.get("next"), "/team");

    if (hashError || !accessToken || !refreshToken) {
      router.replace("/login?oauth=invite_expired");
      return;
    }

    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          console.error("[auth/confirm/finish] setSession failed", error.message);
          setFailed(true);
          router.replace("/login?oauth=invite_expired");
          return;
        }
        // replace(), not push() — the tokens are in this entry's fragment and
        // Back must not return the invitee to it.
        router.replace(next);
      });
  }, [router, searchParams]);

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <p className="text-[13px] text-muted-foreground">
        {failed ? "That invite link has expired." : "Signing you in…"}
      </p>
    </div>
  );
}
