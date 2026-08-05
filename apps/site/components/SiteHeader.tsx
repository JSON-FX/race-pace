import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";

const NAV_LINK = "text-foreground transition-colors hover:text-primary";

/** Async Server Component: the nav differs for a signed-in runner, so it has to
 *  know who is asking. Every page that renders this is already `force-dynamic`,
 *  so reading auth here costs nothing extra in caching terms.
 *
 *  `getUser()` — never `getSession()`. getSession() returns unverified cookie
 *  contents, so a forged cookie would flip the nav to its signed-in state. */
export async function SiteHeader() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();

  return (
    <header className="no-print sticky top-0 z-40 border-b border-divider bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Race Pace home" className="flex items-center">
          {/* The asset already carries the wordmark, so no text sibling — a
              second "Race Pace" beside it read as a duplicate. Served from
              public/ by path, not a static import; width and height are
              explicit so there is no layout shift. Source is 700x372, and
              these keep that 1.882 aspect ratio. */}
          <Image src="/topnav-logo.png" alt="Race Pace" width={98} height={52} priority />
        </Link>

        <nav className="flex items-center gap-6 text-[14px] font-medium">
          {/* The catalog is public — always reachable. */}
          <Link href="/events" className={NAV_LINK}>
            Races
          </Link>

          {user ? (
            <>
              {/* Both of these are behind the middleware's auth guard, so showing
                  them signed-out just hands a visitor a redirect to sign-in. */}
              <Link href="/races" className={NAV_LINK}>
                My Races
              </Link>
              <Link href="/profile" className={NAV_LINK}>
                Profile
              </Link>
            </>
          ) : (
            <Link
              href="/sign-in"
              className="rounded-pill bg-primary px-5 py-2 font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
