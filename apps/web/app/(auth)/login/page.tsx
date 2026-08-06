import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { LoginForm } from "./login-form";

/**
 * Direction C — "Branded band".
 *
 * The compact centred card, with a forest header carrying the lockup. The band
 * reuses `--forest`, the same surface as the check-in scan bar and the platform
 * scope band, so the console has one consistent "this is Race Pace speaking"
 * treatment rather than three unrelated dark panels.
 *
 * LOGO: the previous version rendered `topnav-logo.png` at `width={40}
 * height={40}`. That file is 700x372, and Next/Image applies both numbers
 * literally, so the lockup was squashed into a square — the mangled mark in the
 * bug report. This uses `login-logo.png` (1177x760, the full lockup, already in
 * public/ and previously unused) at its true ratio.
 *
 * The band carries a real race photo, shared with the runner site's sign-in, so
 * the console and the public site read as one product. Scoped to the band
 * rather than the page: full-bleed, it swamped the card the screen exists for.
 */
export default async function LoginPage() {
  // Never show a bare sign-in form to someone who is ALREADY signed in.
  //
  // This was a dead end. A Google account with no organization role signs in
  // successfully, gets bounced by the (admin) layout, and any later visit to
  // /login rendered the form again — so clicking "Sign in with Google" appeared
  // to do nothing at all: it re-authenticated an account that was already
  // authenticated, and returned to the same screen. The account was never the
  // problem; the missing feedback was.
  //
  // Authenticated callers are now routed by AUTHORIZATION: into the console if
  // they have a role, to /no-access — which names the rejected address — if they
  // do not.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const roles = await getMyRoles();
    redirect(roles?.isAdmin ? "/events" : "/no-access");
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm overflow-hidden rounded-xl p-0 shadow-lg">
        {/* The photo lives INSIDE the band, not behind the page.

            A real Muspo night flag-off, scoped to the one surface that was
            already forest. Full-bleed it swamped a 400px sign-in card and made
            the form the least interesting thing on screen; here it gives the
            band depth while the card stays the subject. */}
        <div className="relative overflow-hidden bg-forest px-6 pb-5 pt-6">
          <Image
            src="/login-background.jpg"
            alt=""
            aria-hidden
            fill
            priority
            sizes="384px"
            className="object-cover object-center"
          />
          {/* Heavy wash: this band carries white text at 12.5px, and the frame's
              head-torches are blown highlights. Without it the subtitle drops
              below 4.5:1 exactly where the photo is brightest. */}
          <div aria-hidden className="absolute inset-0 bg-forest/80" />
          {/* No plate. login-logo.png is 36% transparent and carries its own
              white fill plus the green mark, so it reads directly on the forest
              band — the white rectangle it used to sit on read as a sticker
              stuck onto the brand surface.

              `brightness-0 invert` was the earlier attempt and was worse: it
              flattened the slate, the green AND the white into one silhouette,
              which is not the logo at all.

              The drop shadow separates the darkest strokes (#404A54) from the
              forest behind them without recolouring anything. */}
          <span className="relative z-10 flex justify-center">
            <Image
              src="/login-logo.png"
              alt="Race Pace"
              width={1177}
              height={760}
              priority
              // Sized by height with width:auto. The intrinsic dimensions above
              // are what Next needs to reserve space and avoid layout shift —
              // NOT the rendered size. Passing 40x40 here was the original bug:
              // both numbers are applied literally, crushing a 1177x760 lockup
              // into a square.
              className="h-[58px] w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
            />
          </span>
          <h1 className="relative z-10 mt-3.5 text-center text-[16px] font-bold tracking-[-0.02em] text-white">
            Race Pace Admin
          </h1>
          <p className="relative z-10 mt-[3px] text-center text-[12.5px] text-white/70">
            Race directors, marshals and platform staff
          </p>
        </div>

        <div className="px-6 pb-6 pt-[22px]">
          {/* useSearchParams needs a Suspense boundary or the whole route opts
              out of static rendering with a build-time warning. */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </Card>
    </main>
  );
}
