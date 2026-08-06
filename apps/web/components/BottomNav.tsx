"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { primaryMobileItems, moreMobileItems, type NavItem } from "@/lib/nav-items";
import type { MyRoles } from "@/lib/queries/roles";
import { LinkPending } from "./NavProgress";

/**
 * Mobile navigation for the console.
 *
 * Replaces the drawer below `md`, for one reason: race-day check-in is the only
 * page genuinely used on a phone — outdoors, one-handed, before sunrise. The
 * drawer put it two taps away behind a 28×28 trigger in the top-LEFT corner,
 * the hardest point to reach with a thumb. A bottom bar puts it in the thumb arc
 * as a single tap.
 *
 * The desktop sidebar is untouched; this whole component is `md:hidden`.
 *
 * Both halves read `lib/nav-items.ts`, so the bar and the sidebar cannot
 * disagree about which destinations exist or who may see them — including the
 * super-admin gate on the Platform group.
 */

function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function Tab({ item, active }: { item: NavItem; active: boolean }) {
  const { icon: Icon, to, label } = item;
  return (
    <Link
      href={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        // min-h-12 + the flex column keeps the whole cell tappable, not just the
        // glyph — an icon-sized target is the most common bottom-bar mistake.
        "relative flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5",
        "text-[10.5px] font-semibold transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-[21px]" strokeWidth={active ? 2.3 : 1.9} aria-hidden />
      {/* Labelled, never icon-only. An unlabelled tab bar is guesswork on first
          use, and these icons (a clipboard vs a card) are not self-evident. */}
      <span className="leading-none">{label}</span>
      <LinkPending className="absolute right-[calc(50%-18px)] top-0 ml-0" />
    </Link>
  );
}

export function BottomNav({ roles }: { roles: MyRoles }) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  const primary = primaryMobileItems(roles);
  const groups = moreMobileItems(roles);

  // Close the sheet when the route changes — without this, tapping a
  // destination navigates behind a sheet that stays open over the new page.
  React.useEffect(() => setOpen(false), [pathname]);

  const moreActive = groups.some((g) => g.items.some((it) => isActive(pathname, it.to)));

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "sticky bottom-0 z-40 flex shrink-0 border-t border-border bg-card md:hidden",
        // The home indicator on a gesture-nav phone sits over the bottom ~34px.
        // Without this the last row of tab labels is unreadable and the targets
        // fight the system's own swipe area.
        "px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5",
      )}
    >
      {primary.map((item) => (
        <Tab key={item.to} item={item} active={isActive(pathname, item.to)} />
      ))}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className={cn(
            "flex min-h-12 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5",
            "text-[10.5px] font-semibold transition-colors",
            // "More" lights up when the current page lives inside it, so the bar
            // always shows where you are — otherwise Payouts would render the
            // whole bar inactive and the app would look lost.
            moreActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Menu className="size-[21px]" strokeWidth={moreActive ? 2.3 : 1.9} aria-hidden />
          <span className="leading-none">More</span>
        </SheetTrigger>

        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader className="pb-1">
            <SheetTitle className="text-[15px]">All destinations</SheetTitle>
          </SheetHeader>

          <div className="px-4 pb-2">
            {groups.map((group) => (
              <div key={group.label} className="mb-1">
                <p className="px-1 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {group.label}
                </p>
                {/* A 3-up grid rather than a list: it keeps every entry above the
                    fold on a short phone, so the sheet never needs scrolling to
                    reveal a destination. */}
                <div className="grid grid-cols-3 gap-1.5">
                  {group.items.map(({ to, label, icon: Icon }) => {
                    const active = isActive(pathname, to);
                    return (
                      <Link
                        key={to}
                        href={to}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-center",
                          "text-[11px] font-semibold leading-tight",
                          active ? "bg-accent text-primary" : "text-foreground",
                        )}
                      >
                        <Icon className="size-5" strokeWidth={1.9} aria-hidden />
                        {label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
