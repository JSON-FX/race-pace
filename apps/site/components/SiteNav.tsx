"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";

/**
 * The nav's interactive half. SiteHeader stays a server component so it can
 * read auth; everything that needs the current route or a menu toggle lives
 * here, behind a single `signedIn` boolean.
 *
 * Two things the previous header didn't do at all:
 *  - marks where you are (`aria-current` plus a spring-animated pill), and
 *  - has any mobile affordance. Four flat links wrapped onto two rows at
 *    375px and the tap targets sat under the minimum.
 */

type Item = { href: string; label: string };

const PUBLIC_ITEMS: Item[] = [
  { href: "/", label: "Home" },
  { href: "/events", label: "Races" },
];
const RUNNER_ITEMS: Item[] = [
  { href: "/", label: "Home" },
  { href: "/events", label: "Races" },
  { href: "/races", label: "My Races" },
  { href: "/profile", label: "Profile" },
];

/** `/events/abc` should light "Races"; `/racesomething` should not light
 *  "My Races". Segment boundary, same rule as lib/routes.ts. */
function isActive(pathname: string, href: string): boolean {
  // "/" is a prefix of every path, so it gets an exact match only — otherwise
  // Home would stay lit on /events, /races and everything else.
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SiteNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "/";
  const items = signedIn ? RUNNER_ITEMS : PUBLIC_ITEMS;
  const [open, setOpen] = React.useState(false);
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

  // A route change with the sheet open must close it, or the runner lands on
  // the new page behind a menu they already dismissed in their head.
  React.useEffect(() => setOpen(false), [pathname]);

  // The sheet is a full-screen overlay; leaving the page scrollable behind it
  // means a swipe moves the wrong layer.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes, per the modal-escape rule — the sheet is a dialog.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-6">
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
        <nav aria-label="Main" className="hidden items-center gap-1 rounded-pill bg-muted p-1 sm:flex">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-pill px-4 py-2 text-[13px] font-semibold transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-pill bg-background shadow-[0_1px_3px_rgb(0_0_0/0.13)]"
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 420, damping: 34, mass: 0.7 }
                    }
                  />
                ) : null}
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          {signedIn ? (
            <button
              type="button"
              onClick={logOut}
              disabled={leaving}
              className="hidden items-center gap-1.5 rounded-pill border border-border px-4 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-60 sm:inline-flex"
            >
              <LogOut size={15} aria-hidden="true" />
              {leaving ? "Logging out…" : "Log out"}
            </button>
          ) : (
            <Link
              href="/sign-in"
              className="rounded-pill bg-primary px-4 py-2.5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus sm:px-5"
            >
              Sign in
            </Link>
          )}

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="site-menu"
            className="-mr-1 flex size-11 items-center justify-center rounded-pill text-foreground transition-colors hover:bg-muted sm:hidden"
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="site-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="fixed inset-0 z-50 flex flex-col bg-forest text-white sm:hidden"
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            // Exits run at ~65% of the entrance so dismissing feels immediate.
            exit={reduced ? { opacity: 1 } : { opacity: 0, transition: { duration: 0.16 } }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex h-16 items-center justify-between px-5">
              <Image
                src="/topnav-logo.png"
                alt="Race Pace"
                width={64}
                height={34}
                className="h-[30px] w-auto brightness-0 invert"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                autoFocus
                className="-mr-1 flex size-11 items-center justify-center rounded-pill text-white transition-colors hover:bg-white/10"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>

            <nav aria-label="Main" className="flex flex-col px-5 pt-2">
              {items.map((item, i) => {
                const active = isActive(pathname, item.href);
                return (
                  <motion.div
                    key={item.href}
                    initial={reduced ? false : { opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: reduced ? 0 : 0.04 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block border-b border-white/10 py-4 font-display text-[30px] font-black uppercase leading-none tracking-[-1.2px]",
                        active ? "text-[#7FE0A6]" : "text-white",
                      )}
                    >
                      {item.label}
                    </Link>
                  </motion.div>
                );
              })}
            </nav>

            <div className="px-5 pt-7">
              {signedIn ? (
                <button
                  type="button"
                  onClick={logOut}
                  disabled={leaving}
                  className="flex w-full items-center justify-center gap-2 rounded-pill border border-white/20 py-4 text-[15px] font-semibold text-white disabled:opacity-60"
                >
                  <LogOut size={17} aria-hidden="true" />
                  {leaving ? "Logging out…" : "Log out"}
                </button>
              ) : (
                <Link
                  href="/sign-in"
                  className="block rounded-pill bg-primary py-4 text-center text-[15px] font-semibold text-primary-foreground"
                >
                  Sign in
                </Link>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
