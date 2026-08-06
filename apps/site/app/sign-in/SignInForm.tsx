"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/GoogleButton";
import { signInWithPassword } from "@/lib/auth";
import { safeNextPath } from "@/lib/routes";

/**
 * The interactive half of sign-in. Split out of page.tsx so that file can be a
 * Server Component and read the season stats for the brand canvas.
 *
 * Google sits ABOVE the password form: a runner arriving from a shared race
 * link most likely has no password yet, and putting the one-tap option under a
 * form they cannot complete is a dead end.
 */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    router.replace(next);
    // LAYOUTS SURVIVE A CLIENT NAVIGATION. The root layout reads auth (for the
    // mobile tab bar) and so does each page (for the header) — without this
    // refresh only the PAGE re-renders, so a runner who just signed in gets the
    // signed-in header above a layout that still thinks they are anonymous, and
    // the tab bar simply never appears until a hard reload.
    router.refresh();
  }

  return (
    <div className="w-full max-w-[340px]">
      <h1 className="font-display text-[26px] font-extrabold tracking-[-0.03em] text-foreground">
        Sign in
      </h1>
      <p className="mt-1.5 text-[14px] text-muted-foreground">
        Enter races and carry your ticket to the start line.
      </p>

      <div className="mt-6">
        <GoogleButton next={next} />
      </div>

      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-divider" />
        <span className="text-[12.5px] font-medium text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-xl"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-xl"
          />
        </div>
        {/* Below the fields it relates to, and announced — an error only at the
            top of a form is easy to miss on a phone. */}
        {error ? (
          <p role="alert" className="text-[13.5px] text-destructive">{error}</p>
        ) : null}
        <Button
          type="submit"
          disabled={busy}
          className="h-12 rounded-pill text-[15px] font-bold"
        >
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-[13.5px] text-muted-foreground">
        New here?{" "}
        <Link
          href={`/sign-up?next=${encodeURIComponent(next)}`}
          className="font-bold text-primary"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
