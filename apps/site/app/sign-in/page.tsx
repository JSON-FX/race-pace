"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/GoogleButton";
import { signInWithPassword } from "@/lib/auth";

// `useSearchParams` opts a page out of static prerendering unless it sits
// under a Suspense boundary — https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
export default function SignIn() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
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
    if (error) setError(error);
    else router.replace(next);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-[34px] font-semibold tracking-[-0.6px] text-foreground">Sign in</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">Enter races and carry your ticket to the start line.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy} className="h-auto rounded-pill py-4 text-[16px] font-semibold">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-divider" />
        <span className="text-[13px] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <GoogleButton next={next} />

      <p className="mt-8 text-center text-[14px] text-muted-foreground">
        New here?{" "}
        <Link href={`/sign-up?next=${encodeURIComponent(next)}`} className="font-semibold text-primary">
          Create an account
        </Link>
      </p>
    </main>
  );
}
