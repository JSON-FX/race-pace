import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents } from "@/lib/events";
import { EventCard } from "@/components/EventCard";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Races",
  description: "Every trail and ultra-trail race on Race Pace.",
};

// Slot counts must never be stale — a sold-out distance showing as available
// is a race-week support incident.
export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const db = await createClient();
  const events = await fetchMarketplaceEvents(db);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-14">
        <p className="text-[12px] font-semibold uppercase tracking-[1.5px] text-primary">The full field</p>
        <h1 className="mt-2 font-display text-[44px] font-extrabold leading-[1.03] tracking-[-1px] text-foreground sm:text-[56px]">
          Races
        </h1>
        <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-muted-foreground">
          Trail and ultra-trail races across Mindanao. Pick a distance and claim your slot.
        </p>

        {events.length === 0 ? (
          <p className="mt-16 text-muted-foreground">No races are open right now. Check back soon.</p>
        ) : (
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
