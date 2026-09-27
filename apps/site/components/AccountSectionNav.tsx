import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Ticket, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function AccountSectionNav({ current, bookingCount }: { current: "profile" | "bookings"; bookingCount?: number }) {
  const items = [
    { key: "profile" as const, href: "/profile", label: "Race Passport", icon: UserRound },
    { key: "bookings" as const, href: "/bookings", label: "Bookings I manage", icon: Ticket },
  ];

  return (
    <nav aria-label="Runner account" className="inline-flex max-w-full flex-wrap gap-1 rounded-pill border border-border bg-card p-1 shadow-sm">
      {items.map((item) => {
        const active = item.key === current;
        const Icon = item.icon;
        return (
          <Button asChild key={item.key} variant={active ? "default" : "ghost"}><Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-2 px-3.5",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span>{item.label}</span>
            {item.key === "bookings" && bookingCount != null ? (
              <Badge variant={active ? "secondary" : "outline"} className="min-w-6 px-1.5">{bookingCount}</Badge>
            ) : null}
          </Link></Button>
        );
      })}
    </nav>
  );
}
