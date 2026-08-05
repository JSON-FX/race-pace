"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleButton } from "@/components/GoogleButton";
import { signUpWithPassword } from "@/lib/auth";

// `useSearchParams` opts a page out of static prerendering unless it sits
// under a Suspense boundary — https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout
export default function SignUp() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
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
    const { error } = await signUpWithPassword(email, password);
    setBusy(false);
    if (error) setError(error);
    else router.replace(next);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      {/* Clicking the mark returns to the catalog — an auth page with no way
          out is a dead end for anyone who landed here by accident. */}
      <Link href="/" aria-label="Race Pace home" className="mb-9 self-center">
        <Image src="/topnav-logo.png" alt="Race Pace" width={132} height={70} priority />
      </Link>
      <h1 className="text-[34px] font-semibold tracking-[-0.6px] text-foreground">Create account</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">One account for every race on Race Pace.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p className="text-[13px] text-muted-foreground">At least 6 characters.</p>
        </div>
        {error ? <p className="text-[14px] text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy} className="h-auto rounded-pill py-4 text-[16px] font-semibold">
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-divider" />
        <span className="text-[13px] text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-divider" />
      </div>

      <GoogleButton next={next} />

      <p className="mt-8 text-center text-[14px] text-muted-foreground">
        Already have an account?{" "}
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-primary">
          Sign in
        </Link>
      </p>
    </main>
  );
}
