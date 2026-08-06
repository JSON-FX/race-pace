import Link from "next/link";
import Image from "next/image";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { shortDate } from "@/lib/format";
import type { EventRow } from "@/lib/events";
import { cn } from "@/lib/utils";
import { TopoPattern } from "@/components/TopoPattern";
import { eventState, STATE_BADGE } from "@/lib/eventState";

/**
 * A race in a grid.
 *
 * Type steps down at the 2-up phone breakpoint. At 375px a two-column card is
 * roughly 165px wide, and at the desktop sizes the distance chips wrapped to
 * three lines — the card ended up taller than it was wide and the grid stopped
 * scanning. The smaller step only applies below `sm`, so nothing changes on
 * the 3-up desktop and tablet layout.
 */
export function EventCard({ event, index }: { event: EventRow; index?: number }) {
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });
  const state = eventState(event);
  const badge = state === "open" ? null : STATE_BADGE[state];

  return (
    <Link
      href={`/events/${event.id}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
    >
      {/* aspect-ratio, not a fixed height: these columns narrow from ~350px on
          desktop to ~165px on a phone, and a fixed height turns into a
          letterbox strip at the small end. */}
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {event.hero_image_url ? (
          <Image
            src={event.hero_image_url}
            alt=""
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 350px"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <TopoPattern className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
        )}

        {index != null ? (
          <span className="font-mono-race absolute left-2 top-2 rounded-md border-2 border-foreground bg-background px-1.5 py-0.5 text-[11px] font-bold text-foreground sm:left-3 sm:top-3 sm:px-2 sm:text-[13px]">
            {String(index).padStart(2, "0")}
          </span>
        ) : null}

        {/* Derived, not raw status: "Ongoing" and "Rescheduled" are not enum
            values, so reading `event.status` here showed a race that is
            happening right now as "Closed". See lib/eventState.ts. */}
        {badge ? (
          <span
            className={cn(
              "absolute right-2 top-2 rounded-pill px-2 py-1 text-[10px] font-semibold uppercase tracking-wide sm:right-3 sm:top-3 sm:px-2.5 sm:text-[11px]",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="p-3 sm:p-5">
        {event.org_name ? (
          <p className="truncate text-[10px] font-semibold uppercase tracking-[1.5px] text-primary sm:text-[11px]">
            {event.org_name}
          </p>
        ) : null}
        <h3 className="mt-1 font-display text-[13px] font-extrabold leading-tight tracking-[-0.2px] text-foreground sm:mt-1.5 sm:text-[19px] sm:tracking-[-0.4px]">
          {event.name}
        </h3>

        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10.5px] leading-snug text-muted-foreground sm:mt-2.5 sm:gap-x-3 sm:gap-y-1 sm:text-[13px]">
          {date ? <span>{date}</span> : null}
          {location ? <span>{location}</span> : null}
        </div>

        {event.distances.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1 sm:mt-4 sm:gap-1.5">
            {event.distances.map((d) => (
              <span
                key={d}
                className="font-mono-race rounded-pill border border-border px-1.5 py-0.5 text-[9.5px] font-bold tabular-nums text-foreground sm:px-2.5 sm:py-1 sm:text-[12px]"
              >
                {d}K
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}
