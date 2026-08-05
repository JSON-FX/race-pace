import Link from "next/link";
import Image from "next/image";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents, fetchCategories } from "@/lib/events";
import { EventCard } from "@/components/EventCard";
import { SiteHeader } from "@/components/SiteHeader";
import { TopoPattern } from "@/components/TopoPattern";
import { SingleEventLanding } from "@/components/SingleEventLanding";
import { longDate } from "@/lib/format";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { homeMode } from "@/lib/home";

export const dynamic = "force-dynamic";

export default async function Home() {
  const db = await createClient();
  const events = await fetchMarketplaceEvents(db);
  const mode = homeMode(events);

  if (mode === "single") {
    const event = events.find((e) => !isRegistrationClosed(e.status))!;
    const categories = await fetchCategories(db, event.id);
    return (
      <>
        <SiteHeader />
        <main>
          <SingleEventLanding event={event} categories={categories} />
        </main>
      </>
    );
  }

  if (mode === "empty") {
    return (
      <>
        <SiteHeader />
        <main>
          <section className="mx-auto flex min-h-[50vh] w-full max-w-6xl flex-col justify-center px-6">
            <p className="text-[12px] font-semibold uppercase tracking-[2px] text-primary">Race Pace</p>
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

  // mode === "multi" — hero the nearest upcoming open event, everything
  // else fills the grid. Unchanged from the original directory composition.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.status === "open" && (e.event_date ?? "") >= today);
  const hero = upcoming[0] ?? null;
  const rest = events.filter((e) => e.id !== hero?.id);

  return (
    <>
      <SiteHeader />
      <main>
        {hero ? (
          <section className="relative isolate flex min-h-[78vh] items-end overflow-hidden">
            {hero.hero_image_url ? (
              <Image src={hero.hero_image_url} alt="" fill priority sizes="100vw" className="object-cover" />
            ) : (
              <TopoPattern className="absolute inset-0 h-full w-full" />
            )}
            {/* Two layers: a flat scrim darkens the WHOLE photo so a headline can
                never cross a bright patch, then the gradient adds extra weight low
                down where the text actually sits. A gradient alone fading to
                transparent leaves the top bright and the type fights the image. */}
            <div className="absolute inset-0 bg-black/45" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/60 to-black/25" />
            <div className="relative mx-auto w-full max-w-6xl px-6 pb-20">
              {hero.org_name ? (
                <p className="text-[12px] font-semibold uppercase tracking-[2px] text-white/75">
                  {hero.org_name} presents
                </p>
              ) : null}
              <h1 className="mt-4 max-w-4xl font-display text-[clamp(2.75rem,8vw,5.5rem)] font-black leading-[0.98] tracking-[-2px] text-white">
                {hero.name}
              </h1>
              <p className="mt-5 text-[17px] text-white/85">
                {[
                  hero.event_date ? formatDateRange(hero.event_date, hero.end_date, longDate) : null,
                  formatAddress({ city_name: hero.city_name, province_name: hero.province_name }) || null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <Link
                href={`/events/${hero.id}`}
                className="mt-9 inline-flex rounded-pill bg-primary px-8 py-4 text-[16px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
              >
                View race
              </Link>
            </div>
          </section>
        ) : (
          <section className="mx-auto flex min-h-[50vh] w-full max-w-6xl flex-col justify-center px-6">
            <p className="text-[12px] font-semibold uppercase tracking-[2px] text-primary">Race Pace</p>
            <h1 className="mt-4 max-w-3xl font-display text-[clamp(2.5rem,7vw,4.5rem)] font-black leading-[0.98] tracking-[-1.5px] text-foreground">
              Trail races across Mindanao.
            </h1>
          </section>
        )}

        <section className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="flex items-baseline justify-between gap-6 border-t border-divider pt-8">
            <h2 className="font-display text-[30px] font-extrabold tracking-[-0.6px] text-foreground">
              All races
            </h2>
            <Link href="/events" className="text-[14px] font-semibold text-primary hover:text-primary-focus">
              View all
            </Link>
          </div>
          {rest.length === 0 ? (
            <p className="mt-6 text-muted-foreground">No other races are listed right now.</p>
          ) : (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
