import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchMarketplaceEvents } from "@/lib/events";
import { disciplineLayout } from "@race-pace/shared";

export const dynamic = "force-dynamic";

const DIRECTIONS = [
  {
    key: "dossier",
    name: "A · Expedition Dossier",
    pitch: "The race as a technical document. Oversized Archivo Black, hairline rules, every fact in mono at a size you can read across a room. Persuades with evidence.",
    motion: "Hero parallax, scroll-linked progress, count-up on the stat strip, staggered row reveals.",
  },
  {
    key: "kinetic",
    name: "B · Kinetic Bib",
    pitch: "The corral thirty seconds before the gun. Distances are race bibs, not table rows. Persuades with adrenaline.",
    motion: "Infinite marquee, hero parallax, live-slot count-ups, staggered bib grid.",
  },
] as const;

/** Side-by-side index for the two directions, built from the real event list so
 *  each link renders against actual Supabase rows rather than a fixture. */
export default async function DesignPreviewIndex() {
  const db = await createClient();
  const events = await fetchMarketplaceEvents(db);

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-14 sm:px-8">
      <h1 className="font-display text-[clamp(2rem,6vw,3.2rem)] font-black uppercase leading-[0.95] tracking-[-1px]">
        Landing page directions
      </h1>
      <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed text-muted-foreground">
        Two art directions, each rendered against live event data and branching on discipline —
        trail/ultra and road/fun-run get different arguments, not just different colours. Resize the
        window to check 375 / 768 / 1440, and turn on Reduce Motion to see the static fallbacks.
      </p>

      <div className="mt-12 flex flex-col gap-10">
        {DIRECTIONS.map((d) => (
          <section key={d.key} className="rounded-2xl border border-border p-6 sm:p-8">
            <h2 className="font-display text-[22px] font-extrabold uppercase tracking-[-0.3px]">{d.name}</h2>
            <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-foreground">{d.pitch}</p>
            <p className="font-mono-race mt-3 text-[12.5px] uppercase tracking-[1px] text-muted-foreground">
              {d.motion}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              {events.map((e) => (
                <Link
                  key={e.id}
                  href={`/design-preview/${d.key}/${e.id}`}
                  className="inline-flex items-center gap-2 rounded-pill bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
                >
                  {e.name}
                  <span className="font-mono-race text-[11px] uppercase tracking-[1px] opacity-75">
                    {disciplineLayout(e.discipline) === "profile" ? "trail" : "road"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {events.length === 0 ? (
        <p className="mt-10 text-muted-foreground">No published events to preview against.</p>
      ) : null}
    </main>
  );
}
