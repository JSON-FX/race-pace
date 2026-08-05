import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { fetchEvent, fetchCategories } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { TopoPattern } from "@/components/TopoPattern";
import { ParallaxMedia } from "@/components/ParallaxMedia";
import { EventBody } from "@/components/EventBody";
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

  const categories = await fetchCategories(db, id);
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });
  // almost_full is still registerable — see lib/eventStatus.ts, mirrors
  // apps/mobile/app/event/[id].tsx's `registerable` rule.
  const closed = isRegistrationClosed(event.status);

  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative isolate flex min-h-[58vh] items-end overflow-hidden">
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
          <div className="relative mx-auto w-full max-w-5xl px-6 pb-14">
            {event.org_name ? (
              <p className="text-[12px] font-semibold uppercase tracking-[2px] text-white/75">{event.org_name}</p>
            ) : null}
            <h1 className="mt-3 font-display text-[clamp(2.25rem,6vw,4rem)] font-black leading-[1] tracking-[-1.5px] text-white">
              {event.name}
            </h1>
            <p className="mt-4 text-[16px] text-white/85">
              {[date, location, event.venue].filter(Boolean).join(" · ")}
            </p>
          </div>
        </section>

        <EventBody event={event} categories={categories} closed={closed} />
      </main>
    </>
  );
}
