"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type AuthState } from "@/lib/actions/auth";
import { GoogleButton } from "./google-button";

/** What came back on the `?oauth=` param from the callback route. Kept in one
 *  place so the copy stays honest about which of the two actually happened. */
const OAUTH_MESSAGES: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  failed: "Google sign-in didn't complete. Try again, or use your email and password.",
};

export function LoginForm() {
  const search = useSearchParams();
  // NOT `?? "/events"`. That default was the actual defect behind the
  // marshal-lockout bug: it turned "no explicit destination" into an
  // explicit one before it ever reached the server, so both signInAction and
  // the OAuth callback saw a valid, honoured `next` of "/events" and never
  // got a chance to fall back by capability via homePathFor. `next` now
  // stays null when the caller didn't ask for a specific page, and that
  // absence is what lets the server route a check_in-only account to
  // /check-in instead.
  const next = search.get("next");
  const oauthMessage = OAUTH_MESSAGES[search.get("oauth") ?? ""];
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signInAction, {});

  return (
    <div className="space-y-4">
      {oauthMessage ? (
        <p role="alert" className="rounded-lg bg-destructive-tint px-3 py-2 text-[12.5px] font-medium text-destructive">
          {oauthMessage}
        </p>
      ) : null}

      {/* Google first: for an org whose staff already live in Google Workspace
          it is the path most will take, and burying it under a password form
          they don't have a password for is a dead end. */}
      <GoogleButton next={next} />

      <div className="flex items-center gap-2.5 text-[11.5px] font-semibold text-muted-foreground">
        <span className="h-px flex-1 bg-divider" />
        OR
        <span className="h-px flex-1 bg-divider" />
      </div>

      <form action={formAction} className="space-y-4">
        {/* Omitted entirely, not rendered with an empty/default value, when
            there is no explicit destination — formData.get("next") must come
            back null so signInAction can tell "no destination" apart from
            "destination is the empty string" and fall back by capability. */}
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state.error ? (
          <p role="alert" className="text-sm text-destructive">{state.error}</p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {/* Sets the expectation BEFORE someone tries an address that will be
          refused. Without it, /no-access reads as a bug rather than as the
          documented rule it is. */}
      <p className="text-center text-[12px] text-muted-foreground">
        Invite-only. Ask your organization admin for access.
      </p>
    </div>
  );
}
