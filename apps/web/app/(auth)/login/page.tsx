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
          <Image
            src="/login-logo.png"
            alt="Race Pace"
            width={1177}
            height={760}
            priority
            // Sized by height with width:auto — the intrinsic dimensions above
            // are what Next needs to reserve space and avoid layout shift, not
            // the rendered size. `brightness-0 invert` turns the dark lockup
            // white for the forest surface without shipping a second asset.
            className="h-[34px] w-auto brightness-0 invert"
          />
          <h1 className="mt-[11px] text-[16px] font-bold tracking-[-0.02em] text-white">
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
