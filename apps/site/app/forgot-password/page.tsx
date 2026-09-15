"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRecoveryClient } from "@/lib/recovery";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setPending(true);
    setError("");
    try {
      const { error } = await createRecoveryClient().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/recovery`,
      });
      if (error) throw error;
      setSent(true);
    } catch {
      setError("We couldn't send the reset email. Please try again shortly.");
    } finally { setPending(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-muted p-6">
    <Card className="w-full max-w-sm rounded-xl shadow-lg"><CardContent className="space-y-4 px-6 py-7">
      <h1 className="text-xl font-bold">Reset your password</h1>
      {sent ? <p role="status" className="text-sm">If an account exists for that email, we'll send a password reset link. Check your inbox and open the link in this browser.</p> :
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">Enter the email you use for Race Pace.</p>
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button disabled={pending} className="w-full">{pending ? "Sending…" : "Send reset link"}</Button>
        </form>}
      <Link href="/sign-in" className="block text-sm underline">Back to sign in</Link>
    </CardContent></Card>
  </main>;
}
