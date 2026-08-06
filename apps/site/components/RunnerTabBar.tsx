"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Mountain, Ticket, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkPending } from "./NavProgress";

/**
 * Mobile bottom navigation for signed-in runners.
 *
 * The old header wasn't broken — it didn't overflow — it was just out of reach:
 * it sat 779px from the bottom of an 844px screen, and My Races and Profile were
 * behind a hamburger in the top-right corner. Browsing races and pulling up a
 * ticket are the two things runners do on a phone, and both cost a stretch plus
 * an extra tap.
 *
 * Four destinations, so unlike the admin console there is no "More" tab and
 * every page is exactly one tap. Five is the documented maximum; this fits with
 * room spare.
 *
 * SIGNED OUT it renders nothing. The public nav is Home and Races only, which
 * already fits the header comfortably — and a two-item bar reads as broken,
 * while "Sign in" is a call to action rather than a destination and belongs in
 * the header where the value proposition is.
 *
 * Desktop keeps the pill nav in SiteNav; this is `md:hidden`.
 */

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/events", label: "Races", icon: Mountain },
  { href: "/races", label: "My Races", icon: Ticket },
  { href: "/profile", label: "Profile", icon: User },
] as const;

/** Same rule as SiteNav#isActive — "/" matches exactly, everything else on a
 *  segment boundary, so `/events/abc` lights Races and `/racesomething` does
 *  not light My Races. Duplicated deliberately: this component must keep
 *  working if SiteNav is refactored. */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function RunnerTabBar({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "/";
  if (!signedIn) return null;

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "sticky bottom-0 z-40 flex border-t border-border bg-background md:hidden",
        // The home indicator overlays the bottom ~34px on a gesture-nav phone.
        // Without the inset the labels are unreadable and the targets sit inside
        // the system's own swipe region.
        "px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5",
      )}
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              // The whole cell is the target, not the glyph — min 44px tall with
              // the padding, and each cell is a quarter of the viewport wide.
              "relative flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5",
              "text-[10.5px] font-semibold transition-colors",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="size-[22px]" strokeWidth={active ? 2.3 : 1.9} aria-hidden />
            {/* Marks WHICH tab is loading. The top bar says a navigation is
                happening; this says which one — the difference between "it's
                working" and "I hit the wrong thing". */}
            <LinkPending className="absolute right-[calc(50%-20px)] top-0.5 ml-0" />
            {/* Always labelled. A ticket stub and a mountain are not
                self-evident icons, and an unlabelled bar is guesswork on a
                runner's first visit. */}
            <span className="leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
