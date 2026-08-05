import Image from "next/image";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import type { EventRow, CategoryRow } from "@/lib/events";
import { longDate } from "@/lib/format";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { TopoPattern } from "@/components/TopoPattern";
import { ParallaxMedia } from "@/components/ParallaxMedia";
import { RainbowButton } from "@/components/ui/rainbow-button";
import { EventBody } from "@/components/EventBody";

/**
 * The launch composition: when there is exactly one registerable race, the
 * home page IS the race poster, not a directory that happens to contain one
 * card. Everything a runner needs to decide — name, date, place, distances,
 * prices — is visible without a second click. Distance cards borrow the
 * dashed die-cut perforation from TicketStub/TicketCard on purpose: it's the
 * same stub the runner will carry through pay and check-in, so the poster
 * already looks like the ticket it's about to become.
 */
export function SingleEventLanding({ event, categories }: { event: EventRow; categories: CategoryRow[] }) {
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });
  const closed = isRegistrationClosed(event.status);

  const daysUntil = daysUntilRace(event.event_date);
  const totalRemaining = categories.reduce((sum, c) => sum + Math.max(0, c.slots_total - c.slots_taken), 0);
  const anyOpenCategory = categories.some((c) => c.slots_taken < c.slots_total);
  const lowOnSlots = anyOpenCategory && totalRemaining > 0 && totalRemaining <= 15;

  return (
    <>
      {/* Poster hero — owns the viewport. Name, date, place, and the call to
          action are all visible without scrolling. */}
      <section className="relative isolate flex min-h-[92vh] flex-col justify-end overflow-hidden">
        <ParallaxMedia>
          {event.hero_image_url ? (
            <Image src={event.hero_image_url} alt="" fill priority sizes="100vw" className="object-cover" />
          ) : (
            <TopoPattern className="absolute inset-0 h-full w-full" />
          )}
        </ParallaxMedia>
        {/* Two layers: a flat scrim darkens the WHOLE photo so a headline can
            never cross a bright patch, then the gradient adds extra weight low
            down where the text actually sits. A gradient alone fading to
            transparent leaves the top bright and the type fights the image. */}
        <div className="absolute inset-0 bg-black/45" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/60 to-black/25" />

        <div className="relative mx-auto flex w-full max-w-6xl flex-col px-6 pb-16 pt-32">
          {event.org_name ? (
            <p className="text-[12px] font-semibold uppercase tracking-[2px] text-white/75">
              {event.org_name} presents
            </p>
          ) : null}

          <h1 className="mt-4 max-w-4xl font-display text-[clamp(3rem,9vw,6.5rem)] font-black leading-[0.94] tracking-[-3px] text-white">
            {event.name}
          </h1>

          <p className="mt-6 text-[18px] text-white/85">
            {[date, [location, event.venue].filter(Boolean).join(" · ") || null].filter(Boolean).join("  ·  ")}
          </p>

          {/* Genuine urgency only — status/slot data straight from the DB,
              never invented. */}
          {event.status === "almost_full" || lowOnSlots || daysUntil !== null ? (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {event.status === "almost_full" ? (
                <span className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
                  Almost full
                </span>
              ) : lowOnSlots ? (
                <span className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-1.5 text-[13px] font-semibold text-primary-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
                  Only {totalRemaining} {totalRemaining === 1 ? "slot" : "slots"} left
                </span>
              ) : null}
              {daysUntil !== null ? (
                <span className="inline-flex items-center rounded-pill border border-white/30 px-4 py-1.5 text-[13px] font-semibold text-white/90">
                  {daysUntil === 0 ? "Race day is today" : `${daysUntil} ${daysUntil === 1 ? "day" : "days"} to race day`}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="mt-9">
            {/* asChild keeps this an <a>: it is an in-page jump to #distances,
                so it must stay a link for middle-click, keyboard and the
                anchor's own scroll behaviour. */}
            <RainbowButton asChild className="h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
              <a href="#distances">{closed ? "See race details" : "Choose your distance"}</a>
            </RainbowButton>
          </div>
        </div>
      </section>

      <EventBody event={event} categories={categories} closed={closed} />
    </>
  );
}

/** Whole days from today (UTC, date-only) to the event's start date. Null if
 *  there's no date or the race has already started/passed — a countdown to
 *  the past isn't urgency, it's noise. */
function daysUntilRace(eventDate: string | null): number | null {
  if (!eventDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round(
    (Date.parse(`${eventDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / msPerDay,
  );
  return diff >= 0 ? diff : null;
}
