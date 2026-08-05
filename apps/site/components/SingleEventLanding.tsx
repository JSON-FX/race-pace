import Image from "next/image";
import Link from "next/link";
import { formatPeso, formatDateRange, formatAddress } from "@race-pace/shared";
import type { EventRow, CategoryRow } from "@/lib/events";
import { longDate } from "@/lib/format";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { TopoPattern } from "@/components/TopoPattern";
import { ParallaxMedia } from "@/components/ParallaxMedia";

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
            <a
              href="#distances"
              className="inline-flex rounded-pill bg-primary px-8 py-4 text-[16px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
            >
              {closed ? "See race details" : "Choose your distance"}
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        {event.status_note ? (
          <p className="mb-12 rounded-xl border border-amber bg-amber-tint px-5 py-4 text-[15px] text-foreground">
            {event.status_note}
          </p>
        ) : null}

        {event.description ? (
          <p className="max-w-2xl text-[19px] leading-relaxed text-foreground">{event.description}</p>
        ) : null}

        {/* The facts a trail runner actually decides on. */}
        <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-y border-divider py-9 sm:grid-cols-4">
          <Stat label="Elevation" value={event.elevation_gain_m ? `${event.elevation_gain_m.toLocaleString()} m` : "—"} />
          <Stat label="Cut-off" value={event.cutoff_hours ? `${event.cutoff_hours} h` : "—"} />
          <Stat
            label="Distances"
            value={event.distances.length ? event.distances.map((d) => `${d}K`).join(" · ") : "—"}
          />
          <Stat label="Registered" value={String(event.joined_count)} />
        </dl>

        {/* Distances are the conversion surface — one decision, not two. */}
        <h2 id="distances" className="mt-16 scroll-mt-24 font-display text-[34px] font-extrabold tracking-[-0.6px] text-foreground">
          Choose your distance
        </h2>
        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          {categories.map((c) => (
            <DistanceStub key={c.id} category={c} eventClosed={closed} />
          ))}
          {categories.length === 0 ? (
            <p className="text-muted-foreground">Distances haven&apos;t been published yet.</p>
          ) : null}
        </div>

        {event.inclusions && event.inclusions.length > 0 ? (
          <div className="mt-16 border-t border-divider pt-10">
            <h2 className="font-display text-[26px] font-extrabold tracking-[-0.5px] text-foreground">
              What&apos;s included
            </h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {event.inclusions.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[15px] text-foreground">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {event.org_name ? (
          <div className="mt-16 flex items-center gap-4 border-t border-divider pt-10">
            {event.org_logo_url ? (
              <Image
                src={event.org_logo_url}
                alt=""
                width={52}
                height={52}
                className="h-[52px] w-[52px] shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-forest text-[15px] font-bold text-white">
                {event.org_name.slice(0, 1)}
              </div>
            )}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-muted-foreground">
                Organized by
              </p>
              <p className="mt-0.5 font-display text-[19px] font-extrabold text-foreground">{event.org_name}</p>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[1.2px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 font-display text-[20px] font-extrabold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/** A distance card built like a race-bib stub: a dashed die-cut perforation
 *  separates the distance identity from its price and entry action, the same
 *  device TicketStub/TicketCard use downstream — so the poster already reads
 *  as the ticket it will become once the runner registers. */
function DistanceStub({ category, eventClosed }: { category: CategoryRow; eventClosed: boolean }) {
  const soldOut = category.slots_taken >= category.slots_total;
  const remaining = Math.max(0, category.slots_total - category.slots_taken);
  const enterable = !soldOut && !eventClosed;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-5">
        <div>
          <h3 className="font-display text-[23px] font-extrabold text-foreground">{category.label}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {category.distance_km ? `${category.distance_km} KM · ` : ""}
            {soldOut ? "Sold out" : `${remaining} ${remaining === 1 ? "slot" : "slots"} left`}
          </p>
        </div>
        <span className="text-[24px] font-semibold tabular-nums text-foreground">
          {formatPeso(category.base_price)}
        </span>
      </div>

      <div className="relative h-4 bg-card">
        <div className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-divider" />
        <span aria-hidden className="absolute -left-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
        <span aria-hidden className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-background" />
      </div>

      <div className="px-6 pt-5 pb-6">
        {enterable ? (
          <Link
            href={`/register/${category.id}`}
            className="flex w-full items-center justify-center rounded-pill bg-primary px-6 py-3.5 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
          >
            Enter — {formatPeso(category.base_price)}
          </Link>
        ) : (
          <span className="flex w-full items-center justify-center rounded-pill bg-muted px-6 py-3.5 text-[15px] font-semibold text-muted-foreground">
            {eventClosed ? "Registration closed" : "Sold out"}
          </span>
        )}
      </div>
    </div>
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
