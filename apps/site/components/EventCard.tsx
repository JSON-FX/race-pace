import Link from "next/link";
import Image from "next/image";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { shortDate } from "@/lib/format";
import type { EventRow } from "@/lib/events";
import { cn } from "@/lib/utils";
import { TopoPattern } from "@/components/TopoPattern";

/** "almost_full" -> "Almost full"; leaves already-clean words alone. */
function humanizeStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}

export function EventCard({ event }: { event: EventRow }) {
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });

  return (
    <Link
      href={`/events/${event.id}`}
      className="group block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        {event.hero_image_url ? (
          <Image
            src={event.hero_image_url}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <TopoPattern className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
        )}
        {event.status !== "open" ? (
          <span
            className={cn(
              "absolute left-3 top-3 rounded-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
              event.status === "cancelled"
                ? "bg-destructive text-destructive-foreground"
                : "bg-amber text-white",
            )}
          >
            {event.status === "cancelled" ? "Cancelled" : humanizeStatus(event.status)}
          </span>
        ) : null}
      </div>

      <div className="p-5">
        {event.org_name ? (
          <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-primary">{event.org_name}</p>
        ) : null}
        <h3 className="mt-1.5 font-display text-[21px] font-extrabold leading-tight tracking-[-0.4px] text-foreground">
          {event.name}
        </h3>

        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          {date ? <span>{date}</span> : null}
          {location ? <span>{location}</span> : null}
        </div>

        {event.distances.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {event.distances.map((d) => (
              <span
                key={d}
                className="rounded-pill border border-border px-2.5 py-1 text-[12px] font-semibold tabular-nums text-foreground"
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
