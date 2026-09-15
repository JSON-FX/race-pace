"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redeemRecoveryLink } from "@/lib/recovery";

type RecoveryClient = NonNullable<Awaited<ReturnType<typeof redeemRecoveryLink>>>;

export default function RecoveryPage() {
  const started = useRef(false);
  const client = useRef<RecoveryClient | null>(null);
  const [state, setState] = useState<"loading" | "invalid" | "ready" | "done">("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    // Remove one-time credentials before rendering or navigating anywhere else.
    window.history.replaceState(null, "", "/auth/recovery");
    redeemRecoveryLink(url).then((verified) => {
      client.current = verified;
      setState(verified ? "ready" : "invalid");
    }).catch(() => setState("invalid"));
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !client.current) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password.length < 6) { setError("Use at least 6 characters."); return; }
    if (password !== form.get("confirmPassword")) { setError("Passwords do not match."); return; }
    setPending(true);
    setError("");
    try {
      const { data: { user }, error: userError } = await client.current.client.auth.getUser();
      if (userError || !user || user.id !== client.current.userId) { setState("invalid"); return; }
      const { error } = await client.current.client.auth.updateUser({ password });
      if (error) { setError("We couldn't update your password. Try a different password or request a new link."); return; }
      try {
        const { error: signOutError } = await client.current.client.auth.signOut();
        if (signOutError) setError("Your password changed, but we couldn't sign you out. Close this session before signing in again.");
      } catch {
        setError("Your password changed, but we couldn't sign you out. Close this session before signing in again.");
      }
      client.current = null;
      setState("done");
    } catch { setError("We couldn't update your password. Please try again."); }
    finally { setPending(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-muted p-6">
    <Card className="w-full max-w-sm rounded-xl shadow-lg"><CardContent className="space-y-4 px-6 py-7">
      <h1 className="text-xl font-bold">Choose a new password</h1>
      {state === "loading" && <p role="status">Checking your reset link…</p>}
      {state === "invalid" && <><p role="alert">This reset link is invalid, expired, or already used.</p><Link className="block text-sm underline" href="/forgot-password">Request a new reset link</Link></>}
      {state === "done" && <><p role="status">Your password has been updated.</p>{error && <p role="alert">{error}</p>}<Link className="block text-sm underline" href="/sign-in">Sign in with your new password</Link></>}
      {state === "ready" && <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="password">New password</Label><Input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required /></div>
        <div className="space-y-1.5"><Label htmlFor="confirmPassword">Confirm new password</Label><Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={6} required /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button disabled={pending} className="w-full">{pending ? "Updating…" : "Update password"}</Button>
      </form>}
    </CardContent></Card>
  </main>;
}
