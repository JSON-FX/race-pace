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
    <nav aria-label="Runner account" className="inline-flex max-w-full gap-1 rounded-pill border border-border bg-card p-1 shadow-sm">
      {items.map((item) => {
        const active = item.key === current;
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-pill px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-forest text-white" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            <span>{item.label}</span>
            {item.key === "bookings" && bookingCount != null ? (
              <Badge variant={active ? "secondary" : "outline"} className="min-w-6 px-1.5">{bookingCount}</Badge>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
