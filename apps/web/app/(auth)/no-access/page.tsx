import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/actions/auth";
import Link from "next/link";
import { getMyRoles } from "@/lib/queries/roles";
import { homePathFor } from "@/lib/routes";

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
  const roles = await getMyRoles();
  const home = homePathFor(roles?.capabilities ?? []);
  const hasOtherAccess = home !== "/no-access";

  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-6">
      <Card className="w-full max-w-sm rounded-xl text-center shadow-lg">
        <CardContent className="space-y-4 px-6 py-7">
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-destructive-tint text-destructive">
            <ShieldOff className="size-5" aria-hidden />
          </div>

          <div>
            <h1 className="text-[17px] font-bold tracking-[-0.02em]">
              {hasOtherAccess ? "This page isn't available to your role" : "This account isn't registered"}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {hasOtherAccess ? (
                <>You are signed in{email ? ` as ${email}` : ""}. Your staff role does not allow access to this page.</>
              ) : email ? (
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
              {hasOtherAccess ? <>Return to your workspace, or ask your organization admin about the access you need.</> : <>Ask your organization admin to invite{" "}
              {email ? "this exact address" : "your email address"}, then sign in again. Access is
              matched on the email, so an invite sent to a different address won&apos;t apply here.</>}
            </p>
          </div>

          {hasOtherAccess && <Button asChild className="w-full"><Link href={home}>Return to your workspace</Link></Button>}
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
