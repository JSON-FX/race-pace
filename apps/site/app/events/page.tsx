import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents } from "@/lib/events";
import { EventCard } from "@/components/EventCard";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Reveal } from "@/components/event/motion-primitives";
import { applyFilters, hasAnyFilter, parseFilters, provincesOf } from "@/lib/eventFilters";
import { EventFilters } from "./EventFilters";

export const metadata: Metadata = {
  title: "Races",
  description: "Every trail and ultra-trail race on Race Pace.",
};

// Slot counts must never be stale — a sold-out distance showing as available
// is a race-week support incident.
export const dynamic = "force-dynamic";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await createClient();
  const [events, sp] = await Promise.all([fetchMarketplaceEvents(db), searchParams]);

  const filters = parseFilters(sp);
  const shown = applyFilters(events, filters);
  // Provinces come from the FULL list, not the filtered one — otherwise
  // picking Bukidnon removes every other province chip and there's no way
  // back to them except the All chip.
  const provinces = provincesOf(events);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 sm:py-14">
        <Reveal>
          <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[3px] text-primary">The full field</p>
          <h1 className="mt-2 font-display text-[clamp(2rem,5vw,3.2rem)] font-black leading-[1.03] tracking-[-1.4px] text-foreground">
            Races
          </h1>
        </Reveal>

        <div className="mt-7">
          <EventFilters filters={filters} provinces={provinces} />
        </div>

        <p className="font-mono-race mt-5 text-[10.5px] uppercase tracking-[1.2px] text-muted-foreground">
          {shown.length} {shown.length === 1 ? "race" : "races"}
          {hasAnyFilter(filters) ? ` of ${events.length}` : ""} · filters live in the URL, so a filtered view is
          shareable
        </p>

        {shown.length === 0 ? (
          <div className="mt-14 rounded-xl border border-dashed border-border py-16 text-center">
            <p className="text-[16px] text-muted-foreground">
              {events.length === 0
                ? "No races are listed right now. Check back soon."
                : "No races match those filters."}
            </p>
            {hasAnyFilter(filters) ? (
              <Link
                href="/events"
                className="mt-6 inline-flex rounded-pill bg-primary px-6 py-3 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5">
            {shown.map((e, i) => (
              // Stagger caps at the sixth card: past that the last row would
              // wait most of a second, which reads as the page being slow.
              <Reveal key={e.id} delay={Math.min(i, 5) * 0.05}>
                <EventCard event={e} index={i + 1} />
              </Reveal>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
