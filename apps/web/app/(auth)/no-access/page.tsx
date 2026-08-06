import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/actions/auth";

/**
 * Where an authenticated account with no organization role lands.
 *
 * This is the whole Google-sign-in gate. Signing in with Google authenticates
 * and grants nothing; authorization lives in `user_roles` and is checked by the
 * (admin) layout, which sends anyone without a role here. An uninvited Google
 * account therefore reaches this page rather than the console — no OAuth-
 * specific authorization code exists, or should.
 *
 * The page NAMES the rejected address. The gate matches on email, so someone
 * invited at alma@muspo.ph who signs in with a personal alma@gmail.com is
 * correctly refused — and without seeing which address was rejected, that reads
 * as "the invite is broken" rather than "wrong account". This one line is the
 * difference between a support message and a second attempt.
 */
export default async function NoAccessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const email = user?.email ?? null;

  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm rounded-xl text-center shadow-lg">
        <CardContent className="space-y-4 px-6 py-7">
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-destructive-tint text-destructive">
            <ShieldOff className="size-5" aria-hidden />
          </div>

          <div>
            <h1 className="text-[17px] font-bold tracking-[-0.02em]">
              This account isn&apos;t registered
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {email ? (
                <>
                  <span className="font-semibold text-foreground">{email}</span> isn&apos;t
                  registered to any organization, and isn&apos;t a platform admin. Sign-in worked —
                  the account just has no access yet.
                </>
              ) : (
                <>
                  This account isn&apos;t registered to any organization, and isn&apos;t a platform
                  admin. Sign-in worked — the account just has no access yet.
                </>
              )}
            </p>
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Ask your organization admin to invite{" "}
              {email ? "this exact address" : "your email address"}, then sign in again. Access is
              matched on the email, so an invite sent to a different address won&apos;t apply here.
            </p>
          </div>

          {/* Signing out is the ONLY useful action from here. Without it a
              Google user is stuck: /login now redirects an authenticated caller
              straight back to this page, so the session has to be cleared before
              a different account can be tried. */}
          <form action={signOutAction}>
            <Button type="submit" variant="outline" className="w-full">
              Sign out and try another account
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
