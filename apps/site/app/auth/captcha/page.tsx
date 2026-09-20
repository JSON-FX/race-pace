"use client";

import { useState } from "react";
import { TurnstileWidget } from "@/components/TurnstileWidget";

const MOBILE_CALLBACK = "racepace://captcha";

export default function MobileCaptchaPage() {
  const [error, setError] = useState(false);

  function complete(token: string | null) {
    if (!token) {
      setError(true);
      return;
    }
    window.location.replace(`${MOBILE_CALLBACK}?token=${encodeURIComponent(token)}`);
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <section className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6 text-card-foreground shadow-lg">
        <div>
          <h1 className="text-xl font-bold">Verify it&apos;s you</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete this check to return to the Race Pace app.
          </p>
        </div>
        <TurnstileWidget action="mobile_auth" onTokenChange={complete} />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            Verification expired or failed. Complete the check again.
          </p>
        ) : null}
      </section>
    </main>
  );
}
