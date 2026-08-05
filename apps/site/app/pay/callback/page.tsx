import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { CallbackPanel } from "./CallbackPanel";

export const dynamic = "force-dynamic";

export default async function PayCallbackPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/sign-in?next=%2Fraces");

  return (
    <>
      <SiteHeader />
      <main>
        <Suspense fallback={<p className="py-20 text-center text-muted-foreground">Loading…</p>}>
          <CallbackPanel />
        </Suspense>
      </main>
    </>
  );
}
