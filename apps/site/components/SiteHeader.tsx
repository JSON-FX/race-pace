import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "@/components/SiteNav";

/** Async Server Component: the nav differs for a signed-in runner, so it has to
 *  know who is asking. Every page that renders this is already `force-dynamic`,
 *  so reading auth here costs nothing extra in caching terms.
 *
 *  `getUser()` — never `getSession()`. getSession() returns unverified cookie
 *  contents, so a forged cookie would flip the nav to its signed-in state.
 *
 *  Everything interactive (active route, mobile sheet) lives in SiteNav, which
 *  is a client component. This file exists only to answer "is anyone signed
 *  in?" and hand that down. */
export async function SiteHeader() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();

  return (
    <header className="no-print sticky top-0 z-40 border-b border-divider bg-background/85 backdrop-blur">
      <SiteNav signedIn={!!user} />
    </header>
  );
}
