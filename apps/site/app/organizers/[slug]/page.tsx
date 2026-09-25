import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchOrganizer } from "@/lib/organizers";
import { SiteHeader } from "@/components/SiteHeader";
import { OrganizerEventRow, OrganizerProfileSplitHero } from "@/components/organizers/TrailAtlas";
import "../trail-atlas.css";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const db = await createClient();
  const organizer = await fetchOrganizer(db, slug);
  if (!organizer) return { title: "Organizer not found" };
  const canonical = new URL(`/organizers/${encodeURIComponent(organizer.slug)}`, process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").toString();
  return {
    title: organizer.name,
    description: organizer.description ?? `See ${organizer.name}'s upcoming races on Race Pace.`,
    alternates: { canonical },
    openGraph: { title: organizer.name, description: organizer.description ?? undefined, url: canonical, images: organizer.bannerUrl ? [{ url: organizer.bannerUrl }] : undefined },
  };
}

export default async function OrganizerProfilePage({ params }: Params) {
  const { slug } = await params;
  const db = await createClient();
  const organizer = await fetchOrganizer(db, slug);
  if (!organizer) notFound();
  return (
    <>
      <SiteHeader />
      <main className="trail-atlas">
        <div className="trail-atlas__inner trail-atlas__inner--profile">
          <Link href="/organizers" className="trail-atlas__back">All organizers</Link>
          <OrganizerProfileSplitHero organizer={organizer} />
          <div className="trail-atlas__profile-columns">
            <div>
              <section aria-labelledby="upcoming-events">
                <h2 id="upcoming-events" className="trail-atlas__section-title">Upcoming events</h2>
                {organizer.events.length ? (
                  <div className="trail-atlas__event-list">
                    {organizer.events.map((event) => <OrganizerEventRow key={event.id} event={event} />)}
                  </div>
                ) : (
                  <div className="trail-atlas__empty trail-atlas__empty--events">
                    <h3>No upcoming events</h3>
                    <p>Check back for this organizer&apos;s next race.</p>
                  </div>
                )}
              </section>
              {organizer.description ? (
                <section className="trail-atlas__about" aria-labelledby="about-organizer">
                  <h2 id="about-organizer" className="trail-atlas__section-title">About the organizer</h2>
                  <p>{organizer.description}</p>
                </section>
              ) : null}
            </div>
            <dl className="trail-atlas__profile-facts">
              {organizer.homeBase ? <div><dt>Home base</dt><dd>{organizer.homeBase}</dd></div> : null}
              <div><dt>Upcoming events</dt><dd>{organizer.events.length} {organizer.events.length === 1 ? "event" : "events"}</dd></div>
              {organizer.raceTypes.length ? <div><dt>Race types</dt><dd>{organizer.raceTypes.join(" · ")}</dd></div> : null}
            </dl>
          </div>
        </div>
      </main>
    </>
  );
}
