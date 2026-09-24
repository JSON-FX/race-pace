import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents } from "@/lib/events";
import { FieldnotesEventCard } from "./FieldnotesEventCard";
import { SiteHeader } from "@/components/SiteHeader";
import { Reveal } from "@/components/event/motion-primitives";
import { applyFilters, filtersToQuery, hasAnyFilter, parseFilters, provincesOf } from "@/lib/eventFilters";
import { EventFilters } from "./EventFilters";
import "./fieldnotes.css";

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
      <main className="fieldnotes-events">
        <div className="fieldnotes-events__inner">
          <Reveal>
            <div className="fieldnotes-events__intro">
              <div>
                <p className="fieldnotes-events__eyebrow">Race Pace / The field guide</p>
                <h1>Find your next trail.</h1>
              </div>
              <p className="fieldnotes-events__lede">Discover races across the Philippines. Find a distance, follow the terrain, and make the start line yours.</p>
            </div>
          </Reveal>

          <section className="fieldnotes-events__filters" aria-label="Filter races">
            <div className="fieldnotes-events__section-top">
              <h2>Explore the calendar</h2>
              <span>01 / Races</span>
            </div>
            <EventFilters key={filtersToQuery(filters)} filters={filters} provinces={provinces} />
          </section>

          <div className="fieldnotes-events__results">
            <p role="status">Showing <strong>{shown.length}</strong> {shown.length === 1 ? "race" : "races"}{hasAnyFilter(filters) ? ` of ${events.length}` : ""}</p>
            <p>Choose a race to see its routes and details.</p>
          </div>

        {shown.length === 0 ? (
          <div className="fieldnotes-events__empty">
            <span aria-hidden="true">✳</span>
            <h2>No race in this view</h2>
            <p>
              {events.length === 0
                ? "No races are listed right now. Check back soon."
                : "No races match your search or filters."}
            </p>
            {hasAnyFilter(filters) ? (
              <Link
                href="/events"
                className="fieldnotes-events__clear"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="fieldnotes-events__grid">
            {shown.map((e, i) => (
              // Stagger caps at the sixth card: past that the last row would
              // wait most of a second, which reads as the page being slow.
              <Reveal key={e.id} delay={Math.min(i, 5) * 0.05}>
                <FieldnotesEventCard event={e} index={i + 1} />
              </Reveal>
            ))}
          </div>
        )}
        </div>
      </main>
    </>
  );
}
