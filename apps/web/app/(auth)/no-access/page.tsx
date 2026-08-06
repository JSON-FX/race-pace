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
            <h1 className="text-[17px] font-bold tracking-[-0.02em]">No admin access</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {email ? (
                <>
                  <span className="font-semibold text-foreground">{email}</span> isn&apos;t an
                  organizer on any event yet. Ask your organization admin to invite this exact
                  address, then sign in again.
                </>
              ) : (
                <>
                  This account isn&apos;t an organizer on any event. Ask your organization admin to
                  invite you, then sign in again.
                </>
              )}
            </p>
          </div>

          <form action={signOutAction}>
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
