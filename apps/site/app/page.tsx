import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents, fetchCategories } from "@/lib/events";
import { EventCard } from "@/components/EventCard";
import { SiteHeader } from "@/components/SiteHeader";
import { FeaturedRace } from "@/components/FeaturedRace";
import { RaceRail } from "@/components/RaceRail";
import { SeasonBand } from "@/components/SeasonBand";
import { Reveal } from "@/components/event/motion-primitives";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { eventState } from "@/lib/eventState";
import { provincesOf } from "@/lib/eventFilters";
import { homeMode } from "@/lib/home";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await createClient();
  const events = await fetchMarketplaceEvents(db);
  const mode = homeMode(events);

  if (mode === "empty") {
    return (
      <>
        <SiteHeader />
        <main>
          <section className="mx-auto flex min-h-[50vh] w-full max-w-6xl flex-col justify-center px-5 sm:px-6">
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">Race Pace</p>
            <h1 className="mt-4 max-w-3xl font-display text-[clamp(2.5rem,7vw,4.5rem)] font-black leading-[0.98] tracking-[-1.5px] text-foreground">
              No races are open for entry right now.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
              The next one hasn&apos;t gone live yet. Check back soon, or see what&apos;s run before.
            </p>
            {events.length > 0 ? (
              <Link
                href="/events"
                className="mt-8 inline-flex w-fit rounded-pill border border-border px-7 py-3.5 text-[15px] font-semibold text-foreground transition-colors hover:border-primary/40"
              >
                See past races
              </Link>
            ) : null}
          </section>
        </main>
      </>
    );
  }

  // The nearest upcoming open race leads. `fetchMarketplaceEvents` already
  // orders by date, so the first still-registerable one IS the nearest —
  // no second sort, and no risk of the two orderings disagreeing.
  const today = new Date().toISOString().slice(0, 10);
  // A race underway carries status 'closed' (entries are shut), so it would
  // otherwise fall through to "Been and gone" — a race happening TODAY filed
  // under finished. Split it out first and it can't land in either bucket by
  // accident.
  const ongoing = events.filter((e) => eventState(e, today) === "ongoing");
  const ongoingIds = new Set(ongoing.map((e) => e.id));
  const open = events.filter((e) => !isRegistrationClosed(e.status) && !ongoingIds.has(e.id));
  const past = events.filter(
    (e) => isRegistrationClosed(e.status) && !ongoingIds.has(e.id),
  );
  const hero = open.find((e) => (e.event_date ?? "") >= today) ?? open[0];
  const rest = open.filter((e) => e.id !== hero?.id);

  // Slot counts belong to categories, which the marketplace query doesn't
  // join — one extra read, only for the featured race.
  const heroCategories = hero ? await fetchCategories(db, hero.id) : [];
  const slotsLeft = heroCategories.length
    ? heroCategories.reduce((n, c) => n + Math.max(0, c.slots_total - c.slots_taken), 0)
    : null;

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto w-full max-w-6xl px-5 pt-12 sm:px-6 sm:pt-16">
          <Reveal>
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">
              Mindanao · {new Date().getFullYear()} season
            </p>
            <h1 className="mt-3 max-w-[16ch] font-display text-[clamp(2.1rem,5.4vw,3.7rem)] font-black leading-[0.98] tracking-[-1.9px] text-foreground">
              Find your next <span className="text-primary">start line.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.06}>
            <p className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-muted-foreground sm:text-[16px]">
              {open.length === 1
                ? "One race is open for entry right now."
                : `${open.length} races open across the island.`}{" "}
              Pick a distance and claim your slot.
            </p>
          </Reveal>

          {hero ? (
            <div className="mt-8">
              <FeaturedRace
                event={hero}
                slotsLeft={slotsLeft}
                distanceCount={heroCategories.length || hero.distances.length}
              />
            </div>
          ) : null}
        </section>

        {ongoing.length > 0 ? (
          <section className="mx-auto w-full max-w-6xl px-5 pt-14 sm:px-6 sm:pt-16">
            <Reveal>
              <div className="flex items-baseline gap-3">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-primary" />
                <h2 className="font-display text-[20px] font-extrabold tracking-[-0.5px] text-foreground sm:text-[24px]">
                  Happening now
                </h2>
              </div>
            </Reveal>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5">
              {ongoing.map((e, i) => (
                <Reveal key={e.id} delay={i * 0.05}>
                  <EventCard event={e} />
                </Reveal>
              ))}
            </div>
          </section>
        ) : null}

        {rest.length > 0 ? <RaceRail events={rest} /> : null}

        <SeasonBand
          races={open.length}
          distances={open.reduce((n, e) => n + e.distances.length, 0)}
          runners={events.reduce((n, e) => n + e.joined_count, 0)}
          provinces={provincesOf(open).length}
        />

        {/* Anything already run stays reachable from home rather than only
            from a filtered /events — a finished race is where a returning
            runner looks for photos and results. */}
        {past.length > 0 ? (
          <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-6">
            <Reveal>
              <div className="flex items-baseline justify-between gap-6 border-t border-divider pt-8">
                <h2 className="font-display text-[22px] font-extrabold tracking-[-0.5px] text-foreground sm:text-[26px]">
                  Been and gone
                </h2>
                <Link href="/events" className="text-[13px] font-semibold text-primary hover:text-primary-focus">
                  View all →
                </Link>
              </div>
            </Reveal>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6">
              {past.slice(0, 3).map((e, i) => (
                  <Reveal key={e.id} delay={i * 0.05}>
                    <EventCard event={e} />
                  </Reveal>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
