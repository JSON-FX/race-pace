import { Suspense } from "react";
import Image from "next/image";
import { Card } from "@/components/ui/card";
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
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm overflow-hidden rounded-xl p-0 shadow-lg">
        <div className="bg-forest px-6 pb-[18px] pt-[22px]">
          {/* The lockup is slate grey (#404A54) plus green (#13C663) on a WHITE
              background baked into the PNG — it is not transparent, and there is
              no reversed variant in the repo.

              So it cannot sit directly on the forest band: its own white
              rectangle would show as a hard-edged block. The previous attempt,
              `brightness-0 invert`, avoided that by flattening grey, green AND
              the white backdrop to a single white silhouette — which is not the
              logo at all.

              A rounded white plate is the honest fix: it matches the artwork's
              own background, shows the mark exactly as drawn, and doubles as the
              clear space a lockup is meant to keep. Replace this with a proper
              reversed asset if one is ever produced. */}
          <span className="inline-flex items-center rounded-lg bg-white px-3 py-2">
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
              className="h-[30px] w-auto"
            />
          </span>
          <h1 className="mt-[13px] text-[16px] font-bold tracking-[-0.02em] text-white">
            Race Pace Admin
          </h1>
          <p className="mt-[3px] text-[12.5px] text-white/60">
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
