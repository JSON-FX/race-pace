import Image from "next/image";
import type { EventRow } from "@/lib/events";
import { ParallaxMedia } from "@/components/ParallaxMedia";

/**
 * Shared between both layouts — "what's included" is a fact of the race,
 * not of its terrain. Only rendered when there's real content; a photo band
 * with no inclusions to list would just be decoration with nothing to say.
 * Falls back to a flat forest panel (never a broken/empty image) when the
 * event has a gallery photo but the caller has none better to offer.
 */
export function InclusionsBand({ event }: { event: EventRow }) {
  if (!event.inclusions || event.inclusions.length === 0) return null;
  const photo = event.gallery[0] ?? event.hero_image_url;

  return (
    <section className="relative isolate flex min-h-[42vh] items-center overflow-hidden bg-forest">
      {photo ? (
        <>
          <ParallaxMedia className="absolute inset-0">
            <Image src={photo} alt="" fill sizes="100vw" className="object-cover" />
          </ParallaxMedia>
          <div className="absolute inset-0 bg-gradient-to-r from-forest/95 via-forest/70 to-forest/25" />
        </>
      ) : null}
      <div className="relative mx-auto w-full max-w-5xl px-6 py-16">
        <p className="font-eyebrow text-[12px] font-bold uppercase tracking-[3px] text-amber">Included</p>
        <h2 className="mt-2 max-w-[17ch] font-display text-[clamp(1.6rem,3.2vw,2.5rem)] font-black leading-[1.05] tracking-[-0.4px] text-white">
          Everything but the running.
        </h2>
        <ul className="mt-6 max-w-[420px] list-none space-y-0 p-0">
          {event.inclusions.map((item) => (
            <li key={item} className="flex items-start gap-3 border-b border-white/15 py-2.5 text-[15px] text-white">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
