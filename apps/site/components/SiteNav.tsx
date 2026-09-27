"use client";

import { Button } from "@/components/ui/button";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";
import { LinkPending } from "./NavProgress";

/**
 * The nav's interactive half. SiteHeader stays a server component so it can
 * read auth; everything that needs the current route or a menu toggle lives
 * here, behind a single `signedIn` boolean.
 *
 * Marks where you are — `aria-current` plus a spring-animated pill.
 *
 * MOBILE NAVIGATION LIVES IN RunnerTabBar, not here. This header used to carry a
 * hamburger opening a full-screen sheet; it was removed for two reasons.
 *
 * It was redundant: the bottom bar offers the same four destinations, one tap
 * each, in the thumb arc.
 *
 * And it was visibly broken. The sheet was `fixed inset-0`, but SiteHeader wraps
 * this component in a `backdrop-blur` element — and `backdrop-filter` creates a
 * containing block for fixed descendants, so `inset-0` resolved against the 65px
 * header instead of the viewport. The forest background painted only that strip
 * while the 30px menu labels spilled over the page beneath, unreadable against
 * the event cards.
 *
 * Log out is not lost with the sheet: it already lives on the Profile page
 * (app/profile/ProfileForm.tsx), which the tab bar reaches in one tap.
 */

type Item = { href: string; label: string };

const PUBLIC_ITEMS: Item[] = [
  { href: "/home", label: "Home" },
  { href: "/events", label: "Races" },
  { href: "/organizers", label: "Organizers" },
];
const RUNNER_ITEMS: Item[] = [
  { href: "/home", label: "Home" },
  { href: "/events", label: "Races" },
  { href: "/organizers", label: "Organizers" },
  { href: "/races", label: "My Races" },
  { href: "/profile", label: "Profile" },
];

/** `/events/abc` should light "Races"; `/racesomething` should not light
 *  "My Races". Segment boundary, same rule as lib/routes.ts. */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "/";
  const items = signedIn ? RUNNER_ITEMS : PUBLIC_ITEMS;
  const [leaving, setLeaving] = React.useState(false);
  const reduced = useReducedMotion();

  // A hard navigation, not router.push: the header is a server component that
  // reads auth, so a client-side transition would leave it rendering the
  // signed-in nav until something else forced a refetch.
  const logOut = React.useCallback(async () => {
    setLeaving(true);
    try {
      await signOut();
    } finally {
      window.location.assign("/");
    }
  }, []);

  return (
      <div className={cn(
        "mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6",
        !signedIn && "max-[370px]:h-auto max-[370px]:flex-wrap max-[370px]:gap-y-1 max-[370px]:py-2",
      )}>
        <Link href="/" aria-label="Race Pace home" className="flex shrink-0 items-center">
          {/* The mark alone — the asset's own wordmark is the footer's job.
              Explicit width/height keep the box reserved so the header never
              reflows as the PNG decodes. Source is 700x372. */}
          <Image
            src="/topnav-logo.png"
            alt="Race Pace"
            width={64}
            height={34}
            priority
            className="h-[30px] w-auto sm:h-[34px]"
          />
        </Link>

        {/* Desktop: a segmented control. The active pill is a shared layout
            element, so switching tabs slides it rather than cutting. */}
        <nav
          aria-label="Main"
          className={cn(
            "items-center gap-1 rounded-pill bg-muted p-1 sm:flex",
            // Signed IN, the bottom tab bar owns mobile navigation, so showing
            // these here would be the same four destinations twice.
            //
            // Signed OUT there is no bar (two tabs reads as broken, and Sign in
            // is a call to action rather than a destination) — so the pills stay
            // visible. Keep each target compact enough for the three public links.
            signedIn ? "hidden" : "flex max-[370px]:order-3 max-[370px]:w-full max-[370px]:justify-center",
          )}
        >
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Button asChild key={item.href} variant="ghost" className="px-2.5 sm:px-4"><Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative px-2.5 py-2 sm:px-4",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-[14px] bg-accent"
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 420, damping: 34, mass: 0.7 }
                    }
                  />
                ) : null}
                <span className="relative inline-flex items-center gap-1.5">
                  {item.label}
                  {/* Without this the progress bar never fires for a desktop or
                      signed-out visitor — the tab bar is the only other place
                      that reports pending, and neither of them has one. */}
                  <LinkPending className="ml-0 size-2.5" />
                </span>
              </Link></Button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {signedIn ? (
            <Button variant="outline"
              type="button"
              onClick={logOut}
              disabled={leaving}
              className="hidden items-center gap-1.5 border px-4 py-2.5 disabled:opacity-60 sm:inline-flex"
            >
              <LogOut size={15} aria-hidden="true" />
              {leaving ? "Logging out…" : "Log out"}
            </Button>
          ) : (
            <Button asChild className="px-2.5 sm:px-5"><Link href="/sign-in">
              Sign in
            </Link></Button>
          )}

        </div>
      </div>

  );
}
