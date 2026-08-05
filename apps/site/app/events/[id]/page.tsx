import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPeso, formatDateRange, formatAddress } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/server";
import { fetchEvent, fetchCategories } from "@/lib/events";
import { SiteHeader } from "@/components/SiteHeader";
import { TopoPattern } from "@/components/TopoPattern";
import { longDate } from "@/lib/format";
import { isRegistrationClosed } from "@/lib/registration";

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
  // almost_full is still registerable — see lib/registration.ts, mirrors
  // apps/mobile/app/event/[id].tsx's `registerable` rule.
  const closed = isRegistrationClosed(event.status);

  return (
    <>
      <SiteHeader />
      <main>
        <section className="relative isolate flex min-h-[58vh] items-end overflow-hidden">
          {event.hero_image_url ? (
            <Image src={event.hero_image_url} alt="" fill priority sizes="100vw" className="object-cover" />
          ) : (
            <TopoPattern className="absolute inset-0 h-full w-full" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
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

        <div className="mx-auto w-full max-w-5xl px-6 py-16">
          {event.status_note ? (
            <p className="mb-10 rounded-xl border border-amber bg-amber-tint px-5 py-4 text-[15px] text-foreground">
              {event.status_note}
            </p>
          ) : null}

          {event.description ? (
            <p className="max-w-2xl text-[19px] leading-relaxed text-foreground">{event.description}</p>
          ) : null}

          <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-y border-divider py-9 sm:grid-cols-4">
            <Stat label="Elevation" value={event.elevation_gain_m ? `${event.elevation_gain_m.toLocaleString()} m` : "—"} />
            <Stat label="Cut-off" value={event.cutoff_hours ? `${event.cutoff_hours} h` : "—"} />
            <Stat
              label="Distances"
              value={event.distances.length ? event.distances.map((d) => `${d}K`).join(" · ") : "—"}
            />
            <Stat label="Registered" value={String(event.joined_count)} />
          </dl>

          <h2 className="mt-16 font-display text-[32px] font-extrabold tracking-[-0.6px] text-foreground">
            Choose your distance
          </h2>
          <div className="mt-7 flex flex-col gap-4">
            {categories.map((c) => {
              const soldOut = c.slots_taken >= c.slots_total;
              const remaining = Math.max(0, c.slots_total - c.slots_taken);
              return (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-6"
                >
                  <div>
                    <h3 className="font-display text-[21px] font-extrabold text-foreground">{c.label}</h3>
                    <p className="mt-1 text-[14px] text-muted-foreground">
                      {soldOut ? "Sold out" : `${remaining} slots left`}
                    </p>
                  </div>
                  <div className="flex items-center gap-5">
                    <span className="text-[22px] font-semibold tabular-nums text-foreground">
                      {formatPeso(c.base_price)}
                    </span>
                    {soldOut || closed ? (
                      <span className="rounded-pill bg-muted px-6 py-3 text-[15px] font-semibold text-muted-foreground">
                        {closed ? "Closed" : "Sold out"}
                      </span>
                    ) : (
                      <Link
                        href={`/register/${c.id}`}
                        className="rounded-pill bg-primary px-7 py-3 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
                      >
                        Register
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
            {categories.length === 0 ? (
              <p className="text-muted-foreground">Distances haven&apos;t been published yet.</p>
            ) : null}
          </div>
        </div>
      </main>
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
