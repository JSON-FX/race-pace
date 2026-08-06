"use client";

import Link from "next/link";
import Image from "next/image";
import { formatDateRange, disciplineLayout } from "@race-pace/shared";
import type { EventRow } from "@/lib/events";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TopoPattern } from "@/components/TopoPattern";
import { Reveal, CountUp } from "@/components/event/motion-primitives";

/**
 * The home page's featured race — a wide slab, photo on one side and the
 * numbers on the other.
 *
 * It carries three figures rather than one because those three are the whole
 * decision: how much climbing, how far, and is there still room. A single
 * headline number ("24 slots left") looks decisive and answers none of them.
 *
 * Light by default. The dark variant follows disciplineLayout() — the same
 * rule that already sends a trail/ultra event page to a near-black canvas and
 * a road event to a light one — so the slab previews the page it links to
 * instead of contradicting it.
 */

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  // Compare date-to-date in UTC. Using local `now` against a UTC midnight
  // would report "0 days out" for most of race day in a positive offset.
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((then - today) / 86_400_000);
  return days >= 0 ? days : null;
}

function Stat({
  label,
  value,
  dark,
}: {
  label: string;
  value: React.ReactNode;
  dark: boolean;
}) {
  return (
    <div className={cn("border-r px-3.5 py-3 last:border-r-0", dark ? "border-white/12" : "border-border")}>
      <dt
        className={cn(
          "font-eyebrow text-[9.5px] font-bold uppercase tracking-[1.9px]",
          dark ? "text-white/50" : "text-muted-foreground",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono-race mt-1 text-[21px] font-bold tracking-[-0.5px]",
          dark ? "text-white" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Unit({ children, dark }: { children: React.ReactNode; dark: boolean }) {
  return (
    <span className={cn("ml-0.5 text-[10.5px]", dark ? "text-white/45" : "text-muted-foreground")}>
      {children}
    </span>
  );
}

export function FeaturedRace({
  event,
  slotsLeft,
  distanceCount,
}: {
  event: EventRow;
  /** Summed across categories by the server — the client has no slot data. */
  slotsLeft: number | null;
  distanceCount: number;
}) {
  const dark = disciplineLayout(event.discipline) === "profile";
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const days = daysUntil(event.event_date);
  const longest = event.distances.length ? Math.max(...event.distances) : null;

  return (
    <Reveal delay={0.1}>
      <article
        className={cn(
          "grid overflow-hidden rounded-2xl border md:grid-cols-[1.05fr_1fr]",
          dark
            ? "border-white/10 bg-forest shadow-[0_18px_40px_rgb(6_18_12/0.28)]"
            : "border-border bg-card shadow-[0_14px_34px_rgb(0_0_0/0.07)]",
        )}
      >
        <div
          className={cn(
            "relative min-h-[212px] border-b md:border-b-0 md:border-r",
            dark ? "border-white/10" : "border-divider",
          )}
        >
          {event.hero_image_url ? (
            <Image
              src={event.hero_image_url}
              alt=""
              fill
              priority
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          ) : (
            <TopoPattern className="absolute inset-0 h-full w-full" />
          )}
          {/* A flat scrim, not a gradient: the badge and the day count sit at
              opposite corners, so darkening one end would leave the other
              fighting whatever the photo happens to be there. */}
          <div className={cn("absolute inset-0", dark ? "bg-black/35" : "bg-black/15")} />

          <span className="absolute left-4 top-4 rounded-pill bg-primary px-3.5 py-1.5 font-mono-race text-[10px] font-bold uppercase tracking-[1.8px] text-primary-foreground">
            Next up
          </span>
          {days != null ? (
            <span className="font-mono-race absolute bottom-4 right-4 text-[10px] uppercase tracking-[1.4px] text-white/80">
              {days === 0 ? "Race day" : `${days} day${days === 1 ? "" : "s"} out`}
            </span>
          ) : null}
        </div>

        <div className="p-6 sm:p-7">
          <p className="font-eyebrow text-[10.5px] font-bold uppercase tracking-[3px] text-primary">
            {event.org_name ? `${event.org_name} presents` : "Race Pace"}
          </p>

          <h2
            className={cn(
              "mt-2.5 font-display text-[clamp(1.6rem,3.4vw,2.35rem)] font-black uppercase leading-[0.92] tracking-[-1.3px]",
              dark ? "text-white" : "text-foreground",
            )}
          >
            {event.name}
          </h2>

          {date ? (
            <p
              className={cn(
                "font-mono-race mt-3 text-[11.5px] uppercase tracking-[1.1px]",
                dark ? "text-white/55" : "text-muted-foreground",
              )}
            >
              {[date, event.city_name].filter(Boolean).join(" · ")}
            </p>
          ) : null}

          <dl
            className={cn(
              "mt-5 grid grid-cols-3 overflow-hidden rounded-lg border",
              dark ? "border-white/11 bg-white/[0.03]" : "border-border bg-muted/50",
            )}
          >
            {/* Vertical gain only earns the lead slot on a climbing race; a
                road event puts its longest distance there instead. */}
            {dark && event.elevation_gain_m ? (
              <Stat
                label="Vertical"
                dark={dark}
                value={<><CountUp value={event.elevation_gain_m} /><Unit dark={dark}>m</Unit></>}
              />
            ) : (
              <Stat
                label="Longest"
                dark={dark}
                value={
                  longest != null ? <><CountUp value={longest} /><Unit dark={dark}>km</Unit></> : <>—</>
                }
              />
            )}
            <Stat label="Distances" dark={dark} value={<CountUp value={distanceCount} />} />
            <Stat
              label="Slots left"
              dark={dark}
              value={slotsLeft != null ? <CountUp value={slotsLeft} /> : <>—</>}
            />
          </dl>

          <Link
            href={`/events/${event.id}`}
            className={cn(
              "mt-6 inline-flex rounded-pill px-6 py-3 text-[13.5px] font-semibold transition-opacity hover:opacity-90",
              dark ? "bg-white text-forest" : "bg-primary text-primary-foreground",
            )}
          >
            View race →
          </Link>
        </div>
      </article>
    </Reveal>
  );
}
