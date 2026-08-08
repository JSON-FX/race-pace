import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { formatDateRange } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { fetchEvent, fetchCategories, fetchAddons } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { EventPageBody } from "@/components/event/EventPageBody";
import { longDate } from "@/lib/format";
import { isRegistrationClosed } from "@/lib/eventStatus";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// This is the whole point of server rendering: an organizer pasting the link
// into a Facebook group gets a real preview card.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const db = await createClient();
  const event = await fetchEvent(db, id);
  if (!event) return { title: "Race not found" };

  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : "";
  const distances = event.distances.length ? `${event.distances.map((d) => `${d}K`).join(" · ")}. ` : "";
  const description = `${distances}${date}${event.city_name ? ` · ${event.city_name}` : ""}`.trim();

  return {
    title: event.name,
    description: description || undefined,
    openGraph: {
      title: event.name,
      description: description || undefined,
      type: "website",
      images: event.hero_image_url ? [{ url: event.hero_image_url }] : undefined,
    },
  };
}

export default async function EventPage({ params }: Params) {
  const { id } = await params;
  const db = await createClient();
  const event = await fetchEvent(db, id);
  if (!event) notFound();

  // Independent reads — sequential awaits would stack round trips before the
  // first byte.
  const [categories, addons] = await Promise.all([fetchCategories(db, id), fetchAddons(db, id)]);
  // almost_full is still registerable — see lib/eventStatus.ts, mirrors
  // apps/mobile/app/event/[id].tsx's `registerable` rule.
  const closed = isRegistrationClosed(event.status, event.registration_closes_at);

  return (
    <>
      <SiteHeader />
      <main>
        <EventPageBody event={event} categories={categories} addons={addons} closed={closed} />
      </main>
    </>
  );
}
